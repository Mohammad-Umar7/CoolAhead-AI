import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CAMPUS, type CityData } from './data';
import type { IntroState } from './IntroScene';

const lineGeometry = (lines: number[][], y = 0) => {
  const out: number[] = [];
  for (const flat of lines) for (let i = 0; i < flat.length - 2; i += 2) out.push(flat[i], y, -flat[i + 1], flat[i + 2], y, -flat[i + 3]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return g;
};

/** Extrude every mapped footprint into one mesh, and keep its outline as a second, line geometry. */
function extrude(buildings: CityData['buildings']) {
  const pos: number[] = [];
  const shade: number[] = [];
  const idx: number[] = [];
  const edges: number[] = [];
  for (const b of buildings) {
    if (b.campus) continue;
    const n = b.pts.length / 2 - 1;
    if (n < 3) continue;
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(b.pts[i * 2], b.pts[i * 2 + 1]));
    if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
    const h = b.h;
    const base = pos.length / 3;
    // roof
    for (const p of contour) {
      pos.push(p.x, h, -p.y);
      shade.push(1);
    }
    for (const [a, c, d] of THREE.ShapeUtils.triangulateShape(contour, [])) idx.push(base + a, base + c, base + d);
    // walls, darker towards the ground
    for (let i = 0; i < n; i++) {
      const p = contour[i];
      const q = contour[(i + 1) % n];
      const w = pos.length / 3;
      pos.push(p.x, 0, -p.y, q.x, 0, -q.y, q.x, h, -q.y, p.x, h, -p.y);
      shade.push(0.08, 0.08, 0.62, 0.62);
      idx.push(w, w + 1, w + 2, w, w + 2, w + 3);
      edges.push(p.x, h, -p.y, q.x, h, -q.y, p.x, 0, -p.y, p.x, h, -p.y);
    }
  }
  const mesh = new THREE.BufferGeometry();
  mesh.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  mesh.setAttribute('shade', new THREE.Float32BufferAttribute(shade, 1));
  mesh.setIndex(idx);
  mesh.computeVertexNormals();
  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
  return { mesh, lines };
}

const blockVertex = /* glsl */ `
  attribute float shade;
  varying float vShade;
  varying vec3 vWorld;
  void main() {
    vShade = shade;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const blockFragment = /* glsl */ `
  varying float vShade;
  varying vec3 vWorld;
  uniform float uOpacity;
  uniform vec3 uFocus;
  uniform float uClear;
  void main() {
    // anything standing between the camera and the campus is cut away, leaving its outline
    vec3 axis = uFocus - cameraPosition;
    float along = dot(vWorld - cameraPosition, axis) / dot(axis, axis);
    float off = length(vWorld - (cameraPosition + axis * clamp(along, 0.0, 1.0)));
    if (uClear > 0.5 && along > -0.2 && along < 0.86 && off < 46.0 + 70.0 * (1.0 - along)) discard;
    // unlit and graded by height: a massing model in the university's navy
    vec3 low = vec3(0.005, 0.016, 0.062);
    vec3 high = vec3(0.022, 0.058, 0.18);
    float near = 1.0 - smoothstep(100.0, 800.0, length(vWorld.xz - uFocus.xz));
    vec3 col = mix(low, high, vShade) * (0.62 + 0.7 * near);
    gl_FragColor = vec4(col, uOpacity);
  }
`;

/**
 * Abu Dhabi as the camera comes down: first the island's coast and main roads,
 * then the street grid, then the real building footprints rising around the campus.
 */
export default function City({ city, state }: { city: CityData; state: React.RefObject<IntroState> }) {
  const blocks = useRef<THREE.Group>(null);
  const geo = useMemo(() => {
    const { mesh, lines } = extrude(city.buildings);
    return {
      mesh,
      lines,
      coast: lineGeometry(city.coast, 2),
      arterials: lineGeometry(city.arterials.filter((a) => a.k === 0).map((a) => a.pts), 3),
      links: lineGeometry(city.arterials.filter((a) => a.k !== 0).map((a) => a.pts), 3),
      main: lineGeometry(city.streets.filter((s) => s.k < 2).map((s) => s.pts), 0.4),
      minor: lineGeometry(city.streets.filter((s) => s.k === 2).map((s) => s.pts), 0.3),
    };
  }, [city]);

  const mats = useMemo(
    () => ({
      coast: new THREE.LineBasicMaterial({ color: '#a9c6f7', transparent: true, opacity: 0, depthWrite: false }),
      arterials: new THREE.LineBasicMaterial({ color: '#f3d004', transparent: true, opacity: 0, depthWrite: false }),
      links: new THREE.LineBasicMaterial({ color: '#c9a61a', transparent: true, opacity: 0, depthWrite: false }),
      main: new THREE.LineBasicMaterial({ color: '#f3d004', transparent: true, opacity: 0, depthWrite: false }),
      minor: new THREE.LineBasicMaterial({ color: '#7f9fd8', transparent: true, opacity: 0, depthWrite: false }),
      blocks: new THREE.ShaderMaterial({
        vertexShader: blockVertex,
        fragmentShader: blockFragment,
        uniforms: { uOpacity: { value: 1 }, uFocus: { value: new THREE.Vector3(CAMPUS.east, 18, -CAMPUS.north) }, uClear: { value: 0 } },
        transparent: true,
      }),
      edges: new THREE.LineBasicMaterial({ color: '#b9d2f5', transparent: true, opacity: 0, depthWrite: false }),
    }),
    [],
  );

  useFrame(() => {
    const s = state.current;
    if (!s) return;
    const { smoothstep } = THREE.MathUtils;
    const alt = s.alt;
    // each layer has the band of altitudes it is legible in
    const island = (1 - smoothstep(alt, 70000, 240000)) * smoothstep(alt, 700, 2600);
    mats.coast.opacity = 0.75 * island + 0.12 * (1 - smoothstep(alt, 700, 2600));
    mats.arterials.opacity = 0.7 * island;
    mats.links.opacity = 0.4 * island;
    const streets = 1 - smoothstep(alt, 2500, 9000);
    mats.main.opacity = 0.5 * streets;
    mats.minor.opacity = 0.34 * streets;
    const rise = 1 - smoothstep(alt, 1500, 6000);
    if (blocks.current) {
      blocks.current.visible = rise > 0.001;
      blocks.current.scale.y = Math.max(0.001, rise * rise * (3 - 2 * rise));
    }
    mats.edges.opacity = 0.42 * rise;
    mats.blocks.uniforms.uOpacity.value = Math.min(1, rise * 1.5);
    mats.blocks.uniforms.uClear.value = alt < 900 ? 1 : 0;
  });

  return (
    <group>
      <lineSegments geometry={geo.coast} material={mats.coast} />
      <lineSegments geometry={geo.links} material={mats.links} />
      <lineSegments geometry={geo.arterials} material={mats.arterials} />
      <lineSegments geometry={geo.minor} material={mats.minor} />
      <lineSegments geometry={geo.main} material={mats.main} />
      <group ref={blocks}>
        <mesh geometry={geo.mesh} material={mats.blocks} />
        <lineSegments geometry={geo.lines} material={mats.edges} />
      </group>
    </group>
  );
}
