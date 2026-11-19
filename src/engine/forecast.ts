import { AHU, HORIZON, LOOKAHEAD, PHYS, ROOMS, TIMETABLE, recall } from './config';
import { blockAt, presence, timetableExpectation } from './occupancy';
import { ROOM_PHYS, outdoorTemp, sunFactor } from './plant';
import type { Basis, ClassBlock, PlantState } from './types';

export interface Perception {
  /** null when the camera is offline */
  count: (number | null)[];
  conf: number[];
  online: boolean[];
  /** short median of recent readings */
  smooth: number[];
  lastSeen: { count: number; t: number }[];
}

export interface Forecast {
  /** per room, per minute, 0..HORIZON+LOOKAHEAD */
  mean: Float32Array[];
  lo: Float32Array[];
  hi: Float32Array[];
  /** what the planner uses: leans to the cautious side of the band */
  plan: Float32Array[];
  basis: Basis[];
}

const leaving = (t: number, end: number) => 1 - 1 / (1 + Math.exp(-(t - (end + 2)) / 1.4));

/** The detector misses a few people in dense rooms; correct by its known recall. */
const corrected = (count: number, room: number) => {
  const cap = ROOMS[room].capacity;
  return Math.min(cap, count / recall(count, cap));
};

function expectationExcluding(room: number, t: number, skip: ClassBlock | null) {
  let v = 0;
  for (const b of TIMETABLE) {
    if (b.room !== room || b === skip) continue;
    if (t < b.start - 20 || t > b.end + 12) continue;
    v += b.enrolled * b.history * presence(t, b.start, b.end);
  }
  return v;
}

/**
 * Occupancy for the next hour, per room.
 *
 * Before a class the timetable and past attendance are all there is. Once people
 * are in the room the camera count takes over. A scheduled class nobody came to
 * is dropped; people the timetable knows nothing about are kept. With the camera
 * down the forecast never falls below what the timetable or the last count says.
 */
export function forecastOccupancy(t: number, p: Perception): Forecast {
  const n = HORIZON + LOOKAHEAD + 1;
  const mean = ROOMS.map(() => new Float32Array(n));
  const lo = ROOMS.map(() => new Float32Array(n));
  const hi = ROOMS.map(() => new Float32Array(n));
  const plan = ROOMS.map(() => new Float32Array(n));
  const basis: Basis[] = [];

  for (let r = 0; r < ROOMS.length; r++) {
    const cap = ROOMS[r].capacity;
    // a class that ended a few minutes ago is still emptying, not a new gathering
    let cur = blockAt(r, t, 8);
    if (!cur) for (const blk of TIMETABLE) if (blk.room === r && t >= blk.end && t < blk.end + 8) cur = blk;
    const online = p.online[r];
    const obs = online ? corrected(p.smooth[r], r) : 0;
    let b: Basis = 'empty';

    if (!online) b = 'fallback';
    else if (cur) {
      const elapsed = t - cur.start;
      if (elapsed >= 12 && p.smooth[r] <= 2) b = 'no-show';
      else if (elapsed >= 6) b = 'observed';
      else b = 'timetable';
    } else if (p.smooth[r] >= 4) b = 'unscheduled';

    let any = 0;
    for (let k = 0; k < n; k++) {
      const tt = t + k;
      let m = 0;
      let l = 0;
      let h = 0;
      if (b === 'fallback') {
        const seen = p.lastSeen[r];
        const inBlock = cur && seen.t >= cur.start - 8;
        const held = inBlock ? seen.count * leaving(tt, cur!.end) : seen.count * Math.max(0, 1 - (tt - seen.t) / 25);
        const tte = timetableExpectation(r, tt);
        m = Math.max(tte, held);
        l = m * 0.5;
        const enrolled = cur && tt < cur.end ? cur.enrolled : 0;
        h = Math.max(m * 1.2, enrolled * leaving(tt, cur ? cur.end : tt));
      } else if (b === 'no-show') {
        m = obs * leaving(tt, cur!.end) + expectationExcluding(r, tt, cur);
        l = m * 0.7;
        h = m * 1.2 + (tt < cur!.end ? 2 : 0);
      } else if (b === 'observed') {
        const rest = expectationExcluding(r, tt, cur);
        m = obs * leaving(tt, cur!.end) + rest;
        l = obs * 0.94 * leaving(tt, cur!.end) + rest * 0.7;
        h = (obs * 1.08 + 1) * leaving(tt, cur!.end) + rest * 1.2;
      } else if (b === 'unscheduled') {
        const stay = k <= 30 ? 1 : 1 - ((k - 30) / 30) * 0.6;
        const tte = timetableExpectation(r, tt);
        m = Math.max(obs * stay, tte);
        l = Math.max(obs * stay * 0.5, tte * 0.7);
        h = Math.max(obs * 1.2 + 2, tte * 1.2);
      } else {
        const tte = timetableExpectation(r, tt);
        m = b === 'timetable' ? Math.max(tte, obs * leaving(tt, cur!.end)) : tte;
        l = m * 0.7;
        h = m * 1.2 + (m > 1 ? 2 : 0);
      }
      m = Math.min(cap, m);
      mean[r][k] = m;
      lo[r][k] = Math.min(cap, l);
      hi[r][k] = Math.min(cap, h);
      plan[r][k] = Math.min(cap, m + 0.5 * (Math.min(cap, h) - m));
      any = Math.max(any, m);
    }
    if (b === 'empty' && any >= 1) b = 'timetable';
    basis.push(b);
  }
  return { mean, lo, hi, plan, basis };
}

/**
 * Which rooms the coil should be steered by, m minutes into a forecast:
 * 2 = occupied, 1 = expected within the look-ahead, 0 = neither.
 */
export function steerFlags(fc: Forecast, m: number, into: number[]) {
  const last = fc.plan[0].length - 1;
  for (let i = 0; i < ROOMS.length; i++) {
    const row = fc.plan[i];
    if (row[Math.min(m, last)] >= 1) {
      into[i] = 2;
      continue;
    }
    let soon = 0;
    const end = Math.min(last, m + LOOKAHEAD);
    for (let k = m + 1; k <= end; k += 3) {
      if (row[k] >= 1) {
        soon = 1;
        break;
      }
    }
    into[i] = soon;
  }
  return into;
}

/** Heat the zone would have to reject to hold 24 °C with the given occupancy, kW thermal. */
export function zoneDemandKw(t: number, occ: number[], state: PlantState) {
  let people = 0;
  for (const o of occ) people += o;
  if (people < 1) return 0;
  const tOut = outdoorTemp(t);
  const sun = sunFactor(t);
  let sensible = 0;
  for (let i = 0; i < ROOMS.length; i++) {
    const p = ROOM_PHYS[i];
    sensible +=
      occ[i] * PHYS.personSensible +
      (occ[i] > 0.5 ? PHYS.lightsOn : PHYS.lightsStandby) * p.area +
      ROOMS[i].solar * sun * (1 - PHYS.solarToMass) +
      ROOMS[i].ua * (tOut - 24) +
      p.hA * (state.tm[i] - 24);
  }
  sensible = Math.max(0, sensible);
  const flow = Math.min(1, Math.max(0.3, sensible / (AHU.mDesign * PHYS.cp * (24 - AHU.tSupply))));
  const mOa = flow * AHU.mDesign * AHU.oaFraction;
  const vent = mOa * (PHYS.cp * (tOut - 24) + AHU.latentPerKgOa);
  return (sensible + vent + people * PHYS.personLatent) / 1000;
}
