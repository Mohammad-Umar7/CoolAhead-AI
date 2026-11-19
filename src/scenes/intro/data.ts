export interface GeoData {
  origin: { lat: number; lon: number };
  /** rings of [x, y, x, y, ...] in metres east and north of the campus */
  outline: number[][];
  emirates: { name: string; rings: number[][] }[];
  neighbours: { c: string; pts: number[] }[];
  places: { name: string; x: number; y: number }[];
}

let geo: Promise<GeoData> | null = null;
/** The outline of the UAE, its emirates and neighbours, and its main cities. */
export const geoData = () => (geo ??= fetch(`${import.meta.env.BASE_URL}data/geo.json`).then((r) => r.json() as Promise<GeoData>));

/** The map pin the intro is measured from: metres east and north of it. */
export const ORIGIN = { lat: 24.4855142, lon: 54.3755735 };

/**
 * The campus building as mapped: a slab about 72 m by 23 m, twelve storeys,
 * lying along Abu Dhabi's rotated street grid. Scene axes: x east, z south, y up.
 */
export const CAMPUS = {
  /** centre of the footprint, metres east / north of the map pin */
  east: 25.3,
  north: 3.1,
  length: 71.7,
  depth: 22.6,
  height: 42,
  floors: 12,
  /** rotation about y that lays the model's long x axis along the footprint */
  yaw: -Math.atan2(56.5, 44.1),
};

/** The footprint from OpenStreetMap, metres east and north of the map pin. */
export const FOOTPRINT: [number, number][] = [
  [-5.7, 24.4],
  [12.1, 38.3],
  [56.2, -18.2],
  [38.4, -32.1],
];
