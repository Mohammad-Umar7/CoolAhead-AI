import { MODES, ROOMS, TIMETABLE, fmtTime } from '../engine/config';
import { blockAt, nextBlock } from '../engine/occupancy';
import type { Candidate, Decision, Mode } from '../engine/types';

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

function vision(d: Decision) {
  const lost = ROOMS.filter((_, i) => !d.vision.online[i]).map((r) => r.id);
  const seen = ROOMS.map((r, i) => ({ id: r.id, n: d.vision.online[i] ? (d.vision.count[i] ?? 0) : -1 }));
  const full = seen.filter((s) => s.n >= 1);
  const empty = seen.filter((s) => s.n === 0).map((s) => s.id);
  const total = full.reduce((a, s) => a + s.n, 0);
  if (lost.length) return `The ${list(lost)} camera is down. That counts as "unknown", never as "empty".`;
  if (!full.length) return 'Nobody in any of the three rooms.';
  return `${people(total)} in ${full.length === 1 ? full[0].id : `${full.length} rooms`}.${empty.length ? ` ${list(empty)} ${empty.length > 1 ? 'are' : 'is'} empty.` : ''}`;
}

function forecast(d: Decision) {
  const b = d.forecast.basis;
  let i = b.indexOf('fallback');
  if (i >= 0) return `No camera in ${ROOMS[i].id}, so the timetable and the last count stand in for it.`;
  i = b.indexOf('no-show');
  if (i >= 0) return `${blockAt(i, d.t, 8)?.code ?? 'A class'} is on the timetable but nobody came. ${ROOMS[i].id} stays empty.`;
  i = b.indexOf('unscheduled');
  if (i >= 0) return `Nothing is scheduled in ${ROOMS[i].id}, but the people are real. The forecast keeps them.`;
  const nx = d.forecast.next;
  if (nx && nx.start - d.t <= 60) return `${nx.code} starts in ${ROOMS[nx.room].id} at ${fmtTime(nx.start)}. About ${nx.expected} students are expected.`;
  if (nx) return `Nothing new for the next hour. The next class is at ${fmtTime(nx.start)}.`;
  return 'Nothing else is scheduled today.';
}

function optimizer(d: Decision) {
  const best = d.candidates[d.chosen];
  const anyone = best.peakRoom >= 0;
  return anyone ? `Cheapest plan that keeps every occupied room under 25 °C: ${MODES[best.a].label.toLowerCase()}.` : `Nobody to keep cool, so the cheapest plan wins: ${MODES[best.a].label.toLowerCase()}.`;
}

function safety(d: Decision) {
  const fix = d.safety.checks.find((c) => c.status === 'fix');
  if (fix) return `Overruled: ${fix.label.toLowerCase()} rule. The plan is changed to ${MODES[d.safety.final].label.toLowerCase()}.`;
  if (d.safety.fallback) return 'A camera is down, so cooling is not allowed to step down until it is back.';
  return 'All six safety rules pass.';
}

/** One short sentence per step, in the order the steps speak. */
export const narrate = (d: Decision): string[] => [vision(d), forecast(d), optimizer(d), safety(d), `${MODES[d.mode].label}. ${saving(d)}`];

/** What the next hour holds for one room, in three or four words. */
export function roomOutlook(room: number, d: Decision): { text: string; flag: boolean } {
  const basis = d.forecast.basis[room];
  const occ = d.forecast.occ[room];
  const now = occ[0];
  const end = occ[occ.length - 1];
  const peak = Math.max(...occ);
  if (basis === 'fallback') return { text: `Assumed occupied: about ${Math.round(now)} inside`, flag: true };
  if (basis === 'no-show') return { text: 'Class did not show up: stays empty', flag: true };
  if (basis === 'unscheduled') return { text: 'Not on the timetable: kept in the plan', flag: true };
  const cur = blockAt(room, d.t, 0);
  if (now >= 1 && end < 1) return { text: cur ? `Empties at ${fmtTime(cur.end)}` : 'Empties within the hour', flag: false };
  if (now >= 1) return { text: 'Stays in use all hour', flag: false };
  if (peak >= 1) {
    const nx = nextBlock(room, d.t - 1);
    return { text: nx ? `${nx.code} arrives at ${fmtTime(nx.start)}` : 'People expected soon', flag: false };
  }
  return { text: 'Stays empty', flag: false };
}

/** The one consequence worth saying out loud. */
export function saving(d: Decision): string {
  const best = d.candidates[d.chosen];
  const normal = d.hold.NORMAL;
  const saved = normal ? normal.energy - best.energy : 0;
  if (d.safety.fallback) return 'Safe mode until the camera is back.';
  if (d.mode === 'PRECOOL') return 'The room is ready when people walk in.';
  if (saved > 0.15) return `Saves about ${saved.toFixed(1)} kWh this hour.`;
  if (d.mode === 'NORMAL') return 'Full airflow keeps every room comfortable.';
  return 'Nothing is wasted on empty rooms.';
}

export interface PlanRow {
  mode: Mode;
  c: Candidate;
  chosen: boolean;
}

/** The four ways the zone can run for the next hour, each as the optimizer scored it. */
export function plans(d: Decision): PlanRow[] {
  const order: Mode[] = ['STANDBY', 'REDUCED', 'NORMAL', 'PRECOOL'];
  const first = d.candidates[d.chosen].a;
  return order.filter((m) => d.hold[m]).map((m) => ({ mode: m, c: m === first ? d.candidates[d.chosen] : d.hold[m]!, chosen: m === first }));
}

/** The conversation of one decision: what the orchestrator asks each specialist, and what comes back. */
export function script(d: Decision) {
  return {
    ask: [
      'How many people are in each room right now?',
      'What does the next hour look like?',
      'What is the cheapest way to keep everyone comfortable?',
      `Is ${MODES[d.safety.proposed].label.toLowerCase()} safe right now?`,
    ],
    answer: narrate(d).slice(0, 4),
    final: `${MODES[d.mode].label}. ${saving(d)}`,
  };
}

export interface Slot {
  /** minutes from now, 0..60 */
  from: number;
  to: number;
  label: string;
  kind: 'class' | 'noshow' | 'unlisted';
}

/** The next hour of one room as the timetable lists it, marked up with what the cameras found. */
export function nextHour(room: number, d: Decision): Slot[] {
  const basis = d.forecast.basis[room];
  const out: Slot[] = [];
  for (const b of TIMETABLE) {
    if (b.room !== room || b.end <= d.t || b.start >= d.t + 60) continue;
    const running = b.start <= d.t;
    out.push({ from: Math.max(0, b.start - d.t), to: Math.min(60, b.end - d.t), label: b.code, kind: running && basis === 'no-show' ? 'noshow' : 'class' });
  }
  if (basis === 'unscheduled') out.push({ from: 0, to: 34, label: 'not listed', kind: 'unlisted' });
  return out;
}

/** The forecast in four or five words. */
export function forecastWord(d: Decision): { text: string; flag: boolean } {
  const b = d.forecast.basis;
  let i = b.indexOf('fallback');
  if (i >= 0) return { text: `${ROOMS[i].id} assumed occupied`, flag: true };
  i = b.indexOf('no-show');
  if (i >= 0) return { text: `No-show: ${ROOMS[i].id} stays empty`, flag: true };
  i = b.indexOf('unscheduled');
  if (i >= 0) return { text: `Unlisted crowd in ${ROOMS[i].id}`, flag: true };
  const nx = d.forecast.next;
  if (nx && nx.start - d.t <= 60) return { text: `${nx.code} at ${fmtTime(nx.start)}, about ${nx.expected} people`, flag: false };
  return { text: 'No change expected', flag: false };
}
