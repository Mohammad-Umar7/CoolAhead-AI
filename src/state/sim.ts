import { create } from 'zustand';
import { T0, VIEW_END, VIEW_START, hm } from '../engine/config';
import { simulateDay } from '../engine/simulate';
import type { DayResult } from '../engine/types';

/** The whole simulated day, computed once in the browser when the app starts. */
export const DAY: DayResult = simulateDay();

/** Simulated minutes per real second. */
export const SPEEDS = [1, 4, 12, 40] as const;

interface SimState {
  /** minutes since midnight, fractional */
  t: number;
  playing: boolean;
  speed: number;
  set: (t: number) => void;
  jump: (t: number, play?: boolean) => void;
  toggle: () => void;
  setSpeed: (s: number) => void;
}

const clampT = (t: number) => Math.min(VIEW_END, Math.max(VIEW_START, t));

export const useSim = create<SimState>((set, get) => ({
  t: hm(7, 24),
  playing: true,
  speed: 4,
  set: (t) => set({ t: clampT(t) }),
  jump: (t, play) => set({ t: clampT(t), playing: play ?? get().playing }),
  toggle: () => {
    const s = get();
    // pressing play at the end of the day starts it again
    if (!s.playing && s.t >= VIEW_END - 0.5) set({ t: VIEW_START, playing: true });
    else set({ playing: !s.playing });
  },
  setSpeed: (speed) => set({ speed }),
}));

/** Index into the per-minute series for a time of day. */
export const idx = (t: number) => Math.min(DAY.steps, Math.max(0, t - T0));

/** Linear interpolation of a per-minute series at time t. */
export function at(series: ArrayLike<number>, t: number) {
  const x = idx(t);
  const i = Math.floor(x);
  const f = x - i;
  const a = series[i];
  const b = series[Math.min(DAY.steps, i + 1)];
  return a + (b - a) * f;
}

/** Value of a per-minute series at the minute containing t (for things that step). */
export function stepAt<T>(series: ArrayLike<T>, t: number): T {
  return series[Math.floor(idx(t))];
}

let raf = 0;
let last = 0;

/** One clock for the whole app: every page reads the same moment of the day. */
export function startClock() {
  if (raf) return;
  const tick = (now: number) => {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    const s = useSim.getState();
    if (s.playing) {
      const next = s.t + s.speed * dt;
      if (next >= VIEW_END) useSim.setState({ t: VIEW_END, playing: false });
      else useSim.setState({ t: next });
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

/** Re-render a component once per simulated minute rather than every frame. */
export const useMinute = () => useSim((s) => Math.floor(s.t));
