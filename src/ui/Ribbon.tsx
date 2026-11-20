import { useMemo, useRef } from 'react';
import { VIEW_END, VIEW_START, fmtTime } from '../engine/config';
import { HOURS, MODE_LABEL, dayPos, modeSpans } from '../lib/day';
import { pointerX } from '../lib/fit';

export interface Flag {
  label: string;
  t: number;
}

interface Props {
  /** width in layout pixels */
  width: number;
  /** time of day the cursor sits at */
  t: number;
  flags?: Flag[];
  active?: number;
  onFlag?: (i: number) => void;
  /** called with a time of day when the ribbon is clicked or dragged */
  onPick?: (t: number) => void;
}

/** Lay the flags out left to right; one that would run into the flag before it shows only its number. */
function placeFlags(flags: Flag[], width: number) {
  let edge = -Infinity;
  return flags.map((f) => {
    const x = dayPos(f.t) * width;
    let w = 40 + f.label.length * 6.5;
    let left = Math.min(width - w, Math.max(0, x - w / 2));
    let compact = false;
    if (left < edge + 6) {
      compact = true;
      w = 26;
      left = Math.min(width - w, Math.max(edge + 6, x - w / 2));
    }
    edge = left + w;
    return { ...f, x, w, left, compact };
  });
}

/** The day from 07:00 to 19:00 as one strip, coloured by how CoolAhead runs the zone, with the test situations flagged on it. */
export default function Ribbon({ width, t, flags = [], active = -1, onFlag, onPick }: Props) {
  const spans = useMemo(() => modeSpans(), []);
  const track = useRef<HTMLDivElement>(null);
  const pct = (v: number) => `${(dayPos(v) * 100).toFixed(3)}%`;

  const pick = (clientX: number) => {
    if (!track.current || !onPick) return;
    const x = Math.min(width, Math.max(0, pointerX(track.current, clientX, width)));
    onPick(VIEW_START + (x / width) * (VIEW_END - VIEW_START));
  };

  return (
    <div className="ribbon" style={{ width }}>
      <div className="rb-flags">
        {placeFlags(flags, width).map((f, i) => (
          <button
            key={f.label}
            className={`rb-flag${i === active ? ' on' : ''}${f.compact ? ' compact' : ''}`}
            style={{ left: f.left, width: f.w, ['--stem' as string]: `${f.x - f.left}px` }}
            onClick={() => onFlag?.(i)}
            title={f.label}
          >
            <b>{i + 1}</b>
            {f.compact ? '' : f.label}
          </button>
        ))}
      </div>
      <div
        className="rb-track"
        ref={track}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e.clientX);
        }}
        onPointerMove={(e) => e.buttons === 1 && pick(e.clientX)}
      >
        {spans.map((s, i) => (
          <i key={i} className="rb-seg" data-mode={s.mode} title={`${MODE_LABEL[s.mode]} ${fmtTime(s.from)} to ${fmtTime(s.to)}`} style={{ left: pct(s.from), width: `calc(${pct(s.to)} - ${pct(s.from)})` }} />
        ))}
      </div>
      <div className="rb-cursor" style={{ left: pct(t) }} data-t={fmtTime(t)} />
      <div className="rb-hours">
        {HOURS.map((h) => (
          <span key={h} className={Math.abs(h * 60 - t) < 34 ? 'near' : undefined} style={{ left: pct(h * 60) }}>
            {String(h).padStart(2, '0')}:00
          </span>
        ))}
      </div>
    </div>
  );
}

export function ModeLegend() {
  return (
    <div className="legend">
      {(['STANDBY', 'PRECOOL', 'REDUCED', 'NORMAL'] as const).map((m) => (
        <span key={m} data-mode={m}>
          <i />
          {MODE_LABEL[m]}
        </span>
      ))}
    </div>
  );
}
