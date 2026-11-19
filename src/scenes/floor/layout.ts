import { ROOMS } from '../../engine/config';
import { mulberry32 } from '../../engine/occupancy';

/**
 * Plan of the simulated zone, in metres. x runs along the corridor, z across it,
 * y is up. Two classrooms sit on the north side of the corridor; the third, the
 * plant room with the air handler, and a room that belongs to another zone sit
 * on the south side. One duct trunk runs down the corridor and feeds all three.
 */
export const WALL = 0.25;
export const WALL_H = 1.5;
export const CEIL = 3.2;
export const DUCT_Y = 3.05;
export const GLASS_H = 2.3;

const D = ROOMS[0].d;
const CORR_W = 2.8;

export const NORTH = { z0: 0, z1: D };
export const CORRIDOR = { z0: D + WALL, z1: D + WALL + CORR_W };
export const SOUTH = { z0: CORRIDOR.z1 + WALL, z1: CORRIDOR.z1 + WALL + D };
export const LENGTH = ROOMS[1].w + WALL + ROOMS[2].w;

export interface RoomPlan {
  index: number;
  side: 'north' | 'south';
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  cx: number;
  cz: number;
  /** z of the wall on the corridor, and of the glazed outside wall */
  zCorridor: number;
  zFacade: number;
  /** ceiling diffusers */
  diffusers: [number, number][];
  /** doors on the corridor wall: centre x */
  doors: number[];
  seats: [number, number][];
  desks: { x: number; z: number; len: number }[];
  camera: [number, number];
}

const rnd = mulberry32(21);

function room(index: number, side: 'north' | 'south', x0: number): RoomPlan {
  const r = ROOMS[index];
  const band = side === 'north' ? NORTH : SOUTH;
  const x1 = x0 + r.w;
  const zCorridor = side === 'north' ? band.z1 : band.z0;
  const zFacade = side === 'north' ? band.z0 : band.z1;
  const toCorridor = side === 'north' ? 1 : -1;

  const rows = index === 1 ? 6 : 5;
  const perRow = Math.ceil(r.capacity / rows);
  const firstRow = x0 + (index === 1 ? 2.7 : 2.3);
  const rowGap = (x1 - 0.9 - firstRow) / (rows - 1);
  // seats run from just inside the glazing to an aisle along the corridor wall
  const zA = zFacade + toCorridor * 0.8;
  const zB = zCorridor - toCorridor * 1.75;
  const seats: [number, number][] = [];
  const desks: RoomPlan['desks'] = [];
  for (let i = 0; i < rows; i++) {
    const x = firstRow + i * rowGap;
    desks.push({ x: x - 0.44, z: (zA + zB) / 2, len: Math.abs(zB - zA) + 0.5 });
    for (let j = 0; j < perRow && seats.length < r.capacity; j++) seats.push([x, zA + ((zB - zA) * j) / (perRow - 1)]);
  }
  // people do not fill a room front to back: shuffle the order seats are taken in
  for (let i = seats.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [seats[i], seats[j]] = [seats[j], seats[i]];
  }

  const cz = (band.z0 + band.z1) / 2;
  return {
    index,
    side,
    x0,
    x1,
    z0: band.z0,
    z1: band.z1,
    cx: (x0 + x1) / 2,
    cz,
    zCorridor,
    zFacade,
    diffusers: index === 1 ? [[x0 + r.w * 0.27, cz], [x0 + r.w * 0.73, cz]] : [[(x0 + x1) / 2, cz]],
    doors: index === 1 ? [x0 + 1.4, x1 - 1.4] : [index === 2 ? x0 + 1.4 : x1 - 1.4],
    seats,
    desks,
    camera: [x1 - 0.4, zFacade + toCorridor * 0.4],
  };
}

export const PLANT = { x0: 0, x1: 5, z0: SOUTH.z0, z1: SOUTH.z1, door: 3.7 };
/** A room on the same corridor that another air handler serves: drawn, but not part of the zone. */
export const OTHER = { x0: PLANT.x1 + WALL + ROOMS[0].w + WALL, x1: LENGTH, z0: SOUTH.z0, z1: SOUTH.z1, door: PLANT.x1 + WALL + ROOMS[0].w + WALL + 1.4 };

/** Indexed like the engine's rooms: A-301 south of the corridor, A-302 and A-303 north of it. */
export const PLAN: RoomPlan[] = [room(0, 'south', PLANT.x1 + WALL), room(1, 'north', 0), room(2, 'north', ROOMS[1].w + WALL)];

export const AHU_POS = { x: 2.45, z: SOUTH.z1 - 2.95, w: 3.0, h: 1.7, d: 1.8 };

/** Whole footprint, used to centre the model on the origin. */
export const BOUNDS = { x0: -WALL, x1: LENGTH + WALL, z0: -WALL, z1: SOUTH.z1 + WALL };
export const CENTER = { x: (BOUNDS.x0 + BOUNDS.x1) / 2, z: (BOUNDS.z0 + BOUNDS.z1) / 2 };

/** Supply duct: a riser out of the air handler, a trunk above the corridor, a branch per diffuser. */
export const TRUNK_Z = (CORRIDOR.z0 + CORRIDOR.z1) / 2;
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

/**
 * The ductwork as straight runs, for drawing. Each run points the way the air
 * moves: up the riser, across to the trunk, out both ways along it, then down
 * each branch.
 */
export interface DuctRun {
  a: [number, number, number];
  b: [number, number, number];
  size: number;
}

export const DUCTS: DuctRun[] = (() => {
  const xs = ROUTES.map((r) => r.pts[3][0]);
  const runs: DuctRun[] = [
    { a: [RISER.x, AHU_POS.h, RISER.z], b: [RISER.x, DUCT_Y, RISER.z], size: 0.62 },
    { a: [RISER.x, DUCT_Y, RISER.z], b: [RISER.x, DUCT_Y, TRUNK_Z], size: 0.62 },
    { a: [RISER.x, DUCT_Y, TRUNK_Z], b: [Math.min(...xs), DUCT_Y, TRUNK_Z], size: 0.62 },
    { a: [RISER.x, DUCT_Y, TRUNK_Z], b: [Math.max(...xs), DUCT_Y, TRUNK_Z], size: 0.62 },
  ];
  for (const r of ROUTES) runs.push({ a: r.pts[3], b: r.pts[4], size: 0.42 });
  return runs;
})();

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
