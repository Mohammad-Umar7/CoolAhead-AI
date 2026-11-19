import { ROOMS } from '../../engine/config';
import { mulberry32 } from '../../engine/occupancy';

/** Plan of the simulated zone, in metres. x runs along the corridor, z towards it, y is up. */
export const WALL = 0.25;
export const WALL_H = 1.25;
export const CEIL = 3.2;
export const DUCT_Y = 2.85;

export interface RoomPlan {
  index: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  cx: number;
  cz: number;
  /** ceiling diffusers, room coordinates */
  diffusers: [number, number][];
  /** doors on the corridor wall: centre x */
  doors: number[];
  seats: [number, number][];
  desks: { x: number; z: number; len: number }[];
  camera: [number, number];
}

const D = ROOMS[0].d;
let cursor = 0;
const rnd = mulberry32(21);

export const PLAN: RoomPlan[] = ROOMS.map((r, index) => {
  const x0 = cursor;
  const x1 = x0 + r.w;
  cursor = x1 + WALL;

  const rows = index === 0 ? 5 : index === 1 ? 6 : 5;
  const perRow = Math.ceil(r.capacity / rows);
  const firstRow = x0 + (index === 1 ? 2.7 : 2.3);
  const rowGap = (x1 - 0.9 - firstRow) / (rows - 1);
  const zA = 0.75;
  const zB = D - 1.7;
  const seats: [number, number][] = [];
  const desks: RoomPlan['desks'] = [];
  for (let i = 0; i < rows; i++) {
    const x = firstRow + i * rowGap;
    desks.push({ x: x - 0.42, z: (zA + zB) / 2, len: zB - zA + 0.5 });
    for (let j = 0; j < perRow && seats.length < r.capacity; j++) seats.push([x, zA + ((zB - zA) * j) / (perRow - 1)]);
  }
  // people do not fill a room front to back: shuffle the order seats are taken in
  for (let i = seats.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [seats[i], seats[j]] = [seats[j], seats[i]];
  }

  return {
    index,
    x0,
    x1,
    z0: 0,
    z1: D,
    cx: (x0 + x1) / 2,
    cz: D / 2,
    diffusers: index === 1 ? [[x0 + r.w * 0.27, D / 2], [x0 + r.w * 0.73, D / 2]] : [[(x0 + x1) / 2, D / 2]],
    doors: index === 1 ? [x0 + 1.3, x1 - 1.3] : [x1 - 1.3],
    seats,
    desks,
    camera: [x1 - 0.35, 0.35],
  };
});

export const ROOMS_X1 = PLAN[PLAN.length - 1].x1;
export const CORRIDOR = { z0: D + WALL, z1: D + WALL + 2.6 };
export const PLANT = { x0: -5.2, x1: -WALL, z0: 0, z1: D };
export const AHU_POS = { x: -2.75, z: 3.6, w: 3.2, h: 1.7, d: 1.9 };

/** Whole footprint, used to centre the model on the origin. */
export const BOUNDS = { x0: PLANT.x0, x1: ROOMS_X1, z0: 0, z1: CORRIDOR.z1 };
export const CENTER = { x: (BOUNDS.x0 + BOUNDS.x1) / 2, z: (BOUNDS.z0 + BOUNDS.z1) / 2 };

/** Supply duct: riser out of the air handler, trunk above the corridor, one branch per diffuser. */
export const TRUNK_Z = CORRIDOR.z0 + 1.1;
export const RISER = { x: AHU_POS.x + AHU_POS.w / 2 - 0.3, z: AHU_POS.z };

export interface DuctRoute {
  room: number;
  /** share of the zone's air that takes this route */
  share: number;
  pts: [number, number, number][];
  len: number;
}

export const ROUTES: DuctRoute[] = PLAN.flatMap((p) =>
  p.diffusers.map(([dx, dz]) => {
    const pts: [number, number, number][] = [
      [RISER.x, AHU_POS.h, RISER.z],
      [RISER.x, DUCT_Y, RISER.z],
      [RISER.x, DUCT_Y, TRUNK_Z],
      [dx, DUCT_Y, TRUNK_Z],
      [dx, DUCT_Y, dz],
    ];
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    return { room: p.index, share: ROOMS[p.index].share / p.diffusers.length, pts, len };
  }),
);

/** Point a given distance along a polyline. */
export function along(pts: [number, number, number][], d: number, out: [number, number, number]) {
  let left = d;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (left <= seg || i === pts.length - 1) {
      const f = seg > 0 ? Math.min(1, left / seg) : 0;
      out[0] = a[0] + (b[0] - a[0]) * f;
      out[1] = a[1] + (b[1] - a[1]) * f;
      out[2] = a[2] + (b[2] - a[2]) * f;
      return out;
    }
    left -= seg;
  }
  return out;
}
