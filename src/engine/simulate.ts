import { COMFORT_HI, COMFORT_LO, DECISION_EVERY, FIXED, FIXED_TIGHT, HORIZON, ROOMS, STEPS, SURPRISES, T0, TIMETABLE, hm } from './config';
import { forecastOccupancy, steerFlags, zoneDemandKw, type Forecast, type Perception } from './forecast';
import { buildOccupancy } from './occupancy';
import { optimise } from './optimizer';
import { emptyOut, initialState, outdoorTemp, stepPlant, sunFactor } from './plant';
import { explain, nextClass } from './report';
import { MIN_DWELL, safetyCheck } from './safety';
import type { DayEvent, DayResult, Decision, Mode, PlantMode, PlantState, RunSeries } from './types';

function newSeries(n: number): RunSeries {
  return {
    ta: ROOMS.map(() => new Float32Array(n)),
    tm: ROOMS.map(() => new Float32Array(n)),
    flow: new Float32Array(n),
    duty: new Float32Array(n),
    tSupply: new Float32Array(n),
    tReturn: new Float32Array(n),
    power: new Float32Array(n),
    coil: new Float32Array(n),
    energy: new Float32Array(n),
    discomfort: new Float32Array(n),
    outOfBand: ROOMS.map(() => new Uint8Array(n)),
    mode: new Array<Mode>(n).fill('OFF'),
    totalKwh: 0,
    discomfortMin: 0,
    roomMinutesOut: 0,
  };
}

const median3 = (a: number[]) => {
  if (a.length === 0) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/**
 * One simulated teaching day, run twice on identical weather, occupancy and
 * building: once on the fixed timer, once on CoolAhead's recommendations.
 */
export function simulateDay(seed = 7): DayResult {
  const day = buildOccupancy(seed);
  const n = STEPS + 1;
  const tOut = new Float32Array(n);
  const sun = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    tOut[k] = outdoorTemp(T0 + k);
    sun[k] = sunFactor(T0 + k);
  }

  const out = emptyOut();
  const noRef: number[] | null = null;
  const run = (control: (k: number, t: number, s: PlantState) => { mode: PlantMode; ref: number[] | null }): RunSeries => {
    const sr = newSeries(n);
    const s = initialState();
    for (let i = 0; i < ROOMS.length; i++) {
      sr.ta[i][0] = s.ta[i];
      sr.tm[i][0] = s.tm[i];
    }
    const occ = [0, 0, 0];
    for (let k = 0; k < STEPS; k++) {
      const t = T0 + k;
      const cmd = control(k, t, s);
      for (let i = 0; i < ROOMS.length; i++) occ[i] = day.occ[i][k];
      stepPlant(s, cmd.mode, tOut[k], sun[k], occ, cmd.ref, out);
      sr.mode[k] = cmd.mode === 'TIMER' ? 'NORMAL' : cmd.mode;
      sr.flow[k] = out.flow;
      sr.duty[k] = out.duty;
      sr.tSupply[k] = out.tSupply;
      sr.tReturn[k] = out.tReturn;
      sr.power[k] = out.powerKw;
      sr.coil[k] = out.coilKw;
      sr.energy[k + 1] = sr.energy[k] + out.powerKw / 60;
      let people = 0;
      let rooms = 0;
      for (let i = 0; i < ROOMS.length; i++) {
        sr.ta[i][k + 1] = s.ta[i];
        sr.tm[i][k + 1] = s.tm[i];
        const present = day.occ[i][k + 1];
        if (present >= 1 && (s.ta[i] > COMFORT_HI + 0.05 || s.ta[i] < COMFORT_LO - 0.05)) {
          sr.outOfBand[i][k + 1] = 1;
          people += present;
          rooms += 1;
        }
      }
      sr.discomfort[k + 1] = sr.discomfort[k] + people;
      sr.roomMinutesOut += rooms;
    }
    sr.mode[STEPS] = sr.mode[STEPS - 1];
    sr.flow[STEPS] = sr.flow[STEPS - 1];
    sr.duty[STEPS] = sr.duty[STEPS - 1];
    sr.tSupply[STEPS] = sr.tSupply[STEPS - 1];
    sr.tReturn[STEPS] = sr.tReturn[STEPS - 1];
    sr.power[STEPS] = sr.power[STEPS - 1];
    sr.coil[STEPS] = sr.coil[STEPS - 1];
    sr.totalKwh = sr.energy[STEPS];
    sr.discomfortMin = sr.discomfort[STEPS];
    return sr;
  };

  const timer = (sched: { on: number; off: number; mode: PlantMode }) =>
    run((_, t) => ({ mode: t >= sched.on && t < sched.off ? sched.mode : 'OFF', ref: noRef }));
  const fixed = timer(FIXED);
  const tight = timer(FIXED_TIGHT);

  // CoolAhead: vision -> forecast -> optimiser -> safety -> report, every few minutes.
  const decisions: Decision[] = [];
  const recent: number[][] = ROOMS.map(() => []);
  const lastSeen = ROOMS.map(() => ({ count: 0, t: T0 }));
  let mode: Mode = 'STANDBY';
  let dwell = 60;
  let fc: Forecast | null = null;
  let fcAt = T0;
  const ref = [0, 0, 0];
  let lastOnline = ROOMS.map(() => true);
  let lastCounts = [0, 0, 0];

  const cool = run((k, t, s) => {
    const online = ROOMS.map((_, i) => day.online[i][k] === 1);
    const count: (number | null)[] = [];
    const smooth: number[] = [];
    for (let i = 0; i < ROOMS.length; i++) {
      if (online[i]) {
        const c = day.est[i][k];
        count.push(c);
        recent[i].push(c);
        if (recent[i].length > 3) recent[i].shift();
        const m = median3(recent[i]);
        smooth.push(m);
        lastSeen[i] = { count: m, t };
      } else {
        count.push(null);
        smooth.push(0);
        recent[i].length = 0;
      }
    }

    const cameraChanged = online.some((o, i) => o !== lastOnline[i]);
    const jumped = smooth.some((c, i) => online[i] && Math.abs(c - lastCounts[i]) >= 9);
    const due = k % DECISION_EVERY === 0;
    if (due || cameraChanged || (jumped && dwell >= 2)) {
      const p: Perception = { count, conf: ROOMS.map((_, i) => day.conf[i][k]), online, smooth, lastSeen: lastSeen.map((x) => ({ ...x })) };
      fc = forecastOccupancy(t, p);
      fcAt = t;
      const plan = optimise(s, t, fc, mode, dwell < MIN_DWELL);
      const best = plan.candidates[plan.chosen];
      const safety = safetyCheck(best.a, mode, dwell, t, s, p, fc);
      const report = explain(t, safety.final, s, p, fc, plan, safety);

      const grid: number[] = [];
      for (let m = 0; m <= HORIZON; m += 5) grid.push(m);
      const sample = (a: Float32Array[]) => a.map((row) => grid.map((m) => row[m]));
      const dem = (a: Float32Array[]) => grid.map((m) => zoneDemandKw(t + m, a.map((row) => row[m]), s));
      const nx = nextClass(t);

      decisions.push({
        t,
        temps: s.ta.slice(),
        vision: { count, conf: p.conf.slice(), online },
        forecast: {
          occ: sample(fc.mean),
          lo: sample(fc.lo),
          hi: sample(fc.hi),
          basis: fc.basis,
          demand: dem(fc.mean),
          demandLo: dem(fc.lo),
          demandHi: dem(fc.hi),
          next: nx ? { room: nx.room, code: nx.code, title: nx.title, start: nx.start, expected: Math.round(nx.enrolled * nx.history) } : null,
        },
        candidates: plan.candidates,
        chosen: plan.chosen,
        hold: plan.hold,
        safety,
        report,
        mode: safety.final,
        planSwitchAt: best.k > 0 && best.b !== safety.final ? t + best.k : null,
        planNext: best.k > 0 && best.b !== safety.final ? best.b : null,
      });

      if (safety.final !== mode) dwell = 0;
      mode = safety.final;
      lastOnline = online;
      lastCounts = smooth.slice();
    }
    dwell += 1;
    // Steer by what is known this minute: live counts where a camera is up, the forecast where it is not.
    steerFlags(fc!, t - fcAt, ref);
    for (let i = 0; i < ROOMS.length; i++) {
      if (online[i]) ref[i] = smooth[i] >= 1 ? 2 : Math.min(ref[i], 1);
    }
    return { mode, ref };
  });

  const firstPre = decisions.find((d) => d.report.tag === 'precool');
  const noShow = TIMETABLE[SURPRISES.noShowBlock];
  const events: DayEvent[] = [
    {
      id: 'precool',
      label: 'Upcoming lecture',
      short: 'Pre-cool',
      t: firstPre ? firstPre.t : hm(7, 20),
      end: hm(8, 30),
      room: 0,
      note: 'Rooms are cooled ahead of the first classes instead of when people are already inside.',
    },
    {
      id: 'noshow',
      label: 'One room empty',
      short: 'One empty',
      t: noShow.start + 12,
      end: noShow.end,
      room: noShow.room,
      note: `${noShow.code} is on the timetable but nobody came. The other two rooms on the air handler are full.`,
    },
    {
      id: 'allempty',
      label: 'All rooms empty',
      short: 'All empty',
      t: hm(11, 50),
      end: hm(13, 0),
      room: null,
      note: 'A gap with no classes in any room of the zone.',
    },
    {
      id: 'surge',
      label: 'Sudden increase',
      short: 'Surge',
      t: SURPRISES.surge.start + 3,
      end: SURPRISES.surge.end,
      room: SURPRISES.surge.room,
      note: `${SURPRISES.surge.people} people walk into ${ROOMS[SURPRISES.surge.room].id} for a session the timetable does not list.`,
    },
    {
      id: 'camera',
      label: 'Camera failure',
      short: 'Camera out',
      t: SURPRISES.cameraOut.start + 1,
      end: SURPRISES.cameraOut.end,
      room: SURPRISES.cameraOut.room,
      note: `The ${ROOMS[SURPRISES.cameraOut.room].id} feed drops in the middle of a class.`,
    },
    {
      id: 'evening',
      label: 'After the timer',
      short: 'Late class',
      t: hm(18, 5),
      end: hm(18, 45),
      room: 2,
      note: 'A capstone lab runs past 18:00, when the fixed schedule switches the air handler off.',
    },
  ];

  return { t0: T0, steps: STEPS, tOut, sun, occ: day.occ, est: day.est, conf: day.conf, online: day.online, fixed, tight, cool, decisions, events };
}

/** Decision in force at time t. */
export function decisionAt(day: DayResult, t: number): Decision {
  const d = day.decisions;
  let lo = 0;
  let hi = d.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (d[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return d[lo];
}
