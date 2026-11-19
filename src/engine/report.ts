import { COMFORT_HI, COMFORT_LO, HORIZON, LOOKAHEAD, MODES, ROOMS, TIMETABLE, ZONE, fmtTime, maxPeopleAt } from './config';
import { steerFlags, type Forecast, type Perception } from './forecast';
import { blockAt } from './occupancy';
import { MARGIN, type Plan } from './optimizer';
import { cloneState, emptyOut, outdoorTemp, stepPlant, sunFactor } from './plant';
import type { SafetyResult } from './safety';
import type { ClassBlock, Decision, Mode, PlantState } from './types';

const scratch = emptyOut();

/** Run one explicit plan forward and return room temperatures after `minutes`. */
function peek(start: PlantState, t: number, fc: Forecast, minutes: number, modeAt: (m: number) => Mode) {
  const s = cloneState(start);
  const occ = [0, 0, 0];
  const ref = [0, 0, 0];
  const upto = Math.min(HORIZON, Math.max(1, Math.round(minutes)));
  for (let m = 0; m < upto; m++) {
    for (let i = 0; i < 3; i++) occ[i] = fc.plan[i][m];
    stepPlant(s, modeAt(m), outdoorTemp(t + m), sunFactor(t + m), occ, steerFlags(fc, m, ref), scratch);
  }
  return s.ta;
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function nextClass(t: number): ClassBlock | null {
  let best: ClassBlock | null = null;
  for (const b of TIMETABLE) if (b.start > t && (!best || b.start < best.start)) best = b;
  return best;
}

/**
 * Turn a decision into words a facilities operator can check: what was seen,
 * what is coming, and what the alternatives would have done.
 */
export function explain(
  t: number,
  final: Mode,
  state: PlantState,
  p: Perception,
  fc: Forecast,
  plan: Plan,
  safety: SafetyResult,
): Decision['report'] {
  const best = plan.candidates[plan.chosen];
  const present = ROOMS.map((_, i) => Math.round(p.online[i] ? p.smooth[i] : fc.plan[i][0]));
  const total = present.reduce((a, b) => a + b, 0);
  const occupied = ROOMS.map((_, i) => i).filter((i) => present[i] >= 1);
  const empty = ROOMS.map((_, i) => i).filter((i) => present[i] < 1);
  const ids = (rooms: number[]) => list(rooms.map((r) => ROOMS[r].id));
  const planMode = (m: number): Mode => (best.c && m >= best.k2 ? best.c : best.k > 0 && m >= best.k ? best.b : final);
  const facts: string[] = [];

  const override = safety.checks.find((c) => c.status === 'fix');
  const done = (r: Omit<Decision['report'], 'facts'>): Decision['report'] => {
    if (override && r.tag !== 'fallback') facts.push(`Safety check: ${override.detail}`);
    return { ...r, facts: facts.slice(0, 3) };
  };
  const handover = () => {
    if (best.k > 0 && best.b !== final) facts.push(`Next: ${MODES[best.b].label.toLowerCase()} from ${fmtTime(t + best.k)}.`);
  };

  // Camera down: say what is being assumed and why.
  if (safety.fallback) {
    const i = p.online.findIndex((o) => !o);
    const blk = blockAt(i, t, 8);
    const seen = p.lastSeen[i];
    const assumed = Math.round(fc.plan[i][0]);
    const basis = blk ? `the timetable (${blk.code}, ${blk.enrolled} enrolled) and the last count of ${Math.round(seen.count)}` : `the last count of ${Math.round(seen.count)}`;
    facts.push(`Assumed in ${ROOMS[i].id} right now: ${assumed} people.`);
    if (assumed >= 1) facts.push(`Reading "no detections" as "empty" would have cut cooling with about ${assumed} people inside.`);
    facts.push('No step-down in cooling is allowed until the feed returns.');
    return done({
      tag: 'fallback',
      headline: `Camera lost in ${ROOMS[i].id}: holding a safe plan`,
      reason: `The ${ROOMS[i].id} feed stopped at ${fmtTime(seen.t + 1)}. The room is treated as occupied, using ${basis}. ${MODES[final].label} continues.`,
    });
  }

  if (final === 'OFF' || final === 'STANDBY') {
    const nx = nextClass(t);
    const normal = plan.hold.NORMAL;
    if (normal && normal.energy - best.energy > 0.1) facts.push(`Uses about ${(normal.energy - best.energy).toFixed(1)} kWh less over the next hour than cooling the empty zone.`);
    if (best.k > 0 && best.b !== 'STANDBY') facts.push(`${MODES[best.b].label} is planned for ${fmtTime(t + best.k)}.`);
    return done({
      tag: 'hold',
      headline: nx ? 'Standby: all three rooms are empty' : 'Standby: the teaching day is over',
      reason: nx
        ? `No one is detected in ${ZONE.id}. The next class is ${nx.code} in ${ROOMS[nx.room].id} at ${fmtTime(nx.start)}, so the fan and coil rest until it is time to pre-cool.`
        : `No one is detected in ${ZONE.id} and nothing else is scheduled today. Fan and coil are off.`,
    });
  }

  if (final === 'PRECOOL') {
    // The class this is for: the earliest one due in a room that is still waiting for people.
    const flags = steerFlags(fc, 0, [0, 0, 0]);
    let target: ClassBlock | null = null;
    for (const b of TIMETABLE) {
      if (b.start <= t - 4 || b.start > t + LOOKAHEAD + 15) continue;
      if (flags[b.room] !== 1 && present[b.room] >= b.enrolled * 0.5) continue;
      if (!target || b.start < target.start) target = b;
    }
    if (target) {
      const room = ROOMS[target.room];
      const lead = Math.max(1, target.start - t);
      const expected = Math.round(target.enrolled * target.history);
      const now = state.ta[target.room];
      const onPlan = peek(state, t, fc, lead, planMode)[target.room];
      facts.push(`On this plan ${room.id} is at ${onPlan.toFixed(1)} °C at ${fmtTime(target.start)}.`);
      if (lead > 15) {
        const late = peek(state, t, fc, lead, (m) => (m < 15 ? 'STANDBY' : planMode(m)))[target.room];
        if (late > onPlan + 0.15) facts.push(`Starting 15 min later would leave it at ${late.toFixed(1)} °C when they arrive.`);
      }
      handover();
      return done({
        tag: 'precool',
        headline: `Pre-cool for ${target.code} in ${room.id}`,
        reason:
          now > COMFORT_HI - MARGIN
            ? `${target.title} starts at ${fmtTime(target.start)} with about ${expected} students expected. ${room.id} is at ${now.toFixed(1)} °C, so cooling runs ahead of them to have the room under ${COMFORT_HI} °C when they walk in.`
            : `${target.title} starts at ${fmtTime(target.start)} with about ${expected} students expected. ${room.id} is at ${now.toFixed(1)} °C and is cooled a little further before they arrive, because a full room heats up fast.`,
      });
    }
    // Otherwise it is extra cooling for people already there.
    let i = occupied[0] ?? 0;
    for (const r of occupied) if (state.ta[r] > state.ta[i]) i = r;
    handover();
    return done({
      tag: 'boost',
      headline: occupied.length ? `Extra cooling: ${present[i]} people in ${ROOMS[i].id}` : 'Pre-cool: rooms being prepared',
      reason: occupied.length
        ? `${ROOMS[i].id} is at ${state.ta[i].toFixed(1)} °C with ${present[i]} people inside. The coil works harder for a few minutes to pull it back from the limit.`
        : 'Classes are about to start. The rooms are brought into the comfort band.',
    });
  }

  if (final === 'REDUCED') {
    const fan = pct(MODES.REDUCED.fan);
    if (best.peakRoom >= 0 && occupied.length) facts.push(`Warmest occupied room peaks at ${best.peak.toFixed(1)} °C (${ROOMS[best.peakRoom].id}, ${fmtTime(t + best.peakAt)}).`);
    const normal = plan.hold.NORMAL;
    const reduced = plan.hold.REDUCED;
    if (normal && reduced && normal.energy - reduced.energy > 0.1) facts.push(`Uses about ${(normal.energy - reduced.energy).toFixed(1)} kWh less per hour than normal cooling.`);
    handover();
    const noShow = fc.basis.findIndex((b) => b === 'no-show');
    const blk = noShow >= 0 ? blockAt(noShow, t, 8) : null;
    const why = blk ? ` (${blk.code} is on the timetable but nobody came)` : '';
    let reason: string;
    if (occupied.length === 1) {
      const r = occupied[0];
      reason = `Only ${ROOMS[r].id} is in use, with ${present[r]} people${why}. The air handler has to keep running for it, so ${ids(empty)} receive the same air. Airflow is cut to ${fan}, which still holds ${ROOMS[r].id} in the comfort band.`;
    } else if (occupied.length && empty.length) {
      reason = `${ids(empty)} ${empty.length > 1 ? 'are' : 'is'} empty${why}, but ${ids(occupied)} share the same air handler and are in use, so the zone cannot be switched off. Airflow is cut to ${fan}, enough for ${total} people.`;
    } else if (occupied.length) {
      reason = `${total} people across all three rooms. ${fan} airflow holds every room inside the comfort band and still brings enough fresh air.`;
    } else {
      const nx = nextClass(t);
      reason = nx ? `The zone is empty for the moment and ${nx.code} starts in ${ROOMS[nx.room].id} at ${fmtTime(nx.start)}. Gentle cooling keeps the rooms ready.` : 'The zone is empty. Gentle cooling only.';
    }
    return done({ tag: 'reduce', headline: occupied.length ? `Reduced cooling: ${total} people in the zone` : 'Reduced cooling: rooms kept ready', reason });
  }

  // NORMAL
  const reduced = plan.hold.REDUCED;
  let whyNot = '';
  if (occupied.length && reduced) {
    if (total > maxPeopleAt(MODES.REDUCED.fan)) whyNot = ` Reduced airflow would not bring enough fresh air for ${total} people.`;
    else if (reduced.peakRoom >= 0 && reduced.peak > COMFORT_HI - MARGIN) whyNot = ` On reduced airflow ${ROOMS[reduced.peakRoom].id} would reach ${reduced.peak.toFixed(1)} °C.`;
  }
  if (best.peakRoom >= 0) facts.push(`Warmest occupied room peaks at ${best.peak.toFixed(1)} °C (${ROOMS[best.peakRoom].id}).`);
  handover();
  const rooms = occupied.map((r) => `${present[r]} in ${ROOMS[r].id}`);
  const surprise = fc.basis.findIndex((b) => b === 'unscheduled');
  if (surprise >= 0 && present[surprise] >= 4) {
    return done({
      tag: 'boost',
      headline: `Unscheduled: ${present[surprise]} people in ${ROOMS[surprise].id}`,
      reason: `The camera counts ${present[surprise]} people in ${ROOMS[surprise].id} and the timetable has nothing there. They are treated as real occupancy, so the zone keeps cooling instead of going to standby.${whyNot}`,
    });
  }
  return done({
    tag: 'normal',
    headline: occupied.length ? `Normal cooling: ${total} people in ${occupied.length} room${occupied.length > 1 ? 's' : ''}` : 'Normal cooling: rooms being prepared',
    reason: occupied.length
      ? `${list(rooms)}. Full airflow keeps the occupied rooms between ${COMFORT_LO} and ${COMFORT_HI} °C.${whyNot}`
      : 'Classes are about to start. Normal cooling brings the rooms into the comfort band.',
  });
}
