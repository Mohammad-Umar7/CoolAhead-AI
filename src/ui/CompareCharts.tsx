import { COMFORT_HI, COMFORT_LO, FIXED, FIXED_TIGHT, T0, VIEW_END, VIEW_START, fmtTime } from '../engine/config';
import { runOf, type Source } from '../lib/frame';
import { derived } from '../lib/stats';
import { useMinute } from '../state/sim';

const W = 440;
const H = 196;
const L = 34;
const R = 14;
const T = 14;
const B = 26;
const PW = W - L - R;
const PH = H - T - B;
const x = (t: number) => L + ((t - VIEW_START) / (VIEW_END - VIEW_START)) * PW;
const HOURS = [7, 9, 11, 13, 15, 17, 19];

export const dayKwh = (s: Source) => runOf(s).energy[VIEW_END - T0] - runOf(s).energy[VIEW_START - T0];
export const dayOut = (s: Source) => derived(s).outMin[VIEW_END - T0] - derived(s).outMin[VIEW_START - T0];
export const timerLabel = (s: Source) => {
  const t = s === 'tight' ? FIXED_TIGHT : FIXED;
  return `${fmtTime(t.on)} to ${fmtTime(t.off)}`;
};

function Axis() {
  return (
    <g>
      {HOURS.map((h) => (
        <g key={h}>
          <line className="ch-grid" x1={x(h * 60)} x2={x(h * 60)} y1={T} y2={T + PH} />
          <text className="ch-tick" x={x(h * 60)} y={H - 9} textAnchor="middle">
            {String(h).padStart(2, '0')}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Energy drawn since 07:00 by each controller; the gap between the two lines is the saving. */
export function EnergyChart({ baseline }: { baseline: Source }) {
  const minute = useMinute();
  const base = runOf(baseline).energy;
  const cool = runOf('cool').energy;
  const e0b = base[VIEW_START - T0];
  const e0c = cool[VIEW_START - T0];
  const top = Math.ceil(Math.max(dayKwh(baseline), dayKwh('cool')) / 20) * 20;
  const y = (e: number) => T + PH - (e / top) * PH;
  let pb = '';
  let pc = '';
  let back = '';
  for (let t = VIEW_START; t <= VIEW_END; t += 2) {
    const k = t - T0;
    pb += `${pb ? 'L' : 'M'}${x(t).toFixed(1)} ${y(base[k] - e0b).toFixed(1)}`;
    pc += `${pc ? 'L' : 'M'}${x(t).toFixed(1)} ${y(cool[k] - e0c).toFixed(1)}`;
  }
  for (let t = VIEW_END; t >= VIEW_START; t -= 2) back += `L${x(t).toFixed(1)} ${y(cool[t - T0] - e0c).toFixed(1)}`;
  const now = Math.min(VIEW_END, Math.max(VIEW_START, minute));
  const eb = base[now - T0] - e0b;
  const ec = cool[now - T0] - e0c;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Energy used through the day">
      <defs>
        <clipPath id="en-past">
          <rect x={L} y={0} width={x(now) - L} height={H} />
        </clipPath>
      </defs>
      {[0, top / 2, top].map((v) => (
        <g key={v}>
          <line className="ch-grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
          <text className="ch-tick" x={L - 6} y={y(v) + 3} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      <Axis />
      <path className="ch-ghost" d={pb} />
      <path className="ch-ghost" d={pc} />
      <g clipPath="url(#en-past)">
        <path className="ch-gap" d={`${pb}${back}Z`} />
        <path className="ch-base" d={pb} />
        <path className="ch-cool" d={pc} />
      </g>
      <line className="ch-now" x1={x(now)} x2={x(now)} y1={T} y2={T + PH} />
      <circle className="ch-dot base" cx={x(now)} cy={y(eb)} r={3.2} />
      <circle className="ch-dot cool" cx={x(now)} cy={y(ec)} r={3.2} />
      <text className="ch-unit" x={L} y={T - 3}>
        kWh
      </text>
    </svg>
  );
}

/** Temperature of the warmest occupied room under each controller, against the comfort band. */
export function ComfortChart({ baseline }: { baseline: Source }) {
  const minute = useMinute();
  const lo = 21;
  const hi = 28.5;
  const y = (v: number) => T + PH - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * PH;
  const now = Math.min(VIEW_END, Math.max(VIEW_START, minute));

  const paths = (source: Source) => {
    const warm = derived(source).warm;
    let ok = '';
    let bad = '';
    let pen = false;
    for (let t = VIEW_START; t <= VIEW_END; t++) {
      const v = warm[t - T0];
      if (Number.isNaN(v)) {
        pen = false;
        continue;
      }
      const out = v > COMFORT_HI + 0.05 || v < COMFORT_LO - 0.05;
      const p = `${x(t).toFixed(1)} ${y(v).toFixed(1)}`;
      ok += `${pen ? 'L' : 'M'}${p}`;
      if (out) {
        const prev = warm[t - 1 - T0];
        bad += `M${x(t - 1).toFixed(1)} ${y(Number.isNaN(prev) ? v : prev).toFixed(1)}L${p}`;
      }
      pen = true;
    }
    return { ok, bad };
  };
  const b = paths(baseline);
  const c = paths('cool');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Warmest occupied room against the comfort band">
      <defs>
        <clipPath id="cf-past">
          <rect x={L} y={0} width={x(now) - L} height={H} />
        </clipPath>
      </defs>
      <rect className="ch-band" x={L} y={y(COMFORT_HI)} width={PW} height={y(COMFORT_LO) - y(COMFORT_HI)} />
      {[22, 25, 28].map((v) => (
        <g key={v}>
          <line className="ch-grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
          <text className="ch-tick" x={L - 6} y={y(v) + 3} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      <Axis />
      <path className="ch-ghost" d={b.ok} />
      <path className="ch-ghost" d={c.ok} />
      <g clipPath="url(#cf-past)">
        <path className="ch-base" d={b.ok} />
        <path className="ch-cool" d={c.ok} />
        <path className="ch-bad" d={b.bad} />
        <path className="ch-bad" d={c.bad} />
      </g>
      <line className="ch-now" x1={x(now)} x2={x(now)} y1={T} y2={T + PH} />
      <text className="ch-unit" x={L} y={T - 3}>
        °C, warmest room with people in it
      </text>
      <text className="ch-bandlabel" x={W - R - 4} y={y(COMFORT_LO) - 5} textAnchor="end">
        comfort band
      </text>
    </svg>
  );
}

/**
 * The whole day in one picture: energy against comfort. Any fixed timer sits
 * somewhere on the line between "cheap but warm" and "comfortable but wasteful";
 * the point of the project is to get off that line.
 */
export function TradeoffChart({ baseline }: { baseline: Source }) {
  const pts = [
    { id: 'fixed' as Source, label: `Fixed ${timerLabel('fixed')}`, e: dayKwh('fixed'), m: dayOut('fixed') },
    { id: 'tight' as Source, label: `Fixed ${timerLabel('tight')}`, e: dayKwh('tight'), m: dayOut('tight') },
    { id: 'cool' as Source, label: 'CoolAhead', e: dayKwh('cool'), m: dayOut('cool') },
  ];
  const e0 = Math.floor((Math.min(...pts.map((p) => p.e)) - 14) / 10) * 10;
  const e1 = Math.ceil((Math.max(...pts.map((p) => p.e)) + 4) / 10) * 10;
  const m1 = Math.max(30, Math.ceil((Math.max(...pts.map((p) => p.m)) + 12) / 30) * 30);
  const px = (e: number) => L + ((e - e0) / (e1 - e0)) * PW;
  const py = (m: number) => T + PH - (m / m1) * PH;
  const [fixed, tight, cool] = pts;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Energy against time outside the comfort band">
      {[0, m1 / 2, m1].map((v) => (
        <g key={v}>
          <line className="ch-grid" x1={L} x2={W - R} y1={py(v)} y2={py(v)} />
          <text className="ch-tick" x={L - 6} y={py(v) + 3} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      {[e0, (e0 + e1) / 2, e1].map((v) => (
        <text key={v} className="ch-tick" x={px(v)} y={H - 9} textAnchor="middle">
          {v} kWh
        </text>
      ))}
      <line className="ch-trade" x1={px(fixed.e)} y1={py(fixed.m)} x2={px(tight.e)} y2={py(tight.m)} />
      <text className="ch-note" x={(px(fixed.e) + px(tight.e)) / 2 + 10} y={(py(fixed.m) + py(tight.m)) / 2 - 4}>
        every fixed timer trades
      </text>
      <text className="ch-note" x={(px(fixed.e) + px(tight.e)) / 2 + 10} y={(py(fixed.m) + py(tight.m)) / 2 + 8}>
        energy for comfort
      </text>
      {pts.map((p) => {
        const active = p.id === baseline || p.id === 'cool';
        // labels sit on the side where there is room: only the tight timer has space to its right
        const left = p.id !== 'tight';
        return (
          <g key={p.id} className={`ch-point ${p.id === 'cool' ? 'cool' : 'base'}${active ? '' : ' off'}`}>
            <circle cx={px(p.e)} cy={py(p.m)} r={p.id === 'cool' ? 6.5 : 5} />
            {p.id === 'cool' && <circle className="ch-halo" cx={px(p.e)} cy={py(p.m)} r={12} />}
            <text x={px(p.e) + (left ? -11 : 11)} y={py(p.m) - 9} textAnchor={left ? 'end' : 'start'}>
              {p.label}
            </text>
            <text className="ch-sub" x={px(p.e) + (left ? -11 : 11)} y={py(p.m) + 4} textAnchor={left ? 'end' : 'start'}>
              {p.e.toFixed(0)} kWh · {Math.round(p.m)} min
            </text>
          </g>
        );
      })}
      <text className="ch-unit" x={L} y={T - 3}>
        occupied minutes outside comfort
      </text>
    </svg>
  );
}
