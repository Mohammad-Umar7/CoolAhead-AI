import { T0, T1 } from '../../engine/config';
import type { Mode } from '../../engine/types';
import { DAY } from '../../state/sim';
import { BOUNDS, PLAN } from '../floor/layout';

/**
 * The campus building as the twin draws it: twelve storeys, and on each storey
 * three zones like the simulated one, with a stair and lift core between them.
 *
 * Only one zone is simulated: level 3, west wing, air handler AHU-3A. The other
 * 35 replay that same simulated day with their timetables shifted by up to an
 * hour, so the model can show what the idea looks like at building scale. The
 * page says so wherever a building-wide number appears.
 */
export const FLOORS = 12;
export const FLOOR_H = 3.5;
export const SLAB = 0.32;
export const WINGS = 3;
export const ZONES = FLOORS * WINGS;

/** footprint of one zone, metres */
export const ZONE_W = BOUNDS.x1 - BOUNDS.x0;
export const ZONE_D = BOUNDS.z1 - BOUNDS.z0;
const CORE_W = 6.4;
export const LENGTH = WINGS * ZONE_W + (WINGS - 1) * CORE_W;
export const DEPTH = ZONE_D + 2.8;
export const HEIGHT = FLOORS * FLOOR_H;

/** the simulated zone */
export const LIVE = { floor: 2, wing: 0 };
export const liveIndex = LIVE.floor * WINGS + LIVE.wing;

export interface ZoneSpot {
  index: number;
  floor: number;
  wing: number;
  /** where the zone's own plan coordinates (0, 0) sit in the building */
  x: number;
  y: number;
  z: number;
  /** minutes its timetable runs ahead of or behind the simulated zone */
  shift: number;
  live: boolean;
}

export const SPOTS: ZoneSpot[] = Array.from({ length: ZONES }, (_, index) => {
  const floor = Math.floor(index / WINGS);
  const wing = index % WINGS;
  const live = index === liveIndex;
  return {
    index,
    floor,
    wing,
    x: -LENGTH / 2 + wing * (ZONE_W + CORE_W) - BOUNDS.x0,
    y: floor * FLOOR_H + SLAB / 2,
    z: -ZONE_D / 2 - BOUNDS.z0,
    shift: live ? 0 : (((index * 37 + floor * 11) % 13) - 6) * 10,
    live,
  };
});

/** x positions of the two cores, centre */
export const CORES = [0, 1].map((i) => -LENGTH / 2 + (i + 1) * ZONE_W + i * CORE_W + CORE_W / 2);
export const CORE = { w: CORE_W - 0.6, d: 11 };

/** The rooms of a zone that the engine simulates, as boxes in the zone's own plan coordinates. */
export const ROOM_BOXES = PLAN.map((p) => ({ room: p.index, x: (p.x0 + p.x1) / 2, z: (p.z0 + p.z1) / 2, w: p.x1 - p.x0, d: p.z1 - p.z0 }));

export interface ZoneNow {
  temp: number[];
  occ: number[];
  mode: Mode;
  coolKw: number;
  fixedKw: number;
  coolKwh: number;
  fixedKwh: number;
}

export const newZoneNow = (): ZoneNow => ({ temp: [24, 24, 24], occ: [0, 0, 0], mode: 'STANDBY', coolKw: 0, fixedKw: 0, coolKwh: 0, fixedKwh: 0 });

/** One zone at one moment of the day. Fills `into`. */
export function sampleZone(spot: ZoneSpot, t: number, into: ZoneNow): ZoneNow {
  const tt = Math.min(T1, Math.max(T0, t + spot.shift));
  const x = tt - T0;
  const i = Math.min(DAY.steps, Math.floor(x));
  const j = Math.min(DAY.steps, i + 1);
  const f = x - i;
  for (let r = 0; r < 3; r++) {
    into.temp[r] = DAY.cool.ta[r][i] + (DAY.cool.ta[r][j] - DAY.cool.ta[r][i]) * f;
    into.occ[r] = DAY.occ[r][i] + (DAY.occ[r][j] - DAY.occ[r][i]) * f;
  }
  into.mode = DAY.cool.mode[i];
  into.coolKw = DAY.cool.power[i];
  into.fixedKw = DAY.fixed.power[i];
  into.coolKwh = DAY.cool.energy[i];
  into.fixedKwh = DAY.fixed.energy[i];
  return into;
}

export interface BuildingNow {
  people: number;
  coolKw: number;
  fixedKw: number;
  coolKwh: number;
  fixedKwh: number;
  /** zones in each mode */
  modes: Record<Mode, number>;
}

const scratch = newZoneNow();

/** The whole building at one moment: the sum over its 36 zones. */
export function sampleBuilding(t: number): BuildingNow {
  const out: BuildingNow = { people: 0, coolKw: 0, fixedKw: 0, coolKwh: 0, fixedKwh: 0, modes: { OFF: 0, STANDBY: 0, REDUCED: 0, NORMAL: 0, PRECOOL: 0 } };
  for (const spot of SPOTS) {
    const z = sampleZone(spot, t, scratch);
    out.people += Math.round(z.occ[0]) + Math.round(z.occ[1]) + Math.round(z.occ[2]);
    out.coolKw += z.coolKw;
    out.fixedKw += z.fixedKw;
    out.coolKwh += z.coolKwh;
    out.fixedKwh += z.fixedKwh;
    out.modes[z.mode] += 1;
  }
  return out;
}

type Stop = [number, [number, number, number]];
const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Room air temperature on white: cool blues, the comfort band in green, then amber to red. */
const TEMP: Stop[] = [
  [20.5, hex('#3f6df2')],
  [22, hex('#3aa0f0')],
  [23.2, hex('#35c4c0')],
  [24.3, hex('#58cf8c')],
  [25, hex('#e9cf4c')],
  [26, hex('#f59a3a')],
  [27.5, hex('#ec5a3a')],
  [29.5, hex('#c9304e')],
];

/** How full a room is, 0..1: paper, then sand, coral, magenta and a deep violet. */
const HEAT: Stop[] = [
  [0, hex('#e8e4da')],
  [0.08, hex('#ffe3a6')],
  [0.3, hex('#ffb86b')],
  [0.52, hex('#ff7d5c')],
  [0.72, hex('#e8477f')],
  [0.88, hex('#a52a9b')],
  [1, hex('#5a1a8f')],
];

function ramp(stops: Stop[], v: number, out: [number, number, number]) {
  if (v <= stops[0][0]) {
    out[0] = stops[0][1][0];
    out[1] = stops[0][1][1];
    out[2] = stops[0][1][2];
    return out;
  }
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const f = (v - a) / (b - a);
      out[0] = ca[0] + (cb[0] - ca[0]) * f;
      out[1] = ca[1] + (cb[1] - ca[1]) * f;
      out[2] = ca[2] + (cb[2] - ca[2]) * f;
      return out;
    }
  }
  const last = stops[stops.length - 1][1];
  out[0] = last[0];
  out[1] = last[1];
  out[2] = last[2];
  return out;
}

export const tempRgb = (t: number, out: [number, number, number]) => ramp(TEMP, t, out);
export const heatRgb = (v: number, out: [number, number, number]) => ramp(HEAT, v, out);
export const TEMP_SPAN: [number, number] = [20.5, 29.5];

const cssStops = (stops: Stop[]) => {
  const a = stops[0][0];
  const b = stops[stops.length - 1][0];
  return stops.map(([v, c]) => `rgb(${c.map((x) => Math.round(x * 255)).join(' ')}) ${(((v - a) / (b - a)) * 100).toFixed(1)}%`).join(', ');
};
export const TEMP_CSS = `linear-gradient(90deg, ${cssStops(TEMP)})`;
export const HEAT_CSS = `linear-gradient(90deg, ${cssStops(HEAT)})`;

/** The heat ramp as 256 RGBA entries, for colouring the floor heat map. Alpha rises quickly so faint traces still show. */
export function heatLut() {
  const lut = new Uint8ClampedArray(256 * 4);
  const c: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    heatRgb(0.06 + v * 0.94, c);
    lut[i * 4] = c[0] * 255;
    lut[i * 4 + 1] = c[1] * 255;
    lut[i * 4 + 2] = c[2] * 255;
    lut[i * 4 + 3] = Math.min(1, v * 3.4) * 235;
  }
  return lut;
}
