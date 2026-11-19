import { MODES } from '../engine/config';
import type { Decision } from '../engine/types';
import { MODE_COLOR } from '../lib/color';
import { sub } from './cycle';

const WORD = { pass: 'pass', warn: 'fallback', fix: 'changed' } as const;

/**
 * The gate. Each rule is checked in turn against what is true this minute; a
 * rule that objects rewrites the plan, and the optimiser does not get a say.
 */
export default function SafetyViz({ d, p }: { d: Decision; p: number }) {
  const idle = p < 0;
  const checks = d.safety.checks;
  const n = checks.length;
  const at = idle ? -1 : Math.min(n, Math.floor(sub(p, 0.06, 0.8) * n + 0.0001));
  const scanning = !idle && at < n;
  const focus = scanning ? checks[at] : (checks.find((c) => c.status === 'fix') ?? checks.find((c) => c.status === 'warn') ?? null);
  const approved = !idle && p >= 0.84;

  return (
    <div className={`sf${idle ? ' idle' : ''}`}>
      <ul className="sf-list">
        {checks.map((c, i) => {
          const state = i < at ? c.status : i === at && scanning ? 'now' : 'wait';
          return (
            <li key={c.id} className={`sf-item ${state}`}>
              <span className="sf-mark">
                <svg viewBox="0 0 12 12" width="12" height="12">
                  <circle cx="6" cy="6" r="5" />
                  {state === 'pass' && <path d="M3.4 6.2 5.3 8l3.4-3.8" />}
                  {state === 'warn' && <path d="M6 3.2v3.4M6 8.4v.2" />}
                  {state === 'fix' && <path d="M3.6 6h4.8M6.4 4l2 2-2 2" />}
                </svg>
              </span>
              <span className="sf-label">{c.label}</span>
              <span className="sf-word mono">{state === 'now' ? 'checking' : state === 'wait' ? '' : WORD[c.status]}</span>
            </li>
          );
        })}
      </ul>
      <p className={`sf-note${focus && focus.status !== 'pass' && !scanning ? ' ' + focus.status : ''}`}>{idle ? '' : focus ? focus.detail : 'Every rule passed. The plan goes through unchanged.'}</p>
      <div className={`sf-verdict${approved ? ' on' : ''}`}>
        <span className="mono" style={{ color: MODE_COLOR[d.safety.proposed] }}>
          {MODES[d.safety.proposed].short}
        </span>
        <svg viewBox="0 0 28 10" width="28" height="10" aria-hidden="true">
          <path d="M1 5h24M21 1.5 25 5l-4 3.5" />
        </svg>
        <span className="mono" style={{ color: MODE_COLOR[d.safety.final] }}>
          {MODES[d.safety.final].short}
        </span>
        <em>{d.safety.overridden ? 'changed by the gate' : 'approved'}</em>
      </div>
    </div>
  );
}

export const safetyOut = (d: Decision) =>
  d.safety.overridden ? `changed to ${MODES[d.safety.final].short.toLowerCase()}` : d.safety.fallback ? `${MODES[d.safety.final].short.toLowerCase()} approved, camera fallback on` : `${MODES[d.safety.final].short.toLowerCase()} approved`;
