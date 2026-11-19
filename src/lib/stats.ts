import { ROOMS } from '../engine/config';
import { DAY } from '../state/sim';
import { runOf, type Source } from './frame';

export interface Derived {
  /** occupied room-minutes outside the comfort band, cumulative */
  outMin: Float32Array;
  /** air temperature of the warmest room with people in it, NaN while the zone is empty */
  warm: Float32Array;
}

const cache = new Map<Source, Derived>();

/** Series the comparison charts need that the engine does not keep per minute. */
export function derived(source: Source): Derived {
  const hit = cache.get(source);
  if (hit) return hit;
  const run = runOf(source);
  const n = DAY.steps + 1;
  const outMin = new Float32Array(n);
  const warm = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let out = 0;
    let hot = NaN;
    for (let i = 0; i < ROOMS.length; i++) {
      out += run.outOfBand[i][k];
      if (DAY.occ[i][k] >= 1 && !(hot >= run.ta[i][k])) hot = run.ta[i][k];
    }
    outMin[k] = (k ? outMin[k - 1] : 0) + out;
    warm[k] = hot;
  }
  const d = { outMin, warm };
  cache.set(source, d);
  return d;
}
