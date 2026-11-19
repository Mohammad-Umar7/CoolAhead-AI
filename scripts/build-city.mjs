// Builds public/data/city.json: building footprints and streets around the campus,
// plus the arterial roads and coastline of Abu Dhabi island for the fly-in.
//
//   node scripts/build-city.mjs
//
// Source: OpenStreetMap (© OpenStreetMap contributors, ODbL): the map API for the
// neighbourhood, Overpass for the wider road and coast context.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cache = path.join(here, '.cache');
const out = path.join(here, '..', 'public', 'data', 'city.json');

const ORIGIN = { lat: 24.4855142, lon: 54.3755735 };
const R = 6371008.8;
const rad = Math.PI / 180;
const cos0 = Math.cos(ORIGIN.lat * rad);
const project = (lon, lat) => [R * cos0 * (lon - ORIGIN.lon) * rad, R * (lat - ORIGIN.lat) * rad];

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const UA = { 'User-Agent': 'campus-map-build/1.0' };

/** The neighbourhood, straight from the OpenStreetMap API (small boxes only). */
async function osmMap(name, box) {
  await mkdir(cache, { recursive: true });
  const file = path.join(cache, `${name}.osm`);
  if (!existsSync(file)) {
    process.stdout.write(`openstreetmap ${name} ... `);
    const res = await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${box.join(',')}`, { headers: UA, signal: AbortSignal.timeout(90000) });
    if (!res.ok) throw new Error(`osm map ${res.status}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    console.log('done');
  }
  const xml = await readFile(file, 'utf8');
  const nodes = new Map();
  for (const m of xml.matchAll(/<node([^>]*)>/g)) {
    const id = /id="(\d+)"/.exec(m[1]);
    const lat = /lat="([-\d.]+)"/.exec(m[1]);
    const lon = /lon="([-\d.]+)"/.exec(m[1]);
    if (id && lat && lon) nodes.set(id[1], { lat: +lat[1], lon: +lon[1] });
  }
  const elements = [];
  for (const m of xml.matchAll(/<way[^>]*id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const geometry = [];
    for (const nd of m[2].matchAll(/<nd ref="(\d+)"/g)) {
      const n = nodes.get(nd[1]);
      if (n) geometry.push(n);
    }
    const tags = {};
    for (const tg of m[2].matchAll(/<tag k="([^"]*)" v="([^"]*)"/g)) tags[tg[1]] = tg[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    elements.push({ type: 'way', id: +m[1], geometry, tags });
  }
  return { elements };
}

/** Wider context through Overpass. Optional: the mirrors are often busy. */
async function overpass(name, query) {
  await mkdir(cache, { recursive: true });
  const file = path.join(cache, `${name}.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  for (const url of ENDPOINTS) {
    try {
      process.stdout.write(`overpass ${name} via ${new URL(url).host} ... `);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...UA },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(75000),
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      console.log(`${json.elements.length} elements`);
      await writeFile(file, JSON.stringify(json));
      return json;
    } catch (err) {
      console.log(`failed (${err.name === 'TimeoutError' ? 'timeout' : err.message})`);
    }
  }
  return null;
}

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

const line = (geometry, tol, digits = 1) => {
  const f = 10 ** digits;
  return simplify(geometry.map((g) => project(g.lon, g.lat)), tol).flatMap(([x, y]) => [Math.round(x * f) / f, Math.round(y * f) / f]);
};
const ringArea = (flat) => {
  let a = 0;
  for (let i = 0; i < flat.length - 2; i += 2) a += flat[i] * flat[i + 3] - flat[i + 2] * flat[i + 1];
  return Math.abs(a / 2);
};
const centroid = (flat) => {
  let x = 0;
  let y = 0;
  const n = flat.length / 2;
  for (let i = 0; i < flat.length; i += 2) {
    x += flat[i];
    y += flat[i + 1];
  }
  return [x / n, y / n];
};
const inside = (flat, px, py) => {
  let hit = false;
  for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
    const xi = flat[i];
    const yi = flat[i + 1];
    const xj = flat[j];
    const yj = flat[j + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
/** Stable pseudo-random from a number, for buildings that carry no height. */
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const at = `${ORIGIN.lat},${ORIGIN.lon}`;
const near = await osmMap('near', [54.3665, 24.4775, 54.3847, 24.4935]);
const far = (await overpass(
  'far',
  `[out:json][timeout:60];(way["highway"~"^(motorway|trunk|primary|motorway_link|trunk_link)$"](around:17000,${at});way["natural"="coastline"](around:19000,${at}););out geom tags;`,
)) ?? { elements: [] };

const buildings = [];
const streets = [];
for (const el of near.elements) {
  if (el.type !== 'way' || !el.geometry) continue;
  const t = el.tags || {};
  if (t.building) {
    const pts = line(el.geometry, 0.6);
    if (pts.length < 8) continue;
    const a = ringArea(pts);
    if (a < 40) continue;
    let h = parseFloat(t.height);
    if (!Number.isFinite(h)) {
      const levels = parseFloat(t['building:levels']);
      if (Number.isFinite(levels)) h = levels * 3.5;
    }
    const tagged = Number.isFinite(h);
    if (!tagged) {
      // Mid-rise downtown block: large footprints tend to be lower.
      const r = hash(el.id);
      const floors = a > 2500 ? 4 + Math.floor(r * 6) : a > 900 ? 6 + Math.floor(r * 10) : 3 + Math.floor(r * 14);
      h = floors * 3.5;
    }
    const [cx, cy] = centroid(pts);
    buildings.push({ id: el.id, pts, h: Math.round(h * 10) / 10, tagged, name: t.name || t['name:en'] || undefined, a: Math.round(a), d: Math.round(Math.hypot(cx, cy)) });
  } else if (t.highway) {
    const kind = /motorway|trunk|primary/.test(t.highway) ? 0 : /secondary|tertiary/.test(t.highway) ? 1 : 2;
    const pts = line(el.geometry, 1.2);
    if (pts.length >= 4) streets.push({ pts, k: kind });
  }
}

// The campus is the footprint that contains the map pin, or failing that the nearest large one.
let campus = buildings.find((b) => inside(b.pts, 0, 0));
if (!campus) campus = buildings.filter((b) => b.a > 1500).sort((p, q) => p.d - q.d)[0];
if (campus) campus.campus = true;

const arterials = [];
const coast = [];
for (const el of far.elements) {
  if (el.type !== 'way' || !el.geometry) continue;
  const t = el.tags || {};
  if (t.natural === 'coastline') {
    const pts = line(el.geometry, 14, 0);
    if (pts.length >= 4) coast.push(pts);
  } else if (t.highway) {
    const pts = line(el.geometry, 10, 0);
    if (pts.length >= 4) arterials.push({ pts, k: /link/.test(t.highway) ? 1 : 0 });
  }
}

await mkdir(path.dirname(out), { recursive: true });
const data = { origin: ORIGIN, buildings: buildings.map(({ id, a, d, ...b }) => b), streets, arterials, coast };
await writeFile(out, JSON.stringify(data));
console.log(
  `city.json: ${buildings.length} buildings (${buildings.filter((b) => b.tagged).length} with heights), ${streets.length} streets, ${arterials.length} arterials, ${coast.length} coast lines, ${(JSON.stringify(data).length / 1024).toFixed(0)} kB`,
);
if (campus) console.log(`campus footprint: "${campus.name ?? 'unnamed'}" area ${campus.a} m2, ${campus.pts.length / 2} points, h ${campus.h}, ${campus.d} m from pin`);
console.log('named near the pin:', buildings.filter((b) => b.name && b.d < 300).map((b) => `${b.name} (${b.d} m)`).join('; '));
