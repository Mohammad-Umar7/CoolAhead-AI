import { ACTIONS, COMFORT_HI, COMFORT_LO, HORIZON, MODES, ROOMS, maxPeopleAt } from './config';
import { steerFlags, type Forecast } from './forecast';
import { cloneState, emptyOut, outdoorTemp, stepPlant, sunFactor } from './plant';
import type { Candidate, Mode, PlantState } from './types';

/** Plan to stay this far inside the band: forecasts are never exact. */
export const MARGIN = 0.3;
/** A slightly cool room is the lesser evil, so the lower limit is planned with less slack. */
const COLD_MARGIN = 0.1;
/** Person-degree-minutes of predicted violation a plan may carry and still count as comfortable. */
const TOLERANCE = 2;
/** kWh-equivalent charged per change of mode, so the plant is not toggled for pennies. */
const SWITCH_COST = 0.4;
const SWITCH_TIMES = [5, 10, 15, 20, 25, 30, 40, 50];
const PRECOOL_RUNS = [10, 15, 20, 25, 30, 40];
const RANK: Record<Mode, number> = { OFF: 0, STANDBY: 1, REDUCED: 2, PRECOOL: 3, NORMAL: 3 };
const REDUCED_HEADROOM = maxPeopleAt(MODES.REDUCED.fan);

const scratch = emptyOut();

export interface Rollout {
  refs: number[][];
  tOut: number[];
  sun: number[];
}

export function prepareRollout(t: number, fc: Forecast): Rollout {
  const refs: number[][] = [];
  const tOut: number[] = [];
  const sun: number[] = [];
  for (let m = 0; m < HORIZON; m++) {
    refs.push(steerFlags(fc, m, [0, 0, 0]));
    tOut.push(outdoorTemp(t + m));
    sun.push(sunFactor(t + m));
  }
  return { refs, tOut, sun };
}

function rollout(start: PlantState, a: Mode, b: Mode, k: number, fc: Forecast, ctx: Rollout, c: Mode | null = null, k2 = 0): Candidate {
  const s = cloneState(start);
  const occ = [0, 0, 0];
  let energy = 0;
  let discomfort = 0;
  let tight = 0;
  let peak = -99;
  let peakRoom = -1;
  let peakAt = 0;
  const temps: number[][] = [];
  for (let m = 0; m < HORIZON; m++) {
    const mode = c && m >= k2 ? c : k > 0 && m >= k ? b : a;
    for (let i = 0; i < 3; i++) occ[i] = fc.plan[i][m];
    stepPlant(s, mode, ctx.tOut[m], ctx.sun[m], occ, ctx.refs[m], scratch);
    energy += scratch.powerKw / 60;
    for (let i = 0; i < 3; i++) {
      let people = fc.plan[i][m + 1];
      if (people < 1) continue;
      // the first few people through the door count as much as a small group
      people = Math.max(people, 8);
      const over = Math.max(0, s.ta[i] - (COMFORT_HI - MARGIN)) + Math.max(0, COMFORT_LO + COLD_MARGIN - s.ta[i]);
      discomfort += people * over;
      tight += people * Math.max(0, s.ta[i] - (COMFORT_HI - MARGIN - 0.1));
      if (s.ta[i] > peak) {
        peak = s.ta[i];
        peakRoom = i;
        peakAt = m + 1;
      }
    }
    // Reduced airflow is only acceptable while it still ventilates everyone present.
    if (mode === 'REDUCED') {
      const total = occ[0] + occ[1] + occ[2];
      if (total > REDUCED_HEADROOM) discomfort += (total - REDUCED_HEADROOM) * 0.5;
    }
    if ((m + 1) % 15 === 0) temps.push(s.ta.slice());
  }
  // Do not hand the next stretch a warm room that is about to fill up.
  for (let i = 0; i < ROOMS.length; i++) {
    let people = 0;
    for (let m = HORIZON; m <= HORIZON + 20; m += 4) people = Math.max(people, fc.plan[i][m]);
    if (people < 1) continue;
    discomfort += people * Math.max(0, s.ta[i] - (COMFORT_HI - MARGIN)) * 12;
  }
  return { a, b, k, c, k2, energy, discomfort, tight, cost: energy, comfortable: false, peak, peakRoom, peakAt, temps };
}

export interface Plan {
  /** best plan for each first action, best first */
  candidates: Candidate[];
  chosen: number;
  /** what simply holding each mode for the hour would do, for comparison */
  hold: Partial<Record<Mode, Candidate>>;
}

/**
 * Receding-horizon search over the zone's actions. Every candidate runs the same
 * thermal model the twin uses, an hour ahead, on forecast occupancy. Plans are
 * "hold a, switch to b after k minutes", which is enough to express standby
 * followed by a timed pre-cool.
 *
 * The rule is the one in the project brief: of the plans that keep occupied
 * rooms comfortable, recommend the one that uses the least energy. Only the
 * first action is applied; the search runs again a few minutes later.
 */
export function optimise(state: PlantState, t: number, fc: Forecast, prev: Mode, locked = false): Plan {
  const ctx = prepareRollout(t, fc);
  // Pre-cooling only means something while a room is waiting for people, and is still warm.
  const waiting = (m: number) => ctx.refs[m].some((f, i) => f === 1 && (m > 0 || state.ta[i] > MODES.PRECOOL.target + 0.3));
  const all: Candidate[] = [];
  const hold: Plan['hold'] = {};
  for (const a of ACTIONS) {
    const steady = rollout(state, a, a, 0, fc, ctx);
    hold[a] = steady;
    if (a === 'PRECOOL' && !waiting(0)) continue;
    all.push(steady);
    for (const b of ACTIONS) {
      if (a === b) continue;
      for (const k of SWITCH_TIMES) {
        if (b === 'PRECOOL' && !waiting(k)) continue;
        all.push(rollout(state, a, b, k, fc, ctx));
      }
    }
  }
  // Three stages for the one case that needs them: rest, pre-cool, then hand over to the class.
  for (const k of SWITCH_TIMES) {
    if (k > 40 || !waiting(k)) continue;
    for (const run of PRECOOL_RUNS) {
      if (k + run >= HORIZON) continue;
      all.push(rollout(state, 'STANDBY', 'PRECOOL', k, fc, ctx, 'REDUCED', k + run));
      all.push(rollout(state, 'STANDBY', 'PRECOOL', k, fc, ctx, 'NORMAL', k + run));
    }
  }

  const was = prev === 'OFF' ? 'STANDBY' : prev;
  for (const c of all) {
    // Every change of mode is charged, including the one a plan postpones,
    // otherwise "switch in five minutes" would always beat "switch now".
    if (c.k > 0) c.cost += SWITCH_COST;
    if (c.c) c.cost += SWITCH_COST;
    if (c.a !== was) c.cost += SWITCH_COST;
    // Stepping down, now or later in the plan, has to clear a slightly stricter limit than staying put.
    const down = RANK[c.a] < RANK[was] || (c.k > 0 && RANK[c.b] < RANK[c.a]) || (c.c !== null && RANK[c.c] < RANK[c.b]);
    c.comfortable = c.discomfort + (down ? c.tight : 0) <= TOLERANCE;
  }

  // Inside the minimum run time only plans that keep the current mode are considered,
  // unless none of them is comfortable and another plan is.
  let pool = all;
  if (locked) {
    const stay = all.filter((c) => c.a === was);
    if (stay.length && (stay.some((c) => c.comfortable) || !all.some((c) => c.comfortable))) pool = stay;
  }

  const better = (x: Candidate, y: Candidate) => {
    if (x.comfortable !== y.comfortable) return x.comfortable;
    if (x.comfortable) return x.cost < y.cost - 1e-9;
    // Nothing keeps everyone comfortable: get as close as possible, then save energy.
    if (Math.abs(x.discomfort - y.discomfort) > 0.03 * Math.max(x.discomfort, y.discomfort)) return x.discomfort < y.discomfort;
    return x.cost < y.cost - 1e-9;
  };

  let best = pool[0];
  for (const c of pool) if (better(c, best)) best = c;

  // Keep the best plan of each first action, so the alternatives can be shown and explained.
  const shown: Candidate[] = [];
  for (const a of ACTIONS) {
    let top: Candidate | null = null;
    for (const c of all) if (c.a === a && (!top || better(c, top))) top = c;
    if (top) shown.push(top);
  }
  shown.sort((x, y) => (better(x, y) ? -1 : better(y, x) ? 1 : 0));
  let chosen = shown.indexOf(best);
  if (chosen < 0) {
    shown.unshift(best);
    chosen = 0;
  }
  return { candidates: shown, chosen, hold };
}
