import { ROOMS, STEPS, SURPRISES, T0, TIMETABLE } from './config';
import type { ClassBlock } from './types';

/** Small deterministic generator so every run of the day is identical. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Share of a class present at time t: people drift in around the start and leave quickly. */
export function presence(t: number, start: number, end: number) {
  return sigmoid((t - (start - 1.5)) / 2.2) * (1 - sigmoid((t - (end + 2)) / 1.4));
}

export function blockAt(room: number, t: number, lead = 0): ClassBlock | null {
  for (const b of TIMETABLE) if (b.room === room && t >= b.start - lead && t < b.end) return b;
  return null;
}

export function nextBlock(room: number, t: number): ClassBlock | null {
  let best: ClassBlock | null = null;
  for (const b of TIMETABLE) {
    if (b.room !== room || b.start <= t) continue;
    if (!best || b.start < best.start) best = b;
  }
  return best;
}

/** What the timetable alone would predict for a room. */
export function timetableExpectation(room: number, t: number) {
  let v = 0;
  for (const b of TIMETABLE) {
    if (b.room !== room) continue;
    if (t < b.start - 20 || t > b.end + 12) continue;
    v += b.enrolled * b.history * presence(t, b.start, b.end);
  }
  return Math.min(ROOMS[room].capacity, v);
}

export interface OccupancyDay {
  occ: Float32Array[];
  est: Float32Array[];
  conf: Float32Array[];
  online: Uint8Array[];
  attendance: number[];
}

/**
 * Ground truth for the simulated day, and what a camera with a person detector
 * would report: a slight undercount in dense rooms, and nothing at all while
 * the feed is down.
 */
export function buildOccupancy(seed = 7): OccupancyDay {
  const rnd = mulberry32(seed);
  const n = STEPS + 1;
  const occ = ROOMS.map(() => new Float32Array(n));
  const est = ROOMS.map(() => new Float32Array(n));
  const conf = ROOMS.map(() => new Float32Array(n));
  const online = ROOMS.map(() => new Uint8Array(n).fill(1));

  const attendance = TIMETABLE.map((b, i) => {
    if (i === SURPRISES.noShowBlock) return 0;
    const share = Math.min(1, Math.max(0.6, b.history + (rnd() - 0.5) * 0.12));
    return Math.round(b.enrolled * share);
  });

  for (let k = 0; k < n; k++) {
    const t = T0 + k;
    for (let r = 0; r < ROOMS.length; r++) {
      let v = 0;
      TIMETABLE.forEach((b, i) => {
        if (b.room !== r) return;
        v += attendance[i] * presence(t, b.start, b.end);
      });
      const s = SURPRISES.surge;
      if (s.room === r) v += s.people * sigmoid((t - s.start) / 1.1) * (1 - sigmoid((t - s.end) / 1.6));
      occ[r][k] = Math.min(ROOMS[r].capacity, Math.round(v));
    }
  }

  const cam = SURPRISES.cameraOut;
  for (let r = 0; r < ROOMS.length; r++) {
    for (let k = 0; k < n; k++) {
      const t = T0 + k;
      const truth = occ[r][k];
      if (cam.room === r && t >= cam.start && t < cam.end) {
        online[r][k] = 0;
        est[r][k] = -1;
        conf[r][k] = 0;
        continue;
      }
      const density = truth / ROOMS[r].capacity;
      const miss = 0.025 + 0.06 * density;
      const jitter = truth > 0 ? Math.round((rnd() - 0.5) * 2.2) : 0;
      est[r][k] = Math.max(0, Math.round(truth * (1 - miss)) + jitter);
      conf[r][k] = Math.min(0.99, Math.max(0.6, 0.97 - 0.11 * density + (rnd() - 0.5) * 0.03));
    }
  }

  return { occ, est, conf, online, attendance };
}
