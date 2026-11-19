import { MODES, fmtTime } from '../engine/config';
import { decisionAt } from '../engine/simulate';
import type { Candidate, Mode } from '../engine/types';
import { MODE_COLOR } from '../lib/color';
import { DAY, useMinute } from '../state/sim';

/** The chosen plan as stages across the next hour. */
export function planStages(c: Candidate, first: Mode): { mode: Mode; from: number; to: number }[] {
  const stages: { mode: Mode; from: number; to: number }[] = [];
  const cuts: [number, Mode][] = [[0, first]];
  if (c.k > 0 && c.b !== first) cuts.push([c.k, c.b]);
  if (c.c && c.k2 > 0) cuts.push([c.k2, c.c]);
  cuts.forEach(([from, mode], i) => stages.push({ mode, from, to: i + 1 < cuts.length ? cuts[i + 1][0] : 60 }));
  return stages;
}

export function ModeBadge({ mode, size = 'md' }: { mode: Mode; size?: 'sm' | 'md' }) {
  return (
    <span className={`mode-badge mode-badge-${size}`} style={{ '--c': MODE_COLOR[mode] } as React.CSSProperties}>
      <span className="dot" />
      {MODES[mode].short}
    </span>
  );
}

/** What CoolAhead recommends right now, and why. */
export default function DecisionCard() {
  const minute = useMinute();
  const d = decisionAt(DAY, minute);
  const stages = planStages(d.candidates[d.chosen], d.mode);
  const issues = d.safety.checks.filter((c) => c.status !== 'pass');

  return (
    <section className="panel decision">
      <header className="decision-head">
        <span className="label">Recommendation</span>
        <span className="label mono">decided {fmtTime(d.t)}</span>
      </header>

      <ModeBadge mode={d.mode} />
      <h2 className="decision-title">{d.report.headline}</h2>
      <p className="decision-reason">{d.report.reason}</p>

      {d.report.facts.length > 0 && (
        <ul className="decision-facts">
          {d.report.facts.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}

      <div className="decision-plan">
        <span className="label">Plan for the next hour</span>
        <div className="plan-strip">
          {stages.map((s, i) => (
            <div key={i} className="plan-seg" style={{ flex: s.to - s.from, '--c': MODE_COLOR[s.mode] } as React.CSSProperties}>
              <span>{MODES[s.mode].short}</span>
            </div>
          ))}
        </div>
        <div className="plan-axis mono">
          <span>{fmtTime(d.t)}</span>
          {stages.slice(1).map((s, i) => (
            <span key={i} style={{ left: `${(s.from / 60) * 100}%` }} className="plan-tick">
              {fmtTime(d.t + s.from)}
            </span>
          ))}
          <span>{fmtTime(d.t + 60)}</span>
        </div>
      </div>

      <div className="decision-safety">
        <span className="label">Safety check</span>
        <div className="safety-dots">
          {d.safety.checks.map((c) => (
            <span key={c.id} className={`safety-dot ${c.status}`} title={`${c.label}: ${c.detail}`} />
          ))}
          <span className="safety-word mono">{issues.length ? issues.map((c) => c.label).join(', ') : 'all clear'}</span>
        </div>
      </div>
    </section>
  );
}
