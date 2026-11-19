import { ROOMS, TIMETABLE, fmtTime } from '../engine/config';
import type { Basis, Decision } from '../engine/types';
import { ease, sub } from './cycle';

const W = 232;
const L = 22;
const R = 30;
const TOP = 8;
const CH = 96;
const GAP = 22;
const DH = 34;
const H = TOP + CH + GAP + DH + 14;

const BASIS: Record<Basis, { label: string; cls: string }> = {
  observed: { label: 'counted', cls: 'observed' },
  timetable: { label: 'timetable', cls: 'timetable' },
  'no-show': { label: 'no-show', cls: 'noshow' },
  unscheduled: { label: 'unscheduled', cls: 'unscheduled' },
  fallback: { label: 'fallback', cls: 'fallback' },
  empty: { label: 'empty', cls: 'empty' },
};

/**
 * The next hour, per room: what is expected, how sure, and on what basis.
 * Underneath, the cooling the zone would need to hold comfort.
 */
export default function ForecastViz({ d, p }: { d: Decision; p: number }) {
  const idle = p < 0;
  const f = d.forecast;
  const n = f.occ[0].length;
  const x = (k: number) => L + (k / (n - 1)) * (W - L - R);
  const y = (v: number) => TOP + CH - (v / 60) * CH;
  const peak = Math.max(4, ...f.demandHi);
  const dy = (v: number) => TOP + CH + GAP + DH - (v / peak) * DH;
  const drawn = idle ? 0 : ease(sub(p, 0.06, 0.72));
  const clipW = (W - L - R) * drawn + 1;
  const path = (row: number[], fy: (v: number) => number) => row.map((v, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)} ${fy(v).toFixed(1)}`).join('');
  const band = (lo: number[], hi: number[], fy: (v: number) => number) =>
    `${path(hi, fy)}${lo
      .map((v, k) => `L${x(n - 1 - k).toFixed(1)} ${fy(lo[n - 1 - k]).toFixed(1)}`)
      .join('')}Z`;

  // each line is named where it ends; names that would land on top of each other are nudged apart
  const ends = ROOMS.map((_, i) => ({ i, at: y(f.occ[i][n - 1]) + 3 })).sort((a, b) => a.at - b.at);
  for (let j = 1; j < ends.length; j++) ends[j].at = Math.max(ends[j].at, ends[j - 1].at + 9);
  for (let j = ends.length - 1; j >= 0; j--) ends[j].at = Math.min(ends[j].at, TOP + CH + 3 - (ends.length - 1 - j) * 9);
  const endY = ROOMS.map((_, i) => ends.find((e) => e.i === i)!.at);

  const starts = TIMETABLE.filter((b) => b.start > d.t + 2 && b.start <= d.t + 58);
  const demandNow = f.demand[0];
  const demandPeak = Math.max(...f.demand);
  const id = `fc-clip-${Math.round(d.t)}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="viz" role="img" aria-label="Forecast for the next hour">
      <defs>
        <clipPath id={id}>
          <rect x={L - 1} y={0} width={clipW} height={H} />
        </clipPath>
        <linearGradient id="fc-demand" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff7a33" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ff7a33" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      {[0, 20, 40, 60].map((v) => (
        <g key={v}>
          <line className="fc-grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
          <text className="fc-tick" x={L - 5} y={y(v) + 3} textAnchor="end">
            {v}
          </text>
        </g>
      ))}

      {starts.map((b, k) => {
        const xx = x(((b.start - d.t) / 60) * (n - 1));
        return (
          <g key={k} className="fc-start" opacity={idle ? 0 : sub(p, 0.5, 0.7)}>
            <line x1={xx} x2={xx} y1={TOP} y2={TOP + CH} />
            <text x={xx} y={TOP - 1} textAnchor="middle">
              {b.code}
            </text>
          </g>
        );
      })}

      <g clipPath={`url(#${id})`}>
        {ROOMS.map((_, i) => (
          <path key={`b${i}`} className={`fc-band ${BASIS[f.basis[i]].cls}`} d={band(f.lo[i], f.hi[i], y)} />
        ))}
        {ROOMS.map((_, i) => (
          <path key={`l${i}`} className={`fc-line ${BASIS[f.basis[i]].cls}`} d={path(f.occ[i], y)} />
        ))}
        <path className="fc-demand-band" d={band(f.demandLo, f.demandHi, dy)} />
        <path className="fc-demand-area" d={`${path(f.demand, dy)}L${x(n - 1)} ${dy(0)}L${x(0)} ${dy(0)}Z`} fill="url(#fc-demand)" />
        <path className="fc-demand-line" d={path(f.demand, dy)} />
      </g>

      {ROOMS.map((room, i) => (
        <text key={room.id} className={`fc-end ${BASIS[f.basis[i]].cls}`} x={W - R + 4} y={endY[i]} opacity={drawn >= 0.98 ? 1 : 0}>
          {room.id.slice(2)}
        </text>
      ))}

      <text className="fc-axis" x={L} y={TOP + CH + 11}>
        {fmtTime(d.t)}
      </text>
      <text className="fc-axis" x={(L + W - R) / 2} y={TOP + CH + 11} textAnchor="middle">
        +30
      </text>
      <text className="fc-axis" x={W - R} y={TOP + CH + 11} textAnchor="end">
        +60 min
      </text>
      <text className="fc-cap" x={L} y={TOP + CH + GAP - 1}>
        COOLING DEMAND
      </text>
      <text className="fc-kw" x={W - R + 4} y={dy(f.demand[n - 1]) + 3} opacity={drawn >= 0.98 ? 1 : 0}>
        {f.demand[n - 1].toFixed(0)} kW
      </text>
      <text className="fc-axis" x={L} y={H - 2} opacity={idle ? 0 : sub(p, 0.75, 0.9)}>
        now {demandNow.toFixed(1)} kW · peak {demandPeak.toFixed(1)} kW
      </text>
    </svg>
  );
}

export function BasisChips({ d, p }: { d: Decision; p: number }) {
  const on = p >= 0.74;
  return (
    <div className={`fc-chips${on ? ' on' : ''}`}>
      {ROOMS.map((room, i) => (
        <span key={room.id} className={`fc-chip ${BASIS[d.forecast.basis[i]].cls}`}>
          <b>{room.id.slice(2)}</b>
          {BASIS[d.forecast.basis[i]].label}
        </span>
      ))}
    </div>
  );
}

export const forecastOut = (d: Decision) => {
  const peak = Math.max(...d.forecast.demand);
  const nx = d.forecast.next;
  return `${peak < 0.5 ? 'no demand' : `peak ${peak.toFixed(0)} kW`}${nx ? ` · next ${nx.code} ${fmtTime(nx.start)}` : ' · no more classes'}`;
};
