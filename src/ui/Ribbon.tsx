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
        {flags.map((f, i) => {
          // a flag is centred on its moment unless that would push it off either end
          const x = dayPos(f.t) * width;
          const w = 40 + f.label.length * 6.5;
          const left = Math.min(width - w, Math.max(0, x - w / 2));
          return (
            <button key={f.label} className={`rb-flag${i === active ? ' on' : ''}`} style={{ left, transform: i === active ? 'translateY(-2px)' : 'none', ['--stem' as string]: `${x - left}px`, width: w }} onClick={() => onFlag?.(i)}>
              <b>{i + 1}</b>
              {f.label}
            </button>
          );
        })}
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
          <span key={h} style={{ left: pct(h * 60) }}>
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
