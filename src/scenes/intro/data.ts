export interface GeoData {
  origin: { lat: number; lon: number };
  /** rings of [x, y, x, y, ...] in metres east and north of the campus */
  outline: number[][];
  emirates: { name: string; rings: number[][] }[];
  neighbours: { c: string; pts: number[] }[];
  places: { name: string; x: number; y: number }[];
}

export interface CityData {
  origin: { lat: number; lon: number };
  buildings: { pts: number[]; h: number; tagged: boolean; name?: string; campus?: boolean }[];
  streets: { pts: number[]; k: number }[];
  arterials: { pts: number[]; k: number }[];
  coast: number[][];
}

const load = <T,>(file: string): Promise<T> => fetch(`${import.meta.env.BASE_URL}data/${file}`).then((r) => r.json() as Promise<T>);

let geo: Promise<GeoData> | null = null;
let city: Promise<CityData> | null = null;
export const geoData = () => (geo ??= load<GeoData>('geo.json'));
export const cityData = () => (city ??= load<CityData>('city.json'));

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

export const KM = 1000;
