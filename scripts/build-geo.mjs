// Builds public/data/geo.json: the UAE outline, emirate borders and the neighbouring
// coastline, projected to metres around the campus.
//
//   node scripts/build-geo.mjs
//
// Source: Natural Earth 1:10m (public domain), fetched once into scripts/.cache.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cache = path.join(here, '.cache');
const out = path.join(here, '..', 'public', 'data', 'geo.json');

/** Liwa University, Abu Dhabi campus. */
export const ORIGIN = { lat: 24.4855142, lon: 54.3755735 };
const R = 6371008.8;
const rad = Math.PI / 180;
const cos0 = Math.cos(ORIGIN.lat * rad);
export const project = ([lon, lat]) => [R * cos0 * (lon - ORIGIN.lon) * rad, R * (lat - ORIGIN.lat) * rad];

const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
async function load(name) {
  await mkdir(cache, { recursive: true });
  const file = path.join(cache, name);
  if (!existsSync(file)) {
    process.stdout.write(`fetching ${name} ... `);
    const res = await fetch(BASE + name);
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    console.log('done');
  }
  return JSON.parse(await readFile(file, 'utf8'));
}

/** Douglas-Peucker on projected points, tolerance in metres. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [];
  const last = pts.length - 1;
  if (pts[0][0] === pts[last][0] && pts[0][1] === pts[last][1]) {
    // Closed ring: split at the point farthest from the start so both halves have a real chord.
    let far = 0;
    let best = -1;
    for (let i = 1; i < last; i++) {
      const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
      if (d > best) {
        best = d;
        far = i;
      }
    }
    keep[far] = 1;
    stack.push([0, far], [far, last]);
  } else {
    stack.push([0, last]);
  }
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let worst = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tol && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const rings = (geom) => (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates).map((poly) => poly[0]);
const flat = (ring, tol) => simplify(ring.map(project), tol).flatMap(([x, y]) => [Math.round(x), Math.round(y)]);
const area = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(a / 2);
};

const BOX = { w: 49.5, e: 58.8, s: 21.4, n: 27.6 };
const inBox = ([lon, lat]) => lon > BOX.w && lon < BOX.e && lat > BOX.s && lat < BOX.n;

/** Cut a ring to the runs of points that fall inside the view box. */
function clipRuns(ring) {
  const runs = [];
  let cur = [];
  for (const p of ring) {
    if (inBox(p)) cur.push(p);
    else if (cur.length) {
      if (cur.length > 2) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length > 2) runs.push(cur);
  return runs;
}

const countries = await load('ne_10m_admin_0_countries.geojson');
const states = await load('ne_10m_admin_1_states_provinces.geojson');

const uae = countries.features.find((f) => f.properties.ADM0_A3 === 'ARE');
if (!uae) throw new Error('UAE not found');

const outline = rings(uae.geometry)
  .filter((r) => area(r.map(project)) > 4e6)
  .map((r) => flat(r, 220));

const emirates = states.features
  .filter((f) => f.properties.adm0_a3 === 'ARE')
  .map((f) => ({
    name: (f.properties.name_en || f.properties.name).replace(/^Emirate of /, ''),
    rings: rings(f.geometry)
      .filter((r) => area(r.map(project)) > 4e6)
      .map((r) => flat(r, 260)),
  }))
  .filter((e) => e.rings.length);

const neighbours = [];
for (const f of countries.features) {
  if (!['SAU', 'OMN', 'QAT', 'IRN', 'BHR'].includes(f.properties.ADM0_A3)) continue;
  for (const ring of rings(f.geometry)) {
    for (const run of clipRuns(ring)) {
      const pts = simplify(run.map(project), 900);
      if (pts.length > 2) neighbours.push({ c: f.properties.ADM0_A3, pts: pts.flatMap(([x, y]) => [Math.round(x), Math.round(y)]) });
    }
  }
}

const places = [
  ['Abu Dhabi', 24.4539, 54.3773],
  ['Dubai', 25.2048, 55.2708],
  ['Sharjah', 25.3463, 55.4209],
  ['Al Ain', 24.2075, 55.7447],
  ['Ras Al Khaimah', 25.7895, 55.9432],
  ['Fujairah', 25.1288, 56.3265],
  ['Liwa Oasis', 23.1323, 53.7964],
].map(([name, lat, lon]) => {
  const [x, y] = project([lon, lat]);
  return { name, x: Math.round(x), y: Math.round(y) };
});

await mkdir(path.dirname(out), { recursive: true });
const data = { origin: ORIGIN, outline, emirates, neighbours, places };
await writeFile(out, JSON.stringify(data));
const n = (a) => a.reduce((s, r) => s + r.length / 2, 0);
console.log(
  `geo.json: outline ${n(outline)} pts in ${outline.length} rings, ${emirates.length} emirates (${emirates.map((e) => e.name).join(', ')}), neighbours ${n(neighbours.map((x) => x.pts))} pts, ${(JSON.stringify(data).length / 1024).toFixed(0)} kB`,
);
