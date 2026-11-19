import { COMFORT_HI, MODES, fmtTime } from '../engine/config';
import type { Candidate, Decision, Mode } from '../engine/types';
import { MODE_COLOR } from '../lib/color';
import { planStages } from '../ui/DecisionCard';
import { ease, sub } from './cycle';

const W = 232;
const ROW = 50;
const SX = 84;
const SW = 92;
const SH = 26;
const ORDER: Mode[] = ['STANDBY', 'REDUCED', 'NORMAL', 'PRECOOL'];
const T_LO = 21;
const T_HI = 28;

/** Warmest room that has, or is about to have, people in it, at 0, 15, 30, 45 and 60 min. */
function trajectory(d: Decision, c: Candidate) {
  const pts: number[] = [];
  for (let k = 0; k < 5; k++) {
    const temps = k === 0 ? d.temps : c.temps[k - 1];
    const col = k * 3;
    let hot = -99;
    for (let i = 0; i < 3; i++) if (d.forecast.occ[i][Math.min(12, col + 2)] >= 1 || d.forecast.occ[i][col] >= 1) hot = Math.max(hot, temps[i]);
    if (hot < -90) hot = Math.max(...temps);
    pts.push(hot);
  }
  return pts;
}

/**
 * Every action is run an hour ahead in the same thermal model the twin uses.
 * Plans that let an occupied room leave the comfort band are struck out; of
 * the rest, the one that uses the least energy is kept.
 */
export default function OptimizerViz({ d, p }: { d: Decision; p: number }) {
  const idle = p < 0;
  const rows = ORDER.map((m) => d.candidates.find((c) => c.a === m)).filter((c): c is Candidate => !!c);
  const chosen = d.candidates[d.chosen];
  const decided = !idle && p >= 0.8;
  const x = (k: number) => SX + (k / 4) * SW;
  const y = (t: number, top: number) => top + SH - ((Math.min(T_HI, Math.max(T_LO, t)) - T_LO) / (T_HI - T_LO)) * SH;
  const maxE = Math.max(1, ...rows.map((c) => c.energy));

  return (
    <svg viewBox={`0 0 ${W} ${rows.length * ROW + 4}`} className="viz" role="img" aria-label="Candidate plans">
      {rows.map((c, j) => {
        const top = j * ROW + 6;
        const run = idle ? 0 : ease(sub(p, 0.04 + j * 0.15, 0.36 + j * 0.15));
        const traj = trajectory(d, c);
        const shown = run * 4;
        let path = '';
        for (let k = 0; k <= 4; k++) {
          if (k > Math.ceil(shown)) break;
          const f = Math.min(1, shown - (k - 1));
          const tk = k === 0 ? traj[0] : traj[k - 1] + (traj[k] - traj[k - 1]) * Math.max(0, Math.min(1, f));
          const xk = k === 0 ? x(0) : x(k - 1) + (x(k) - x(k - 1)) * Math.max(0, Math.min(1, f));
          path += `${k ? 'L' : 'M'}${xk.toFixed(1)} ${y(tk, top).toFixed(1)}`;
        }
        const done = run >= 1;
        const isChosen = c === chosen;
        const cls = `op-row${decided ? (isChosen ? ' chosen' : ' passed') : ''}${done && !c.comfortable ? ' bad' : ''}`;
        const stages = planStages(c, c.a);
        return (
          <g key={c.a} className={cls}>
            {decided && isChosen && <rect className="op-pick" x={0.5} y={top - 5.5} width={W - 1} height={ROW - 5} rx={3} />}
            <text className="op-name" x={6} y={top + 8} fill={MODE_COLOR[c.a]}>
              {MODES[c.a].short}
            </text>
            {/* the hour as stages of the plan */}
            {stages.map((s, k) => (
              <rect key={k} x={6 + (s.from / 60) * 66} y={top + 14} width={Math.max(1, ((s.to - s.from) / 60) * 66 - 1)} height={4} rx={1} fill={MODE_COLOR[s.mode]} opacity={s.mode === 'STANDBY' ? 0.4 : 0.9} />
            ))}
            <text className="op-then" x={6} y={top + 29}>
              {stages.length > 1 ? `then ${MODES[stages[1].mode].short.toLowerCase()} ${fmtTime(d.t + stages[1].from)}` : 'held for the hour'}
            </text>

            {/* predicted temperature of the room that matters, against the limit */}
            <rect className="op-band" x={SX} y={y(COMFORT_HI, top)} width={SW} height={y(22, top) - y(COMFORT_HI, top)} />
            <line className="op-limit" x1={SX} x2={SX + SW} y1={y(COMFORT_HI, top)} y2={y(COMFORT_HI, top)} />
            {path && <path className="op-traj" d={path} />}
            {run > 0 && run < 1 && <circle className="op-head" cx={x(shown)} cy={y(traj[Math.floor(shown)] + (traj[Math.min(4, Math.floor(shown) + 1)] - traj[Math.floor(shown)]) * (shown % 1), top)} r={2.2} />}

            <g opacity={done ? 1 : 0} className="op-result">
              <text className="op-kwh" x={W - 6} y={top + 9} textAnchor="end">
                {c.energy.toFixed(1)}
                <tspan className="op-unit"> kWh</tspan>
              </text>
              <rect className="op-ebar-bg" x={W - 46} y={top + 14} width={40} height={2.5} rx={1} />
              <rect className="op-ebar" x={W - 46} y={top + 14} width={40 * (c.energy / maxE)} height={2.5} rx={1} />
              <text className="op-verdict" x={W - 6} y={top + 29} textAnchor="end">
                {c.comfortable ? (c.peak > 0 ? `ok · ${c.peak.toFixed(1)}°` : 'ok') : c.peak > COMFORT_HI - 0.3 ? `${c.peak.toFixed(1)}° warm` : 'no'}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

export const optimizerOut = (d: Decision) => {
  const c = d.candidates[d.chosen];
  const stages = planStages(c, c.a);
  return stages.length > 1 ? `${MODES[c.a].short.toLowerCase()}, then ${MODES[stages[1].mode].short.toLowerCase()} at ${fmtTime(d.t + stages[1].from)}` : `hold ${MODES[c.a].short.toLowerCase()} for the hour`;
};
