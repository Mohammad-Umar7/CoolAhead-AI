import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MODES, VIEW_END, VIEW_START, fmtTime } from '../engine/config';
import type { Decision, Mode } from '../engine/types';
import { MODE_COLOR } from '../lib/color';
import Stage, { Framing } from '../scenes/Stage';
import FloorScene from '../scenes/floor/FloorScene';
import { DAY } from '../state/sim';
import { FloorLights } from './Twin';
import { ModeBadge } from '../ui/DecisionCard';
import ForecastViz, { BasisChips, forecastOut } from '../agents/ForecastViz';
import OptimizerViz, { optimizerOut } from '../agents/OptimizerViz';
import ReportViz, { reportOut } from '../agents/ReportViz';
import SafetyViz, { safetyOut } from '../agents/SafetyViz';
import VisionViz, { visionOut } from '../agents/VisionViz';
import { AGENTS, CYCLE_MS, KEYS, SEGMENTS, activeSegment, agentProgress, currentDecision, runCycle, useCycle } from '../agents/cycle';

const PAYLOAD = ['counts', 'forecast', 'plan', 'approved plan'];
if (import.meta.env.DEV) (window as unknown as { __cycle: typeof useCycle }).__cycle = useCycle;
const OUT = [visionOut, forecastOut, optimizerOut, safetyOut, reportOut];

function Station({ index, d, children }: { index: number; d: Decision; children: (p: number) => ReactNode }) {
  const p = useCycle((s) => agentProgress(index, s.time));
  const a = AGENTS[index];
  const state = p < 0 ? 'idle' : p < 1 ? 'work' : 'done';
  return (
    <article className={`station ${state}`} data-agent={a.id}>
      <header className="st-head">
        <span className="st-num num">0{index + 1}</span>
        <div>
          <h2 className="st-name">{a.name}</h2>
          <span className="st-step label">{a.step}</span>
        </div>
        <span className="st-led" />
      </header>
      <p className="st-line">{a.line}</p>
      <div className="st-body">{children(p)}</div>
      <footer className="st-out">
        <span className="label">Hands on</span>
        <span className="st-out-val">{state === 'done' ? OUT[index](d) : state === 'work' ? 'working' : 'waiting'}</span>
      </footer>
    </article>
  );
}

interface Geometry {
  w: number;
  h: number;
  hops: string[];
  back: [string, string];
  ports: [number, number][];
  labels: [number, number][];
}

/** The rail the data travels on: short arches between stations, and the long way home through the zone. */
function Rails({ geo }: { geo: Geometry | null }) {
  const time = useCycle((s) => s.time);
  const seg = activeSegment(time);
  if (!geo) return null;
  const hopDone = (i: number) => time >= SEGMENTS.find((s) => s.kind === 'hop' && s.agent === i)!.to;
  const returning = seg.kind === 'return';
  const back = time >= SEGMENTS.find((s) => s.kind === 'return')!.to;
  const dash = (p: number) => -(p * 112 - 12);
  return (
    <svg className="rails" width={geo.w} height={geo.h} aria-hidden="true">
      <defs>
        <filter id="rail-glow" x="-50%" y="-200%" width="200%" height="500%">
          <feGaussianBlur stdDeviation="3.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {geo.hops.map((dPath, i) => {
        const live = seg.kind === 'hop' && seg.agent === i;
        return (
          <g key={i}>
            <path className={`rail${hopDone(i) ? ' done' : ''}`} d={dPath} />
            <path className="rail-flow" d={dPath} />
            {live && <path className="rail-comet" d={dPath} pathLength={100} strokeDasharray="12 400" strokeDashoffset={dash(seg.p)} filter="url(#rail-glow)" />}
            <text className={`rail-label${live ? ' live' : hopDone(i) ? ' done' : ''}`} x={geo.labels[i][0]} y={geo.labels[i][1]} textAnchor="middle">
              {PAYLOAD[i]}
            </text>
          </g>
        );
      })}
      {geo.back.map((dPath, i) => {
        const half = returning ? (i === 0 ? Math.min(1, seg.p * 2) : Math.max(0, seg.p * 2 - 1)) : 0;
        const live = returning && (i === 0 ? seg.p < 0.5 : seg.p >= 0.5);
        return (
          <g key={`b${i}`}>
            <path className={`rail${back || (returning && (i === 0 || seg.p >= 0.5)) ? ' done' : ''}`} d={dPath} />
            <path className="rail-flow" d={dPath} />
            {live && <path className="rail-comet" d={dPath} pathLength={100} strokeDasharray="7 400" strokeDashoffset={-(half * 107 - 7)} filter="url(#rail-glow)" />}
          </g>
        );
      })}
      {geo.ports.map(([x, y], i) => (
        <circle key={i} className="rail-port" cx={x} cy={y} r={2.6} />
      ))}
    </svg>
  );
}

function modeSegments() {
  const out: { mode: Mode; from: number; to: number }[] = [];
  const modes = DAY.cool.mode;
  let from = VIEW_START;
  for (let t = VIEW_START + 1; t <= VIEW_END; t++) {
    if (t === VIEW_END || modes[t - DAY.t0] !== modes[t - 1 - DAY.t0]) {
      out.push({ mode: modes[t - 1 - DAY.t0], from, to: t });
      from = t;
    }
  }
  return out;
}

/** The day at a glance: every decision worth stopping at, on the ribbon of modes. */
function DayStrip() {
  const cursor = useCycle((s) => s.cursor);
  const go = useCycle((s) => s.go);
  const segs = useMemo(modeSegments, []);
  const pos = (t: number) => `${((t - VIEW_START) / (VIEW_END - VIEW_START)) * 100}%`;
  return (
    <div className="daystrip">
      <div className="ds-track">
        {segs.map((s, i) => (
          <i key={i} className="ds-seg" style={{ left: pos(s.from), width: `calc(${pos(s.to)} - ${pos(s.from)} - 1px)`, background: MODE_COLOR[s.mode], opacity: s.mode === 'STANDBY' ? 0.32 : 0.9 }} />
        ))}
        {KEYS.map((k, i) => {
          const t = DAY.decisions[k].t;
          if (t < VIEW_START) return null;
          return <button key={k} className={`ds-key${i === cursor ? ' on' : ''}`} style={{ left: pos(t) }} onClick={() => go(i)} title={`${fmtTime(t)} · ${DAY.decisions[k].report.headline}`} aria-label={`Decision at ${fmtTime(t)}`} />;
        })}
      </div>
      <div className="ds-hours mono">
        {[7, 9, 11, 13, 15, 17, 19].map((h) => (
          <span key={h} style={{ left: pos(h * 60) }}>
            {String(h).padStart(2, '0')}:00
          </span>
        ))}
      </div>
    </div>
  );
}

function Transport() {
  const playing = useCycle((s) => s.playing);
  const tour = useCycle((s) => s.tour);
  const speed = useCycle((s) => s.speed);
  const { step, toggle, replay, setTour, setSpeed } = useCycle.getState();
  return (
    <div className="transport">
      <button onClick={() => step(-1)} aria-label="Previous decision" title="Previous decision">
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path d="M11.5 3 6 8l5.5 5M4.5 3v10" />
        </svg>
      </button>
      <button className="big" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? (
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path d="M5 3v10M11 3v10" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path d="M5 3l8 5-8 5z" fill="currentColor" />
          </svg>
        )}
      </button>
      <button onClick={() => step(1)} aria-label="Next decision" title="Next decision">
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path d="M4.5 3 10 8l-5.5 5M11.5 3v10" />
        </svg>
      </button>
      <button onClick={replay} aria-label="Replay this decision" title="Replay this decision">
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.6v2.6h2.6" />
        </svg>
      </button>
      <span className="tp-sep" />
      <div className="seg">
        {[1, 2].map((s) => (
          <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
      <label className="tp-tour" title="When a decision finishes, move on to the next one">
        <input type="checkbox" checked={tour} onChange={(e) => setTour(e.target.checked)} />
        <span>Tour the day</span>
      </label>
    </div>
  );
}

function PassBar() {
  const time = useCycle((s) => s.time);
  return (
    <div className="passbar" aria-hidden="true">
      <i style={{ width: `${(time / CYCLE_MS) * 100}%` }} />
    </div>
  );
}

export default function Agents() {
  const cursor = useCycle((s) => s.cursor);
  const d = currentDecision(cursor);
  const stage = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const zone = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geometry | null>(null);
  const zoneState = useCycle((s) => {
    const seg = activeSegment(s.time);
    return seg.kind === 'rest' || (seg.kind === 'return' && seg.p >= 0.5) ? 'applied' : seg.kind === 'return' ? 'arriving' : 'waiting';
  });

  useEffect(() => {
    // arriving here pins the shared clock to the decision being shown
    useCycle.getState().go(useCycle.getState().cursor);
    return runCycle();
  }, []);

  useLayoutEffect(() => {
    const measure = () => {
      if (!stage.current || !row.current || !zone.current) return;
      const box = stage.current.getBoundingClientRect();
      // client rectangles come back in screen pixels; the rail is drawn in layout pixels
      const s = stage.current.offsetWidth / box.width || 1;
      const st = Array.from(row.current.children).map((el) => {
        const r = el.getBoundingClientRect();
        return { l: (r.left - box.left) * s, r: (r.right - box.left) * s, t: (r.top - box.top) * s, b: (r.bottom - box.top) * s };
      });
      const z = zone.current.getBoundingClientRect();
      const zl = (z.left - box.left) * s;
      const zr = (z.right - box.left) * s;
      const zy = (z.top - box.top + z.height / 2) * s;
      const up = 21;
      const c = 9;
      const hops: string[] = [];
      const ports: [number, number][] = [];
      const labels: [number, number][] = [];
      for (let i = 0; i < st.length - 1; i++) {
        const ox = st[i].r - 30;
        const ix = st[i + 1].l + 30;
        const y = st[i].t;
        hops.push(`M${ox} ${y}V${y - up + c}Q${ox} ${y - up} ${ox + c} ${y - up}H${ix - c}Q${ix} ${y - up} ${ix} ${y - up + c}V${y}`);
        ports.push([ox, y], [ix, y]);
        labels.push([(ox + ix) / 2, y - up - 6]);
      }
      const last = st[st.length - 1];
      const first = st[0];
      const rx = last.r - 30;
      const lx = first.l + 30;
      const back: [string, string] = [`M${rx} ${last.b}V${zy - c}Q${rx} ${zy} ${rx - c} ${zy}H${zr}`, `M${zl} ${zy}H${lx + c}Q${lx} ${zy} ${lx} ${zy - c}V${first.b}`];
      ports.push([rx, last.b], [lx, first.b]);
      setGeo({ w: box.width * s, h: box.height * s, hops, back, ports, labels });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (stage.current) ro.observe(stage.current);
    return () => ro.disconnect();
  }, []);

  const jump = (t: number) => useCycle.getState().goTime(t);

  return (
    <div className="agents" ref={stage}>
      <header className="ag-top">
        <div className="ag-when">
          <span className="label">Decision</span>
          <span className="ag-time num">{fmtTime(d.t)}</span>
          <ModeBadge mode={d.mode} />
          <span className="ag-count mono">
            {cursor + 1} / {KEYS.length}
          </span>
        </div>
        <div className="ag-events">
          {DAY.events.map((ev) => {
            const on = d.t >= ev.t - 6 && d.t <= ev.end;
            return (
              <button key={ev.id} className={`ag-event${on ? ' on' : ''}`} onClick={() => jump(ev.t)} title={`${ev.label}. ${ev.note}`}>
                {ev.short}
              </button>
            );
          })}
        </div>
        <Transport />
      </header>

      <Rails geo={geo} />

      <div className="ag-mid">
      <div className="ag-row" ref={row}>
        <Station index={0} d={d}>
          {(p) => <VisionViz d={d} p={p} />}
        </Station>
        <Station index={1} d={d}>
          {(p) => (
            <>
              <ForecastViz d={d} p={p} />
              <BasisChips d={d} p={p} />
            </>
          )}
        </Station>
        <Station index={2} d={d}>
          {(p) => <OptimizerViz d={d} p={p} />}
        </Station>
        <Station index={3} d={d}>
          {(p) => <SafetyViz d={d} p={p} />}
        </Station>
        <Station index={4} d={d}>
          {(p) => <ReportViz d={d} p={p} />}
        </Station>
      </div>

      <div className="ag-loop">
        <div className={`zonebox ${zoneState}`} ref={zone}>
          <div className="zb-canvas">
            <Stage camera={{ position: [-22, 30, 34], fov: 24 }} bloom={0.5} studio>
              <FloorLights />
              <FloorScene source="cool" view="live" reflect={false} />
              <Framing span={23.5} from={[-0.5, 0.62, 0.82]} target={[0, 0.6, 0.6]} inset={{ top: 4, bottom: 4 }} />
            </Stage>
          </div>
          <div className="zb-text">
            <span className="label">Simulated zone AHU-3A</span>
            <strong>{zoneState === 'applied' ? `Running ${MODES[d.mode].label.toLowerCase()}` : zoneState === 'arriving' ? 'Recommendation arriving' : 'Awaiting this decision'}</strong>
            <span className="zb-note">Applied to the model only: no building system is controlled. The cameras look again and the loop repeats every 5 minutes.</span>
          </div>
        </div>
      </div>
      </div>

      <footer className="ag-foot">
        <PassBar />
        <DayStrip />
        <p className="ag-fine">Five deterministic modules running in this browser on the simulated day: a person detector, a forecaster, a model-predictive search, a rule gate and a template writer.</p>
      </footer>
    </div>
  );
}
