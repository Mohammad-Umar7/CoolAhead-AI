import type { Decision } from '../engine/types';
import { ModeBadge } from '../ui/DecisionCard';
import { sub } from './cycle';

const typed = (text: string, f: number) => text.slice(0, Math.round(text.length * Math.min(1, Math.max(0, f))));

/**
 * The recommendation as the facilities team would read it. It is written from
 * the numbers the other agents produced, by rule, so the same inputs always
 * give the same words.
 */
export default function ReportViz({ d, p }: { d: Decision; p: number }) {
  const idle = p < 0;
  const head = idle ? '' : typed(d.report.headline, sub(p, 0.04, 0.3));
  const body = idle ? '' : typed(d.report.reason, sub(p, 0.28, 0.82));
  const writing = !idle && p < 0.82;
  return (
    <div className={`rp${idle ? ' idle' : ''}`}>
      <div className="rp-badge" style={{ opacity: idle ? 0.25 : 1 }}>
        <ModeBadge mode={d.mode} size="sm" />
      </div>
      <h3 className="rp-head">
        {head}
        {writing && sub(p, 0.04, 0.3) < 1 && <i className="rp-caret" />}
      </h3>
      <p className="rp-body">
        {body}
        {writing && sub(p, 0.04, 0.3) >= 1 && <i className="rp-caret" />}
      </p>
    </div>
  );
}

export const reportOut = () => 'shown to the facilities team';
