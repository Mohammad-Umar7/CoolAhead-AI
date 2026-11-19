import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import type { Line2 } from 'three-stdlib';
import { uiScale } from '../../lib/fit';
import type { GeoData } from './data';
import type { IntroState } from './IntroScene';

const R = 6371008.8;
const RAD = Math.PI / 180;

/** [x, y, ...] east/north metres to scene points: x east, z south. */
const toPoints = (flat: number[]) => {
  const pts: [number, number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], 0, -flat[i + 1]]);
  return pts;
};

function inside(ring: number[], px: number, py: number) {
  let hit = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i];
    const yi = ring[i + 1];
    const xj = ring[j];
    const yj = ring[j + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const segments = (lines: number[][], y = 0) => {
  const out: number[] = [];
  for (const flat of lines) for (let i = 0; i < flat.length - 2; i += 2) out.push(flat[i], y, -flat[i + 1], flat[i + 2], y, -flat[i + 3]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return g;
};

/**
 * The country seen from orbit: the coastline and borders draw themselves, the
 * land fills in as a dot matrix, and the seven emirates and neighbours follow.
 */
export default function Country({ geo, state }: { geo: GeoData; state: React.RefObject<IntroState> }) {
  const rings = useMemo(() => geo.outline.map(toPoints).sort((a, b) => b.length - a.length), [geo]);
  const lines = useRef<(Line2 | null)[]>([]);
  const glow = useRef<(Line2 | null)[]>([]);

  const borders = useMemo(() => segments(geo.emirates.flatMap((e) => e.rings)), [geo]);
  const neighbours = useMemo(() => segments(geo.neighbours.map((n) => n.pts)), [geo]);

  const graticule = useMemo(() => {
    const cos0 = Math.cos(geo.origin.lat * RAD);
    const x = (lon: number) => R * cos0 * (lon - geo.origin.lon) * RAD;
    const y = (lat: number) => R * (lat - geo.origin.lat) * RAD;
    const flat: number[][] = [];
    for (let lon = 50; lon <= 59; lon++) flat.push([x(lon), y(21), x(lon), y(28)]);
    for (let lat = 21; lat <= 28; lat++) flat.push([x(50), y(lat), x(59), y(lat)]);
    return segments(flat, -400);
  }, [geo]);

  const dots = useMemo(() => {
    const main = geo.outline.slice().sort((a, b) => b.length - a.length);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < main[0].length; i += 2) {
      x0 = Math.min(x0, main[0][i]);
      x1 = Math.max(x1, main[0][i]);
      y0 = Math.min(y0, main[0][i + 1]);
      y1 = Math.max(y1, main[0][i + 1]);
    }
    const step = 6200;
    const pos: number[] = [];
    for (let y = y0; y <= y1; y += step) {
      // offset every other row: a hexagonal dot pattern reads as a surface, not a table
      const shift = Math.round((y - y0) / step) % 2 ? step / 2 : 0;
      for (let x = x0 + shift; x <= x1; x += step) if (main.some((r) => inside(r, x, y))) pos.push(x, 0, -y);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, [geo]);

  const mats = useMemo(
    () => ({
      borders: new THREE.LineBasicMaterial({ color: '#c6d8f7', transparent: true, opacity: 0, depthWrite: false }),
      neighbours: new THREE.LineBasicMaterial({ color: '#6f8cc4', transparent: true, opacity: 0, depthWrite: false }),
      graticule: new THREE.LineBasicMaterial({ color: '#2f5192', transparent: true, opacity: 0, depthWrite: false }),
      dots: new THREE.PointsMaterial({ color: '#a9c6f7', size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }),
    }),
    [],
  );

  useFrame(() => {
    const s = state.current;
    if (!s) return;
    // everything at country scale fades as the camera drops through the tens of kilometres
    const far = THREE.MathUtils.smoothstep(s.alt, 120000, 330000);
    for (let i = 0; i < rings.length; i++) {
      const total = rings[i].length - 1;
      const shown = Math.max(0, Math.min(total, Math.floor(s.draw * total)));
      for (const set of [lines.current, glow.current]) {
        const l = set[i];
        if (!l) continue;
        l.geometry.instanceCount = shown;
        l.visible = shown > 0 && far > 0.002;
        l.material.opacity = (set === glow.current ? 0.2 : 1) * far;
      }
    }
    mats.borders.opacity = 0.42 * s.detail * far;
    mats.neighbours.opacity = 0.8 * s.detail * far;
    mats.dots.opacity = 0.62 * s.detail * THREE.MathUtils.smoothstep(s.alt, 60000, 240000);
    mats.graticule.opacity = (0.5 + 0.5 * s.detail) * far;
  });

  // the outline is drawn in screen pixels, so it is scaled with the rest of the interface
  const k = uiScale();
  return (
    <group>
      <lineSegments geometry={graticule} material={mats.graticule} />
      <lineSegments geometry={neighbours} material={mats.neighbours} />
      <points geometry={dots} material={mats.dots} />
      <lineSegments geometry={borders} material={mats.borders} />
      {rings.map((pts, i) => (
        <group key={i}>
          <Line ref={(l) => void (glow.current[i] = l as Line2 | null)} points={pts} color="#f3d004" lineWidth={6 * k} transparent opacity={0.2} depthWrite={false} />
          <Line ref={(l) => void (lines.current[i] = l as Line2 | null)} points={pts} color="#ffe24a" lineWidth={1.7 * k} transparent depthWrite={false} />
        </group>
      ))}
    </group>
  );
}
