import { useEffect, useMemo, useRef, useState } from 'react';
import { FIXED, FIXED_TIGHT, MODES, ROOMS, SURPRISES, T0, TIMETABLE, VIEW_END, VIEW_START, fmtTime } from '../engine/config';
import type { Mode } from '../engine/types';
import { MODE_COLOR } from '../lib/color';
import { pointerX } from '../lib/fit';
import { runOf, type Source } from '../lib/frame';
import { DAY, SPEEDS, at, useSim } from '../state/sim';

const PAD_L = 58;
const PAD_R = 10;
const LANE_Y = 30;
const LANE_H = 24;
const LANE_GAP = 5;
const RIBBON_Y = LANE_Y + 3 * (LANE_H + LANE_GAP) + 5;
const AXIS_Y = RIBBON_Y + 30;
const HEIGHT = AXIS_Y + 14;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function segments(modes: Mode[]) {
  const out: { mode: Mode; from: number; to: number }[] = [];
  let from = VIEW_START;
  for (let t = VIEW_START + 1; t <= VIEW_END; t++) {
    const m = modes[t - T0];
    const prev = modes[t - 1 - T0];
    if (t === VIEW_END || m !== prev) {
      out.push({ mode: prev, from, to: t });
      from = t;
    }
  }
  return out;
}

/** The playhead is moved without re-rendering the whole chart. */
function Playhead({ x }: { x: (t: number) => number }) {
  const g = useRef<SVGGElement>(null);
  const label = useRef<SVGTextElement>(null);
  useEffect(() => {
    const apply = (t: number) => {
      g.current?.setAttribute('transform', `translate(${x(t).toFixed(1)} 0)`);
      if (label.current) label.current.textContent = fmtTime(Math.floor(t));
    };
    apply(useSim.getState().t);
    return useSim.subscribe((s) => apply(s.t));
  }, [x]);
  return (
    <g ref={g} className="tl-playhead">
      <line y1={16} y2={AXIS_Y - 4} />
      <rect x={-19} y={1} width={38} height={15} rx={2} />
      <text ref={label} y={12} textAnchor="middle" />
    </g>
  );
}

function Energy({ baseline }: { baseline: Source }) {
  const t = useSim((s) => Math.floor(s.t * 2) / 2);
  const cool = at(DAY.cool.energy, t) - at(DAY.cool.energy, VIEW_START);
  const base = at(runOf(baseline).energy, t) - at(runOf(baseline).energy, VIEW_START);
  const saving = base > 0.5 ? (1 - cool / base) * 100 : 0;
  const sched = baseline === 'tight' ? FIXED_TIGHT : FIXED;
  return (
    <div className="tl-energy">
      <span className="label">Energy since 07:00</span>
      <div className="tl-energy-row">
        <span className="num cool">{cool.toFixed(1)}</span>
        <span className="mono unit">kWh</span>
        <span className="who">CoolAhead</span>
      </div>
      <div className="tl-energy-row">
        <span className="num base">{base.toFixed(1)}</span>
        <span className="mono unit">kWh</span>
        <span className="who">
          Fixed {fmtTime(sched.on)} to {fmtTime(sched.off)}
        </span>
      </div>
      <div className={`tl-saving mono${saving < 0 ? ' neg' : ''}`}>
        {base > 0.5 ? `${base - cool >= 0 ? '−' : '+'}${Math.abs(base - cool).toFixed(1)} kWh` : '—'}
        <span>{base > 12 ? `${saving >= 0 ? '−' : '+'}${Math.abs(saving).toFixed(0)}% · modelled` : 'modelled, same inputs'}</span>
      </div>
    </div>
  );
}

export default function Timeline({ baseline = 'fixed' }: { baseline?: Source }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const playing = useSim((s) => s.playing);
  const speed = useSim((s) => s.speed);
  const toggle = useSim((s) => s.toggle);
  const setSpeed = useSim((s) => s.setSpeed);
  const drag = useRef(false);

  const x = useMemo(() => {
    const span = width - PAD_L - PAD_R;
    return (t: number) => PAD_L + ((t - VIEW_START) / (VIEW_END - VIEW_START)) * span;
  }, [width]);

  const chart = useMemo(() => {
    const lanes = ROOMS.map((r, i) => {
      const y = LANE_Y + i * (LANE_H + LANE_GAP);
      let d = `M${x(VIEW_START).toFixed(1)} ${y + LANE_H}`;
      for (let t = VIEW_START; t <= VIEW_END; t += 2) d += `L${x(t).toFixed(1)} ${(y + LANE_H - (DAY.occ[i][t - T0] / r.capacity) * (LANE_H - 3)).toFixed(1)}`;
      d += `L${x(VIEW_END).toFixed(1)} ${y + LANE_H}Z`;
      return { y, d, id: r.id };
    });
    return { lanes, cool: segments(DAY.cool.mode) };
  }, [x]);

  const seek = (e: React.PointerEvent<SVGSVGElement>) => {
    const px = pointerX(e.currentTarget, e.clientX, width);
    const span = width - PAD_L - PAD_R;
    const t = VIEW_START + ((px - PAD_L) / span) * (VIEW_END - VIEW_START);
    useSim.getState().set(t);
  };

  const sched = baseline === 'tight' ? FIXED_TIGHT : FIXED;
  const hours = [];
  for (let h = 7; h <= 19; h++) hours.push(h);
  const cam = SURPRISES.cameraOut;
  const surge = SURPRISES.surge;

  return (
    <section className="panel timeline">
      <div className="tl-controls">
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
        <div className="tl-speed">
          <span className="label">Speed</span>
          <div className="seg">
            {SPEEDS.map((s) => (
              <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)} title={`${s} simulated minute${s > 1 ? 's' : ''} per second`}>
                {s * 60}×
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="tl-track" ref={ref}>
        <svg
          width={width}
          height={HEIGHT}
          onPointerDown={(e) => {
            drag.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            seek(e);
          }}
          onPointerMove={(e) => drag.current && seek(e)}
          onPointerUp={() => (drag.current = false)}
          onPointerCancel={() => (drag.current = false)}
        >
          {/* hour grid */}
          {hours.map((h) => (
            <g key={h}>
              <line className="tl-grid" x1={x(h * 60)} x2={x(h * 60)} y1={LANE_Y - 4} y2={AXIS_Y - 6} />
              <text className="tl-hour" x={x(h * 60)} y={AXIS_Y + 6} textAnchor="middle">
                {String(h).padStart(2, '0')}
              </text>
            </g>
          ))}

          {/* one lane per room: who was really there, and what the timetable says */}
          {chart.lanes.map((lane, i) => (
            <g key={lane.id}>
              <text className="tl-lane" x={0} y={lane.y + LANE_H / 2 + 3.5}>
                {lane.id}
              </text>
              <rect className="tl-lane-bg" x={x(VIEW_START)} y={lane.y} width={x(VIEW_END) - x(VIEW_START)} height={LANE_H} />
              {TIMETABLE.map((b, k) => {
                if (b.room !== i) return null;
                const noShow = k === SURPRISES.noShowBlock;
                const w = x(b.end) - x(b.start);
                return (
                  <g key={k}>
                    <rect className={`tl-class${noShow ? ' ghost' : ''}`} x={x(b.start)} y={lane.y + 0.5} width={w} height={LANE_H - 1} rx={2} />
                    {w > 46 && (
                      <text className={`tl-class-code${noShow ? ' ghost' : ''}`} x={x(b.start) + 6} y={lane.y + 10.5}>
                        {b.code}
                        {noShow ? ' · no-show' : ''}
                      </text>
                    )}
                  </g>
                );
              })}
              <path className="tl-occ" d={lane.d} />
              {surge.room === i && (
                <g>
                  <rect className="tl-surge" x={x(surge.start)} y={lane.y + 0.5} width={x(surge.end) - x(surge.start)} height={LANE_H - 1} rx={2} />
                  <text className="tl-surge-code" x={x(surge.start) + 6} y={lane.y + 10.5}>
                    unscheduled
                  </text>
                </g>
              )}
              {cam.room === i && <rect className="tl-cam" x={x(cam.start)} y={lane.y - 1.5} width={x(cam.end) - x(cam.start)} height={LANE_H + 3} rx={2} />}
            </g>
          ))}

          {/* what the air handler was told to do */}
          <text className="tl-lane" x={0} y={RIBBON_Y + 8}>
            COOLAHEAD
          </text>
          {chart.cool.map((s, k) => (
            <rect key={k} x={x(s.from)} y={RIBBON_Y} width={Math.max(0.5, x(s.to) - x(s.from) - 0.6)} height={9} rx={1.5} fill={MODE_COLOR[s.mode]} opacity={s.mode === 'STANDBY' || s.mode === 'OFF' ? 0.35 : 0.95}>
              <title>{`${MODES[s.mode].label} ${fmtTime(s.from)} to ${fmtTime(s.to)}`}</title>
            </rect>
          ))}
          <text className="tl-lane" x={0} y={RIBBON_Y + 22}>
            FIXED
          </text>
          <rect className="tl-fixed-off" x={x(VIEW_START)} y={RIBBON_Y + 15} width={x(VIEW_END) - x(VIEW_START)} height={5} rx={1.5} />
          <rect className="tl-fixed" x={x(Math.max(VIEW_START, sched.on))} y={RIBBON_Y + 15} width={x(Math.min(VIEW_END, sched.off)) - x(Math.max(VIEW_START, sched.on))} height={5} rx={1.5} />

          {/* the six situations worth jumping to */}
          {DAY.events.map((ev) => (
            <g
              key={ev.id}
              className="tl-event"
              transform={`translate(${x(ev.t).toFixed(1)} 0)`}
              onPointerDown={(e) => {
                e.stopPropagation();
                useSim.getState().jump(ev.t - 2, true);
              }}
            >
              <title>{`${ev.label}: ${ev.note}`}</title>
              <line y1={18} y2={AXIS_Y - 6} />
              <rect x={-1} y={3} width={ev.short.length * 6.2 + 14} height={15} rx={2} />
              <text x={6} y={13.5}>
                {ev.short}
              </text>
            </g>
          ))}

          <Playhead x={x} />
        </svg>
      </div>

      <Energy baseline={baseline} />
    </section>
  );
}

export function ModeLegend() {
  const modes: Mode[] = ['STANDBY', 'PRECOOL', 'REDUCED', 'NORMAL'];
  return (
    <div className="mode-legend">
      {modes.map((m) => (
        <span key={m} className="mono">
          <i style={{ background: MODE_COLOR[m], opacity: m === 'STANDBY' ? 0.45 : 1 }} />
          {MODES[m].label}
        </span>
      ))}
    </div>
  );
}
