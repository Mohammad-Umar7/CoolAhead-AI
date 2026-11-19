import { useEffect, useRef } from 'react';
import { VIEW_END, VIEW_START, fmtTime } from '../engine/config';
import { DAY, SPEEDS, useSim } from '../state/sim';

const pos = (t: number) => ((t - VIEW_START) / (VIEW_END - VIEW_START)) * 100;

/** A slim transport for pages where the day is not the main subject: play, drag, jump to an event. */
export default function Scrubber() {
  const playing = useSim((s) => s.playing);
  const speed = useSim((s) => s.speed);
  const toggle = useSim((s) => s.toggle);
  const setSpeed = useSim((s) => s.setSpeed);
  const track = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLElement>(null);
  const knob = useRef<HTMLElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const drag = useRef(false);

  useEffect(() => {
    const apply = (t: number) => {
      const p = `${pos(t).toFixed(2)}%`;
      if (fill.current) fill.current.style.width = p;
      if (knob.current) knob.current.style.left = p;
      if (clock.current) clock.current.textContent = fmtTime(Math.floor(t));
    };
    apply(useSim.getState().t);
    return useSim.subscribe((s) => apply(s.t));
  }, []);

  const seek = (clientX: number) => {
    const box = track.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    useSim.getState().set(VIEW_START + f * (VIEW_END - VIEW_START));
  };

  return (
    <div className="scrubber panel">
      <button className="tl-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? (
          <svg viewBox="0 0 16 16" width="16" height="16">
            <rect x="3" y="2" width="3.6" height="12" rx="0.6" />
            <rect x="9.4" y="2" width="3.6" height="12" rx="0.6" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="16" height="16">
            <path d="M4 2.2v11.6a.6.6 0 0 0 .92.5l9.1-5.8a.6.6 0 0 0 0-1l-9.1-5.8a.6.6 0 0 0-.92.5Z" />
          </svg>
        )}
      </button>
      <span className="sc-clock num" ref={clock}>
        07:00
      </span>

      <div className="sc-main">
        <div className="sc-events">
          {DAY.events.map((ev) => (
            <button key={ev.id} style={{ left: `${pos(ev.t)}%` }} onClick={() => useSim.getState().jump(ev.t - 2, true)} title={`${ev.label}. ${ev.note}`}>
              {ev.short}
            </button>
          ))}
        </div>
        <div
          className="sc-track"
          ref={track}
          onPointerDown={(e) => {
            drag.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            seek(e.clientX);
          }}
          onPointerMove={(e) => drag.current && seek(e.clientX)}
          onPointerUp={() => (drag.current = false)}
          onPointerCancel={() => (drag.current = false)}
        >
          <i className="sc-fill" ref={fill} />
          <i className="sc-knob" ref={knob} />
        </div>
        <div className="sc-hours mono">
          {[7, 9, 11, 13, 15, 17, 19].map((h) => (
            <span key={h} style={{ left: `${pos(h * 60)}%` }}>
              {String(h).padStart(2, '0')}
            </span>
          ))}
        </div>
      </div>

      <div className="seg sc-speed">
        {SPEEDS.map((s) => (
          <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)} title={`${s} simulated minute${s > 1 ? 's' : ''} per second`}>
            {s * 60}×
          </button>
        ))}
      </div>
    </div>
  );
}
