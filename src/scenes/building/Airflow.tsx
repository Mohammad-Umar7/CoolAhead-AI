import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { damp, type Frame } from '../../lib/frame';
import { AHU_POS, CORRIDOR, DUCT_Y, PLAN, ROUTES } from '../floor/layout';
import { Polyline, lin, smooth, type Look } from './kit';

/**
 * The air, drawn as what it does. Cold supply air runs down the ducts, pours
 * out of each ceiling diffuser and spreads across the floor; the warm air it
 * displaces is drawn back along the corridor to the air handler. Every line is
 * a tube with bright pulses travelling along it, as fast as the fan is turning.
 */

const vertex = /* glsl */ `
  attribute float phase;
  varying float vU;
  varying float vPhase;
  void main() {
    vU = uv.x;
    vPhase = phase;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  varying float vU;
  varying float vPhase;
  uniform float uTime;
  uniform float uFlow;
  uniform float uBands;
  uniform vec3 uFrom;
  uniform vec3 uTo;
  void main() {
    // pulses of air moving along the line, soft at both ends
    float head = fract(vU * uBands - uTime + vPhase);
    float pulse = smoothstep(0.0, 0.3, head) * (1.0 - smoothstep(0.6, 1.0, head));
    float ends = smoothstep(0.0, 0.06, vU) * (1.0 - smoothstep(0.72, 1.0, vU));
    float a = (0.3 + 0.7 * pulse) * ends * uFlow;
    if (a < 0.004) discard;
    gl_FragColor = vec4(mix(uFrom, uTo, vU), a);
  }
`;

function tubes(curves: THREE.Curve<THREE.Vector3>[], radius: number, segments = 44) {
  const parts = curves.map((c, i) => {
    const g = new THREE.TubeGeometry(c, segments, radius, 6, false);
    const phase = new Float32Array(g.attributes.position.count).fill((i * 0.381) % 1);
    g.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    return g;
  });
  return mergeGeometries(parts);
}

function flowMaterial(from: string, to: string, bands: number) {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uFlow: { value: 0 }, uBands: { value: bands }, uFrom: { value: lin(from) }, uTo: { value: lin(to) } },
  });
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Cold air leaving a diffuser: along the ceiling first, then down and out across the floor. */
function supplyCurves() {
  const out: THREE.Curve<THREE.Vector3>[] = [];
  PLAN.forEach((p) => {
    p.diffusers.forEach(([dx, dz], k) => {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + k * 0.4 + ((i * 7) % 5) * 0.03;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        // how far the jet can travel before it meets a wall
        const toX = cos > 0 ? (p.x1 - 0.5 - dx) / cos : cos < 0 ? (p.x0 + 0.5 - dx) / cos : 99;
        const toZ = sin > 0 ? (p.z1 - 0.5 - dz) / sin : sin < 0 ? (p.z0 + 0.5 - dz) / sin : 99;
        const reach = Math.min(toX, toZ, 3.1 + ((i * 3) % 4) * 0.35);
        const at = (r: number, y: number) => V(dx + cos * r, y, dz + sin * r);
        out.push(new THREE.CatmullRomCurve3([at(0.18, 2.62), at(reach * 0.3, 2.56), at(reach * 0.62, 2.1), at(reach * 0.86, 1.05), at(reach, 0.28), at(reach * 1.05, 0.12)], false, 'catmullrom', 0.5));
      }
    });
  });
  return out;
}

/** Warm air on its way back: up to the grille over each door, along the corridor ceiling, down into the air handler. */
function returnCurves() {
  const out: THREE.Curve<THREE.Vector3>[] = [];
  const zc = (CORRIDOR.z0 + CORRIDOR.z1) / 2;
  PLAN.forEach((p) => {
    const inward = p.side === 'north' ? -1 : 1;
    for (let i = 0; i < 1; i++) {
      const x = p.x0 + 0.5 * (p.x1 - p.x0);
      const lane = zc + (i - 1.5) * 0.28 + (p.side === 'north' ? -0.5 : 0.5);
      out.push(
        new THREE.CatmullRomCurve3(
          [
            V(x, 0.5, p.zCorridor + inward * 3.4),
            V(x, 1.5, p.zCorridor + inward * 1.6),
            V(x, 2.35, p.zCorridor + inward * 0.3),
            V(x - 0.4, 2.5, lane),
            V(Math.max(AHU_POS.x - 0.6, x * 0.5), 2.5, lane),
            V(AHU_POS.x - 1.0, 2.3, CORRIDOR.z1 + 0.6),
            V(AHU_POS.x - 1.0, 1.5, AHU_POS.z - AHU_POS.d / 2 - 0.5),
            V(AHU_POS.x - 1.0, 1.0, AHU_POS.z),
          ],
          false,
          'catmullrom',
          0.35,
        ),
      );
    }
  });
  return out;
}

/** The supply air inside the ducts, three strands to a route. */
function ductCurves() {
  const out: THREE.Curve<THREE.Vector3>[] = [];
  for (const r of ROUTES) {
    for (const o of [-0.1, 0, 0.1]) out.push(new Polyline(r.pts.map(([x, y, z]) => V(x + o, y === DUCT_Y ? y + o * 0.6 : y, z + o))));
  }
  return out;
}

interface Props {
  frame: React.RefObject<Frame>;
  look: React.RefObject<Look>;
}

export default function Airflow({ frame, look }: Props) {
  const flow = useRef(0);
  const clock = useRef(0);
  const geo = useMemo(() => ({ supply: tubes(supplyCurves(), 0.07), back: tubes(returnCurves(), 0.07, 60), duct: tubes(ductCurves(), 0.06, 70) }), []);
  const mats = useMemo(
    () => ({
      supply: flowMaterial('#0050ff', '#58b8ff', 2.0),
      back: flowMaterial('#ffa25e', '#ff6a2e', 3),
      duct: flowMaterial('#7cc4ff', '#0b5cff', 5),
    }),
    [],
  );
  const cones = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const diffusers = useMemo(() => PLAN.flatMap((p) => p.diffusers.map(([x, z]) => ({ x, z }))), []);
  // a faint veil of cold air under each diffuser, densest at the top
  const veil = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.22)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 64);
    return new THREE.CanvasTexture(c);
  }, []);

  useFrame((_, dt) => {
    const f = frame.current;
    const l = look.current;
    if (!f || !l) return;
    const open = smooth(l.focus);
    flow.current = damp(flow.current, f.fan, 2.5, dt);
    clock.current += dt * (0.12 + 0.5 * flow.current);
    const on = flow.current * open;
    // the coil decides how cold the supply air is: with the fan on and the coil idle it is only moving air
    const cold = Math.min(1, 0.35 + f.duty * 1.2);
    mats.supply.uniforms.uTime.value = clock.current;
    mats.supply.uniforms.uFlow.value = on * (0.5 + 0.5 * cold) * (1 - 0.75 * l.heat);
    mats.back.uniforms.uTime.value = clock.current * 0.8;
    mats.back.uniforms.uFlow.value = on * 0.75 * (1 - 0.75 * l.heat);
    mats.duct.uniforms.uTime.value = clock.current * 1.6;
    mats.duct.uniforms.uFlow.value = on * l.xray;
    for (const m of cones.current) if (m) m.opacity = 0.5 * on * cold * (1 - 0.7 * l.heat);
    // where the cold air lands it spreads: rings widening across the floor under each diffuser
    rings.current.forEach((m, i) => {
      if (!m) return;
      const u = (clock.current * 0.55 + (i % 3) / 3) % 1;
      m.scale.setScalar(0.5 + u * 3.4);
      (m.material as THREE.MeshBasicMaterial).opacity = (1 - u) * 0.6 * on * cold * (1 - 0.7 * l.heat);
    });
  });

  return (
    <group>
      <mesh geometry={geo.supply} material={mats.supply} renderOrder={3} />
      <mesh geometry={geo.back} material={mats.back} renderOrder={3} />
      <mesh geometry={geo.duct} material={mats.duct} renderOrder={4} />
      {diffusers.flatMap((d, i) =>
        [0, 1, 2].map((k) => (
          <mesh key={`${i}-${k}`} ref={(m) => void (rings.current[i * 3 + k] = m)} rotation-x={-Math.PI / 2} position={[d.x, 0.05, d.z]} renderOrder={2}>
            <ringGeometry args={[0.9, 1, 64]} />
            <meshBasicMaterial color="#2f8cff" transparent opacity={0} depthWrite={false} toneMapped={false} />
          </mesh>
        )),
      )}
      {diffusers.map((d, i) => (
        <mesh key={i} position={[d.x, 1.42, d.z]} renderOrder={2}>
          <cylinderGeometry args={[0.34, 2.3, 2.5, 40, 1, true]} />
          <meshBasicMaterial ref={(m) => void (cones.current[i] = m)} map={veil} color="#58a8ff" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
