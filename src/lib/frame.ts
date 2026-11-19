import { DAY, at, stepAt } from '../state/sim';
import type { Mode, RunSeries } from '../engine/types';

export type Source = 'cool' | 'fixed' | 'tight';

export const runOf = (source: Source): RunSeries => (source === 'cool' ? DAY.cool : source === 'tight' ? DAY.tight : DAY.fixed);

export interface Frame {
  t: number;
  temp: number[];
  occ: number[];
  online: boolean[];
  fan: number;
  duty: number;
  tSupply: number;
  tReturn: number;
  power: number;
  energy: number;
  tOut: number;
  sun: number;
  mode: Mode;
}

export const newFrame = (): Frame => ({
  t: 0,
  temp: [24, 24, 24],
  occ: [0, 0, 0],
  online: [true, true, true],
  fan: 0,
  duty: 0,
  tSupply: 20,
  tReturn: 24,
  power: 0,
  energy: 0,
  tOut: 35,
  sun: 0,
  mode: 'OFF',
});

/** Everything a scene needs to draw one moment of one run. Fills `into` to avoid garbage. */
export function sampleFrame(source: Source, t: number, into: Frame): Frame {
  const run = runOf(source);
  into.t = t;
  for (let i = 0; i < 3; i++) {
    into.temp[i] = at(run.ta[i], t);
    into.occ[i] = at(DAY.occ[i], t);
    into.online[i] = stepAt(DAY.online[i], t) === 1;
  }
  into.fan = stepAt(run.flow, t);
  into.duty = at(run.duty, t);
  into.tSupply = at(run.tSupply, t);
  into.tReturn = at(run.tReturn, t);
  into.power = at(run.power, t);
  into.energy = at(run.energy, t);
  into.tOut = at(DAY.tOut, t);
  into.sun = at(DAY.sun, t);
  into.mode = stepAt(run.mode, t);
  return into;
}

/** Exponential approach, frame-rate independent. */
export const damp = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));
