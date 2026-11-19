import { create } from 'zustand';
import type { Decision } from '../engine/types';
import { VIEW_START } from '../engine/config';
import { DAY, useSim } from '../state/sim';

export const AGENTS = [
  { id: 'vision', name: 'Vision', step: 'Monitor', line: 'Counts people in each room. Recognises no one.', hands: 'head counts, confidence, feed status' },
  { id: 'forecast', name: 'Forecast', step: 'Analyze', line: 'Blends the counts with the timetable, past attendance and weather.', hands: 'occupancy and cooling demand, next 60 min' },
  { id: 'optimizer', name: 'Optimizer', step: 'Optimize', line: 'Runs every action through the thermal model. Keeps the cheapest that stays comfortable.', hands: 'proposed plan' },
  { id: 'safety', name: 'Safety', step: 'Check', line: 'Six rules that only look at what is true right now. They win.', hands: 'approved plan' },
  { id: 'report', name: 'Report', step: 'Report', line: 'Writes the recommendation and the reason in plain words.', hands: 'recommendation for the facilities team' },
] as const;

/** One pass through the pipeline, in milliseconds at 1x. */
const WORK = [2700, 2900, 3700, 2900, 3300];
const HOP = 700;
const RETURN = 2300;
const REST = 1100;

export interface Segment {
  kind: 'work' | 'hop' | 'return' | 'rest';
  agent: number;
  from: number;
  to: number;
}

export const SEGMENTS: Segment[] = (() => {
  const out: Segment[] = [];
  let t = 0;
  WORK.forEach((w, i) => {
    out.push({ kind: 'work', agent: i, from: t, to: (t += w) });
    if (i < WORK.length - 1) out.push({ kind: 'hop', agent: i, from: t, to: (t += HOP) });
  });
  out.push({ kind: 'return', agent: 4, from: t, to: (t += RETURN) });
  out.push({ kind: 'rest', agent: 4, from: t, to: (t += REST) });
  return out;
})();
export const CYCLE_MS = SEGMENTS[SEGMENTS.length - 1].to;

/** The decisions worth stopping at: wherever the mode or the kind of reasoning changes. */
export const KEYS: number[] = (() => {
  const d = DAY.decisions;
  const out: number[] = [];
  for (let i = 1; i < d.length; i++) {
    const prev = d[i - 1];
    if (d[i].t < VIEW_START) continue;
    if (d[i].mode !== prev.mode || d[i].report.tag !== prev.report.tag || d[i].safety.fallback !== prev.safety.fallback) out.push(i);
  }
  for (const ev of DAY.events) {
    const i = d.findIndex((x) => x.t >= ev.t);
    if (i >= 0 && !out.includes(i)) out.push(i);
  }
  return out.sort((a, b) => a - b);
})();

const keyAt = (t: number) => {
  let best = 0;
  for (let k = 0; k < KEYS.length; k++) if (DAY.decisions[KEYS[k]].t <= t + 0.5) best = k;
  return best;
};

interface CycleState {
  cursor: number;
  /** milliseconds into the pass */
  time: number;
  playing: boolean;
  /** move on to the next key decision when a pass ends */
  tour: boolean;
  speed: number;
  go: (cursor: number) => void;
  goTime: (t: number) => void;
  step: (dir: number) => void;
  toggle: () => void;
  replay: () => void;
  setSpeed: (s: number) => void;
  setTour: (t: boolean) => void;
  seek: (ms: number) => void;
}

export const useCycle = create<CycleState>((set, get) => ({
  cursor: keyAt(useSim.getState().t),
  time: 0,
  playing: true,
  tour: true,
  speed: 1,
  go: (cursor) => {
    const c = ((cursor % KEYS.length) + KEYS.length) % KEYS.length;
    useSim.getState().jump(DAY.decisions[KEYS[c]].t + 0.01, false);
    set({ cursor: c, time: 0, playing: true });
  },
  goTime: (t) => get().go(keyAt(t)),
  step: (dir) => get().go(get().cursor + dir),
  toggle: () => {
    const s = get();
    if (!s.playing && s.time >= CYCLE_MS - 1) set({ time: 0, playing: true });
    else set({ playing: !s.playing });
  },
  replay: () => set({ time: 0, playing: true }),
  setSpeed: (speed) => set({ speed }),
  setTour: (tour) => set({ tour }),
  seek: (ms) => set({ time: Math.min(CYCLE_MS, Math.max(0, ms)) }),
}));

export const currentDecision = (cursor: number): Decision => DAY.decisions[KEYS[cursor]];

let raf = 0;
let last = 0;
/** Drives the pass while the Agents page is mounted. */
export function runCycle() {
  last = 0;
  const tick = (now: number) => {
    const dt = last ? Math.min(80, now - last) : 0;
    last = now;
    const s = useCycle.getState();
    if (s.playing) {
      const time = s.time + dt * s.speed;
      if (time >= CYCLE_MS) {
        if (s.tour) s.go(s.cursor + 1);
        else useCycle.setState({ time: CYCLE_MS, playing: false });
      } else useCycle.setState({ time });
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/** Where a given agent is in its own work: below 0 waiting, 0..1 working, 1 done. */
export function agentProgress(agent: number, time: number) {
  const seg = SEGMENTS.find((s) => s.kind === 'work' && s.agent === agent)!;
  if (time < seg.from) return -1;
  return Math.min(1, (time - seg.from) / (seg.to - seg.from));
}

export function activeSegment(time: number): Segment & { p: number } {
  const seg = SEGMENTS.find((s) => time < s.to) ?? SEGMENTS[SEGMENTS.length - 1];
  return { ...seg, p: Math.min(1, Math.max(0, (time - seg.from) / (seg.to - seg.from))) };
}

export const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** Progress of a sub-step that occupies [a, b] of a phase. */
export const sub = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));
