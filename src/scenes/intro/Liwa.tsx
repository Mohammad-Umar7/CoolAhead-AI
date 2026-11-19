import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CAMPUS } from './data';
import type { IntroState } from './IntroScene';

const L = CAMPUS.length / 2;
const D = CAMPUS.depth / 2;
const FLOOR = 3.5;
/** storey of the simulated zone */
export const ZONE_LEVEL = 3;
export const ZONE_Y = (ZONE_LEVEL - 1) * FLOOR;

type Kind = 'stone' | 'punched' | 'glass';

/** A box whose faces carry a facade coordinate: distance along the wall, and height. */
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const f = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    f[i * 2] = Math.abs(n.getX(i)) > 0.5 ? p.getZ(i) : p.getX(i);
    f[i * 2 + 1] = p.getY(i);
  }
  g.setAttribute('facade', new THREE.BufferAttribute(f, 2));
  g.deleteAttribute('uv');
  return g;
}

/** A round glazed bay: the facade coordinate follows the curve. */
function drum(cx: number, cz: number, r: number, y0: number, y1: number) {
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, 40, 1, false).toNonIndexed();
  g.translate(cx, (y0 + y1) / 2, cz);
  const p = g.attributes.position;
  const f = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    f[i * 2] = Math.atan2(p.getZ(i) - cz, p.getX(i) - cx) * r;
    f[i * 2 + 1] = p.getY(i);
  }
  g.setAttribute('facade', new THREE.BufferAttribute(f, 2));
  g.deleteAttribute('uv');
  return g;
}

/**
 * Massing of the Abu Dhabi campus building, after photographs of it: a long
 * stone slab, a projecting centre with a glazed bay and fins under a deep
 * cornice, glazed portals at both ends and a round glass bay between them.
 */
function massing(): Record<Kind, THREE.BufferGeometry> {
  const H = CAMPUS.height;
  const parts: Record<Kind, THREE.BufferGeometry[]> = { stone: [], punched: [], glass: [] };
  const zf = D - 1; // front line of the slab

  // the slab itself: stone with regular window openings
  parts.punched.push(box(-L, L, 0, H - 2, -D, zf));
  parts.stone.push(box(-L - 0.3, L + 0.3, H - 2, H - 1.2, -D - 0.3, zf + 0.3));

  // left portal: stone frame, glass infill
  parts.stone.push(box(-L, -L + 2, 0, H, zf, D), box(-L + 12, -L + 14, 0, H, zf, D), box(-L, -L + 14, H - 5, H, zf, D), box(-L, -L + 14, 0, 4.2, zf, D));
  parts.glass.push(box(-L + 2, -L + 12, 4.2, H - 5, zf, D - 0.35));

  // round glazed bay
  parts.glass.push(drum(-L + 18.6, zf, 4.1, 3.6, H - 8.5));
  parts.stone.push(drum(-L + 18.6, zf, 4.35, H - 8.5, H - 7.6), drum(-L + 18.6, zf, 4.35, 2.9, 3.6));

  // centre block, standing forward of the slab and above it
  const c0 = -9;
  const c1 = 11;
  const zc = D + 2.2;
  parts.stone.push(box(c0, c0 + 2.4, 0, H + 2.6, zf, zc), box(c1 - 2.4, c1, 0, H + 2.6, zf, zc), box(c0, c1, H - 6.2, H + 2.6, zf, zc - 0.5), box(c0, c1, 11.6, 19, zf, zc - 0.25));
  parts.glass.push(box(c0 + 2.4, c1 - 2.4, 19, H - 6.2, zf, zc + 0.55), box(c0 + 2.4, c1 - 2.4, 0.8, 11.6, zf, zc - 0.5));
  // fins across the two top storeys and the cornice above them
  for (let x = c0 + 1.1; x <= c1 - 1; x += 1.62) parts.stone.push(box(x - 0.11, x + 0.11, H - 6.2, H + 2.2, zc - 0.5, zc + 0.5));
  parts.stone.push(box(c0 - 1.3, c1 + 1.3, H + 2.6, H + 3.3, zf - 2.5, zc + 1.6));

  // right portal: the tall glass front that carries the university's name
  parts.stone.push(box(13.2, 15.2, 0, H + 1.2, zf, D + 0.3), box(L - 2, L, 0, H + 1.2, zf, D + 0.3), box(13.2, L, H - 3.4, H + 1.2, zf, D + 0.3), box(13.2, L, 0, 4.6, zf, D + 0.3));
  parts.glass.push(box(15.2, L - 2, 4.6, H - 3.4, zf, D - 0.1));

  // entrance canopies and roof plant
  parts.stone.push(box(-2.6, 4.6, 4.3, 4.75, zc, zc + 4.2), box(19, 28, 4.5, 4.95, D + 0.3, D + 3.6), box(-L + 3, -L + 11, 4.3, 4.7, D, D + 3));
  parts.stone.push(box(-22, -12, H - 1.2, H + 2, -6.5, 1.5), box(17, 30, H - 1.2, H + 1.6, -7, 2), box(-3, 6, H - 1.2, H + 3, -8.5, -2.5));

  return { stone: mergeGeometries(parts.stone), punched: mergeGeometries(parts.punched), glass: mergeGeometries(parts.glass) };
}

const vertex = /* glsl */ `
  attribute vec2 facade;
  varying vec2 vFacade;
  varying vec3 vNormalW;
  varying vec3 vPos;
  varying vec3 vView;
  void main() {
    vFacade = facade;
    vPos = position;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vView = normalize(cameraPosition - w.xyz);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  varying vec2 vFacade;
  varying vec3 vNormalW;
  varying vec3 vPos;
  varying vec3 vView;
  uniform float uKind;    // 0 stone, 1 stone with windows, 2 curtain wall
  uniform float uScan;    // height of the x-ray front; everything above it is see-through
  uniform float uXray;    // 0 draws the solid part, 1 the see-through part
  uniform float uLit;
  uniform float uTime;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    float above = step(uScan, vPos.y);
    float band = 1.0 - smoothstep(0.0, 0.5, abs(vPos.y - uScan));
    float wall = step(abs(vNormalW.y), 0.5);

    float floorH = 3.5;
    float fy = fract(vFacade.y / floorH);
    float fi = floor(vFacade.y / floorH);

    if (uXray > 0.5) {
      // see-through shell: storey lines and a sparse grid, nothing else
      if (above < 0.5) discard;
      float storey = (1.0 - smoothstep(0.0, 0.035, min(fy, 1.0 - fy))) * wall;
      float bay = (1.0 - smoothstep(0.0, 0.03, abs(fract(vFacade.x / 6.0) - 0.5) * 2.0 - 0.94)) * wall * 0.0;
      float rim = pow(1.0 - abs(dot(normalize(vNormalW), vView)), 2.5);
      float a = 0.014 + storey * 0.22 + rim * 0.09 + band * 0.6 + bay;
      vec3 shell = mix(vec3(0.82, 0.9, 1.0), vec3(1.0, 0.84, 0.16), band);
      gl_FragColor = vec4(shell * (0.8 + band * 1.6), a);
      return;
    }
    if (above > 0.5) discard;

    // light of early evening: a low warm key from the south-west, cool sky fill
    vec3 n = normalize(vNormalW);
    float key = max(dot(n, normalize(vec3(-0.55, 0.5, 0.67))), 0.0);
    float sky = 0.5 + 0.5 * n.y;
    vec3 stone = vec3(0.3, 0.255, 0.2);
    vec3 col = stone * (0.1 + 0.62 * key + 0.16 * sky);
    // stone courses
    col *= 0.94 + 0.06 * step(0.06, fract(vFacade.y / 0.875));
    vec3 glow = vec3(0.0);

    if (uKind > 1.5 && wall > 0.5) {
      // curtain wall: green glass, spandrel at every slab, a mullion every 1.5 m
      float fx = fract(vFacade.x / 1.5);
      float ci = floor(vFacade.x / 1.5);
      float spandrel = 1.0 - step(0.2, fy);
      float mullion = max(1.0 - smoothstep(0.0, 0.05, min(fx, 1.0 - fx)), 1.0 - smoothstep(0.0, 0.04, min(fy, 1.0 - fy)));
      float fres = pow(1.0 - max(dot(n, vView), 0.0), 3.0);
      vec3 glass = mix(vec3(0.012, 0.04, 0.1), vec3(0.05, 0.15, 0.3), fres + 0.25 * key);
      glass = mix(glass, vec3(0.008, 0.026, 0.07), spandrel * 0.7);
      // rooms with the lights on
      float r = hash(vec2(ci, fi));
      float on = step(1.0 - 0.3 * uLit, r) * (1.0 - spandrel);
      vec3 lamp = mix(vec3(0.82, 0.92, 1.0), vec3(1.0, 0.82, 0.3), step(0.4, hash(vec2(fi, ci * 1.7))));
      glow = lamp * on * (0.55 + 0.45 * hash(vec2(ci * 3.1, fi * 2.3)));
      col = mix(glass, vec3(0.1, 0.15, 0.24), mullion * 0.8);
    } else if (uKind > 0.5 && wall > 0.5) {
      // stone wall with a window in every bay
      float fx = fract(vFacade.x / 3.0);
      float ci = floor(vFacade.x / 3.0);
      float win = step(0.26, fx) * step(fx, 0.74) * step(0.22, fy) * step(fy, 0.8) * step(1.0, fi);
      float r = hash(vec2(ci + 7.0, fi));
      float on = step(1.0 - 0.3 * uLit, r) * win;
      vec3 lamp = mix(vec3(1.0, 0.82, 0.3), vec3(0.82, 0.92, 1.0), step(0.7, hash(vec2(fi * 1.3, ci))));
      glow = lamp * on * 0.8;
      col = mix(col, vec3(0.012, 0.035, 0.085), win);
    }

    col += glow * 0.62;
    col += vec3(1.0, 0.84, 0.16) * band * 2.4;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function facadeMaterial(kind: number, xray: boolean) {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: { uKind: { value: kind }, uScan: { value: 999 }, uXray: { value: xray ? 1 : 0 }, uLit: { value: 0 }, uTime: { value: 0 } },
    transparent: xray,
    depthWrite: !xray,
    side: xray ? THREE.DoubleSide : THREE.FrontSide,
    blending: xray ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

/**
 * The campus building. It arrives solid, lit for the evening; then an x-ray
 * front passes down it and leaves the storeys visible, with the simulated zone
 * picked out on level three.
 */
export default function Liwa({ state }: { state: React.RefObject<IntroState> }) {
  const group = useRef<THREE.Group>(null);
  const inside = useRef<THREE.Group>(null);
  const signMesh = useRef<THREE.Mesh>(null);
  const geo = useMemo(massing, []);
  const mats = useMemo(
    () => ({
      solid: [facadeMaterial(0, false), facadeMaterial(1, false), facadeMaterial(2, false)],
      ghost: [facadeMaterial(0, true), facadeMaterial(1, true), facadeMaterial(2, true)],
      slab: new THREE.MeshBasicMaterial({ color: '#dbe8ff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
      slabEdge: new THREE.LineBasicMaterial({ color: '#dbe8ff', transparent: true, opacity: 0, depthWrite: false }),
      zone: new THREE.MeshBasicMaterial({ color: '#f3d004', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      zoneEdge: new THREE.LineBasicMaterial({ color: '#ffe24a', transparent: true, opacity: 0, depthWrite: false }),
      core: new THREE.LineBasicMaterial({ color: '#a9c6f7', transparent: true, opacity: 0, depthWrite: false }),
    }),
    [],
  );

  const interior = useMemo(() => {
    // storey plates, as outlines
    const plate: number[] = [];
    const zf = D - 1;
    for (let k = 1; k <= CAMPUS.floors; k++) {
      const y = k * FLOOR;
      plate.push(-L, y, -D, L, y, -D, L, y, -D, L, y, zf, L, y, zf, -L, y, zf, -L, y, zf, -L, y, -D);
    }
    const plates = new THREE.BufferGeometry();
    plates.setAttribute('position', new THREE.Float32BufferAttribute(plate, 3));
    // lift and stair cores
    const core: number[] = [];
    for (const [x0, x1, z0, z1] of [[-14, -9, -8, -3], [12, 17, -8, -3]]) {
      for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) core.push(x, 0, z, x, CAMPUS.height - 2, z);
    }
    const cores = new THREE.BufferGeometry();
    cores.setAttribute('position', new THREE.Float32BufferAttribute(core, 3));
    // the three classrooms and plant room of the simulated zone
    const zone = new THREE.BoxGeometry(34, FLOOR - 0.5, 9.5);
    zone.translate(-15, ZONE_Y + FLOOR / 2, 4.6);
    return { plates, cores, zone, zoneEdge: new THREE.EdgesGeometry(zone) };
  }, []);

  useFrame((clock) => {
    const s = state.current;
    if (!s || !group.current) return;
    const { smoothstep } = THREE.MathUtils;
    const rise = 1 - smoothstep(s.alt, 1300, 5200);
    group.current.visible = rise > 0.001;
    group.current.scale.y = Math.max(0.001, rise * rise * (3 - 2 * rise));
    // the x-ray front travels from above the roof down to the pavement
    const scan = s.xray <= 0 ? 999 : THREE.MathUtils.lerp(CAMPUS.height + 5, -1.5, s.xray);
    const lit = 1 - smoothstep(s.alt, 400, 2400);
    for (const m of [...mats.solid, ...mats.ghost]) {
      m.uniforms.uScan.value = scan;
      m.uniforms.uLit.value = lit;
      m.uniforms.uTime.value = clock.clock.elapsedTime;
    }
    const through = smoothstep(s.xray, 0.05, 0.6);
    mats.slabEdge.opacity = 0.34 * through;
    mats.core.opacity = 0.3 * through;
    const reached = smoothstep(s.xray, 0.62, 0.86);
    const pulse = 0.75 + 0.25 * Math.sin(clock.clock.elapsedTime * 2.4);
    mats.zone.opacity = 0.34 * reached * pulse;
    mats.zoneEdge.opacity = reached;
    if (inside.current) inside.current.visible = s.xray > 0.01;
    // the name on the portal goes when the x-ray front passes it
    sign.opacity = lit * (scan > CAMPUS.height - 1 ? 1 : 0);
  });

  const sign = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 160;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f3d004';
    g.font = '600 92px "Archivo Variable", Archivo, sans-serif';
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillText('LIWA UNIVERSITY', 512, 86);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false });
  }, []);

  const order: Kind[] = ['stone', 'punched', 'glass'];
  return (
    <group ref={group} position={[CAMPUS.east, 0, -CAMPUS.north]} rotation-y={CAMPUS.yaw}>
      {order.map((k, i) => (
        <mesh key={k} geometry={geo[k]} material={mats.solid[i]} />
      ))}
      {order.map((k, i) => (
        <mesh key={`x${k}`} geometry={geo[k]} material={mats.ghost[i]} renderOrder={4} />
      ))}
      <mesh ref={signMesh} position={[(15.2 + L - 2) / 2, CAMPUS.height - 1.1, D + 0.36]} material={sign}>
        <planeGeometry args={[15.4, 2.4]} />
      </mesh>
      <group ref={inside} visible={false}>
        <lineSegments geometry={interior.plates} material={mats.slabEdge} />
        <lineSegments geometry={interior.cores} material={mats.core} />
        <mesh geometry={interior.zone} material={mats.zone} renderOrder={5} />
        <lineSegments geometry={interior.zoneEdge} material={mats.zoneEdge} renderOrder={6} />
      </group>
    </group>
  );
}
