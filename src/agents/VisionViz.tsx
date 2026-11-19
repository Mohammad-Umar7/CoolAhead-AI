import { ROOMS } from '../engine/config';
import type { Decision } from '../engine/types';
import { PLAN } from '../scenes/floor/layout';
import { ease, sub } from './cycle';

const W = 232;
const ROW = 62;
const PW = 104;
const PH = 46;

/** Seats as fractions of the room, in the order they fill. */
const SEATS = PLAN.map((p) => p.seats.map(([x, z]) => [(x - p.x0) / (p.x1 - p.x0), (z - p.z0) / (p.z1 - p.z0)] as const));

/**
 * The detector sweeping each room. Every dot is a person-shaped box that was
 * found; nothing about who they are is kept, only how many and roughly where.
 */
export default function VisionViz({ d, p }: { d: Decision; p: number }) {
  const idle = p < 0;
  return (
    <svg viewBox={`0 0 ${W} ${ROW * 3 + 4}`} className="viz" role="img" aria-label="People counted per room">
      {ROOMS.map((room, i) => {
        const y = i * ROW + 4;
        const online = d.vision.online[i];
        const count = d.vision.count[i] ?? 0;
        const scan = idle ? 0 : ease(sub(p, 0.04 + i * 0.27, 0.36 + i * 0.27));
        const sweeping = scan > 0 && scan < 1;
        const seats = SEATS[i];
        let seen = 0;
        const dots = [];
        for (let s = 0; s < Math.min(count, seats.length); s++) {
          const [fx, fz] = seats[s];
          if (fx > scan) continue;
          seen++;
          const fresh = sweeping && scan - fx < 0.09;
          dots.push(<rect key={s} className={`vz-dot${fresh ? ' fresh' : ''}`} x={2 + fx * (PW - 6)} y={y + 2 + fz * (PH - 6)} width={3.2} height={3.2} rx={0.6} />);
        }
        const conf = online ? d.vision.conf[i] : 0;
        return (
          <g key={room.id} className={idle ? 'vz-row idle' : 'vz-row'}>
            <rect className={`vz-room${online ? '' : ' lost'}`} x={0.5} y={y + 0.5} width={PW} height={PH} rx={2} />
            {online ? (
              <>
                {dots}
                {sweeping && (
                  <g>
                    <rect className="vz-sweep" x={scan * PW - 14} y={y + 1} width={14} height={PH - 1} />
                    <line className="vz-scan" x1={scan * PW} x2={scan * PW} y1={y + 1} y2={y + PH} />
                  </g>
                )}
              </>
            ) : (
              <>
                {Array.from({ length: 9 }, (_, k) => (
                  <line key={k} className="vz-hatch" x1={k * 14 - 12} y1={y + PH} x2={k * 14 + 22} y2={y + 1} />
                ))}
                <text className="vz-lost" x={PW / 2} y={y + PH / 2 + 3.5} textAnchor="middle">
                  NO SIGNAL
                </text>
              </>
            )}
            <text className="vz-id" x={PW + 12} y={y + 9}>
              {room.id}
            </text>
            <text className={`vz-count${online ? '' : ' lost'}`} x={PW + 12} y={y + 33}>
              {online ? (idle ? '–' : scan >= 1 ? count : seen) : '?'}
              <tspan className="vz-cap" dx={4}>
                / {room.capacity}
              </tspan>
            </text>
            <rect className="vz-conf-bg" x={PW + 12} y={y + 41} width={W - PW - 14} height={2.5} rx={1} />
            <rect className={`vz-conf${online ? '' : ' lost'}`} x={PW + 12} y={y + 41} width={(W - PW - 14) * (idle ? 0 : conf * scan)} height={2.5} rx={1} />
            <text className="vz-conf-n" x={W - 2} y={y + 9} textAnchor="end">
              {online ? (scan >= 1 ? `${Math.round(conf * 100)}%` : '') : 'offline'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export const visionOut = (d: Decision) => {
  const live = d.vision.online.filter(Boolean).length;
  const people = d.vision.count.reduce<number>((a, c) => a + (c ?? 0), 0);
  return live === 3 ? `${people} people · 3 of 3 feeds live` : `${people} counted · ${3 - live} feed lost`;
};
