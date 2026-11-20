import { create } from 'zustand';
import { VIEW_START, hm } from '../engine/config';
import type { Decision } from '../engine/types';
import { DAY, useSim } from '../state/sim';

/**
 * One decision is a short conversation. The orchestrator asks each specialist
 * in turn, waits for its answer, and passes that answer on to the next one.
 * In the engine this is the control loop in simulate.ts: it calls the vision,
 * forecast, optimiser and safety modules in this order, every five minutes or
 * the moment a count jumps or a camera drops.
 */
export const AGENTS = [
  { id: 'vision', name: 'Vision' },
  { id: 'forecast', name: 'Forecast' },
  { id: 'optimizer', name: 'Optimizer' },
  { id: 'safety', name: 'Safety' },
] as const;

export type Kind = 'boot' | 'ask' | 'work' | 'answer' | 'send' | 'show' | 'rest';

export interface Phase {
  kind: Kind;
  /** the specialist involved; -1 before anyone is asked, 4 for the recommendation going out */
  agent: number;
  from: number;
  to: number;
}

/** How long the orchestrator takes to start, each specialist to work, and a message to travel, in milliseconds. */
const BOOT = 1700;
const WORK = [5100, 2600, 3400, 2400];
const TRAVEL = 700;
const SHOW = 2600;
const REST = 3000;

export const PHASES: Phase[] = (() => {
  const out: Phase[] = [{ kind: 'boot', agent: -1, from: 0, to: BOOT }];
  let t = BOOT;
  WORK.forEach((w, agent) => {
    out.push({ kind: 'ask', agent, from: t, to: (t += TRAVEL) });
    out.push({ kind: 'work', agent, from: t, to: (t += w) });
    out.push({ kind: 'answer', agent, from: t, to: (t += TRAVEL) });
  });
  out.push({ kind: 'send', agent: 4, from: t, to: (t += TRAVEL) });
  out.push({ kind: 'show', agent: 4, from: t, to: (t += SHOW) });
  out.push({ kind: 'rest', agent: 4, from: t, to: (t += REST) });
  return out;
})();
export const CYCLE_MS = PHASES[PHASES.length - 1].to;

const find = (kind: Kind, agent: number) => PHASES.find((p) => p.kind === kind && p.agent === agent)!;
const within = (p: Phase, time: number) => Math.min(1, Math.max(0, (time - p.from) / (p.to - p.from)));

export function phaseAt(time: number): Phase {
  return PHASES.find((p) => time < p.to) ?? PHASES[PHASES.length - 1];
}

/** Where a specialist is in its own work: below 0 not asked yet, 0..1 working, 1 done. For 4, the recommendation appearing. */
export function progress(agent: number, time: number) {
  const p = find(agent === 4 ? 'show' : 'work', agent);
  return time < p.from ? -1 : within(p, time);
}

/** How far a message has travelled, 0..1: the question going out to a specialist, its answer coming back, the recommendation leaving. */
export const asked = (agent: number, time: number) => within(find('ask', agent), time);
export const answered = (agent: number, time: number) => within(find('answer', agent), time);
export const sent = (time: number) => within(find('send', 4), time);

/** The moment each part of the picture is first needed. On the first pass nothing is drawn before its moment. */
export const CUE = {
  rail: find('ask', 0).from,
  forecast: find('ask', 1).from,
  optimizer: find('ask', 2).from,
  safety: find('ask', 3).from,
  verdict: find('send', 4).from,
  foot: find('rest', 4).from,
};

/**
 * The outer loop. Some situations are not settled by the cooling alone: a
 * cancelled class, a crowd nobody booked, a dead camera. Once the
 * recommendation is out, the orchestrator calls a liaison agent, and that agent
 * talks to the department that has to know. Nothing here touches the air
 * handler. The departments are simulated.
 */
export const OUTREACH = new Set(['noshow', 'surge', 'camera']);
/** Of those, the ones whose answer changes what Forecast knows: the orchestrator passes it on. */
export const FEEDS = new Set(['noshow', 'surge']);

const T = CUE.foot;
export const TALK = {
  /** the orchestrator calls the liaison agent; a message runs to the tile */
  call: T,
  /** the camera tile turns over into the conversation */
  turn: T + TRAVEL,
  /** each line of the conversation lands; the dots show for `dots` before it */
  say: [T + 2700, T + 6000, T + 8700],
  dots: [900, 1150, 800],
  /** the outcome; it runs back to the orchestrator */
  done: T + 10300,
  /** the orchestrator repeats what came back */
  report: T + 10300 + TRAVEL,
  end: T + 13600,
  travel: TRAVEL,
};

/** Where the conversation with a department has got to. */
export function talkAt(time: number) {
  const shown = TALK.say.filter((at) => time >= at).length;
  const next = shown < TALK.say.length ? shown : -1;
  return {
    called: time >= TALK.call,
    turned: time >= TALK.turn,
    shown,
    /** the line being typed, or -1 */
    typing: next >= 0 && time >= TALK.say[next] - TALK.dots[next] ? next : -1,
    done: time >= TALK.done,
    reported: time >= TALK.report,
    /** the call going out and the outcome coming back, 0..1 */
    out: Math.min(1, Math.max(0, (time - TALK.call) / TRAVEL)),
    back: Math.min(1, Math.max(0, (time - TALK.done) / TRAVEL)),
    /** the orchestrator passing the answer on to Forecast, 0..1, and Forecast having it */
    fed: Math.min(1, Math.max(0, (time - TALK.report) / TRAVEL)),
    told: time >= TALK.report + TRAVEL,
  };
}

/**
 * Vision checks the rooms one at a time. For a room: below 0 not checked yet,
 * 0..1 being checked, 1 done.
 */
export function roomCheck(room: number, time: number) {
  const p = progress(0, time);
  if (p < 0) return -1;
  const q = p * 3 - room;
  return q < 0 ? -1 : Math.min(1, q);
}

export const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** Progress of a sub-step that occupies [a, b] of a phase. */
export const sub = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));

/** The situations the day was built to contain. Each one is a stop on the tour. */
export interface Scene {
  id: string;
  flag: string;
  title: string;
  /** index into DAY.decisions */
  decision: number;
  t: number;
}

const TITLES: Record<string, { flag: string; title: string }> = {
  precool: { flag: 'Upcoming lecture', title: 'A lecture starts in half an hour and the rooms are still warm.' },
  noshow: { flag: 'One room empty', title: 'One class never showed up. The other two rooms are full.' },
  allempty: { flag: 'All rooms empty', title: 'Every room on the air handler is empty.' },
  surge: { flag: 'Sudden crowd', title: 'A crowd walks in that the timetable knows nothing about.' },
  camera: { flag: 'Camera failure', title: 'A camera goes dark in the middle of a class.' },
  evening: { flag: 'Late class', title: 'One small class runs late. The other two rooms are empty.' },
};

const sceneAt = (id: string, flag: string, title: string, t: number): Scene => {
  const d = DAY.decisions;
  let i = d.findIndex((x) => x.t >= t);
  if (i < 0) i = d.length - 1;
  return { id, flag, title, decision: i, t: d[i].t };
};

/**
 * The tour opens on an ordinary busy moment, with a class in every room, so the
 * first thing on screen is people being counted. The situations the day was
 * built to test follow in the order they happen.
 */
export const SCENES: Scene[] = [
  sceneAt('full', 'Every room in use', 'Three classes are in session. How hard should the air handler work?', hm(9, 8)),
  ...DAY.events.map((ev) => sceneAt(ev.id, TITLES[ev.id].flag, TITLES[ev.id].title, ev.t)),
];

/** When a situation has played out: after the recommendation, or after the talk with a department where there is one. */
export const endOf = (scene: number) => (OUTREACH.has(SCENES[scene].id) ? TALK.end : CYCLE_MS);

interface CycleState {
  scene: number;
  /** index into DAY.decisions */
  decision: number;
  /** milliseconds into the conversation */
  time: number;
  playing: boolean;
  /** the first pass after arriving: the picture builds up piece by piece */
  first: boolean;
  /** start over from the top, as on the first visit or Replay */
  enter: () => void;
  /** the page is opened: the first visit starts from the top, a later one finds the decision where it was left */
  arrive: () => void;
  go: (scene: number) => void;
  step: (dir: number) => void;
  toggle: () => void;
}

const pin = (scene: number) => useSim.getState().jump(Math.max(VIEW_START, SCENES[scene].t) + 0.01, false);
let arrived = false;

export const useCycle = create<CycleState>((set, get) => ({
  scene: 0,
  decision: SCENES[0].decision,
  time: 0,
  playing: true,
  first: true,
  enter: () => {
    pin(get().scene);
    set({ decision: SCENES[get().scene].decision, time: 0, playing: true, first: true });
  },
  arrive: () => {
    if (!arrived) {
      arrived = true;
      get().enter();
      return;
    }
    // the twin moves the shared day clock, so put it back on this decision; the picture itself is left alone
    pin(get().scene);
  },
  go: (scene) => {
    const s = ((scene % SCENES.length) + SCENES.length) % SCENES.length;
    pin(s);
    // later passes skip most of the start-up pause
    set({ scene: s, decision: SCENES[s].decision, time: BOOT - 600, playing: true, first: false });
  },
  step: (dir) => get().go(get().scene + dir),
  toggle: () => {
    const s = get();
    if (!s.playing && s.time >= endOf(s.scene) - 1) s.enter();
    else set({ playing: !s.playing });
  },
}));

export const currentDecision = (i: number): Decision => DAY.decisions[i];

/**
 * Drives the conversation while the page is mounted. When a decision has played
 * out, `done` is told which situation it was, and the clock stops there.
 */
export function runCycle(done: (scene: number) => void) {
  let raf = 0;
  let last = 0;
  const tick = (now: number) => {
    const dt = last ? Math.min(80, now - last) : 0;
    last = now;
    const s = useCycle.getState();
    if (s.playing) {
      const time = s.time + dt;
      const end = endOf(s.scene);
      if (time >= end) {
        useCycle.setState({ time: end, playing: false });
        done(s.scene);
      } else useCycle.setState({ time });
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/** A specialist's progress in coarse steps, so its card redraws a few dozen times while it works and not at all otherwise. */
export const useProgress = (agent: number, steps = 40) => useCycle((s) => Math.round(progress(agent, s.time) * steps) / steps);

/** True once a part of the picture has been called for in this decision. */
export const useCue = (at: number) => useCycle((s) => s.time >= at);
/** The same, for the parts that stay once they have appeared. */
export const useOnce = (at: number) => useCycle((s) => !s.first || s.time >= at);
