import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';
import { damp, type Frame } from '../../lib/frame';
import { MODEL } from '../../lib/theme';
import { AHU_POS, DUCT_Y, PLAN, RISER, ROUTES, TRUNK_Z, along } from './layout';

const COUNT = 1700;
const PLUME = 5.5;
const COLD = new THREE.Color('#8fe9ff');
const NEUTRAL = new THREE.Color('#c9d6ee');

const vertex = /* glsl */ `
  attribute float aAlpha;
  attribute float aSize;
  varying float vAlpha;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const fragment = /* glsl */ `
  varying float vAlpha;
  uniform vec3 uColor;
  uniform float uGain;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    float a = smoothstep(0.5, 0.05, d) * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor * uGain, a);
  }
`;

/** The supply ductwork: one riser, one trunk, a branch and a diffuser per outlet. */
function Ducts({ emphasis }: { emphasis: number }) {
  const lastX = ROUTES[ROUTES.length - 1].pts[3][0];
  const opacity = 0.1 + 0.12 * emphasis;
  const mat = <meshPhysicalMaterial color={MODEL.duct} transparent opacity={opacity} roughness={0.2} metalness={0.1} depthWrite={false} side={THREE.DoubleSide} />;
  const edge = emphasis > 0.5 ? MODEL.ductEdgeLit : MODEL.ductEdge;
  return (
    <group>
      <mesh position={[RISER.x, (AHU_POS.h + DUCT_Y) / 2, RISER.z]}>
        <boxGeometry args={[0.62, DUCT_Y - AHU_POS.h, 0.62]} />
        {mat}
        <Edges color={edge} threshold={20} />
      </mesh>
      <mesh position={[RISER.x, DUCT_Y, (RISER.z + TRUNK_Z) / 2]}>
        <boxGeometry args={[0.62, 0.46, TRUNK_Z - RISER.z + 0.62]} />
        {mat}
        <Edges color={edge} threshold={20} />
      </mesh>
      <mesh position={[(RISER.x + lastX) / 2, DUCT_Y, TRUNK_Z]}>
        <boxGeometry args={[lastX - RISER.x + 0.62, 0.46, 0.62]} />
        {mat}
        <Edges color={edge} threshold={20} />
      </mesh>
      {ROUTES.map((r, i) => {
        const [x, , z] = r.pts[4];
        return (
          <group key={i}>
            <mesh position={[x, DUCT_Y, (TRUNK_Z + z) / 2]}>
              <boxGeometry args={[0.42, 0.34, TRUNK_Z - z]} />
              {mat}
              <Edges color={edge} threshold={20} />
            </mesh>
            <mesh position={[x, DUCT_Y - 0.3, z]}>
              <boxGeometry args={[0.9, 0.08, 0.9]} />
              <meshStandardMaterial color="#3a5a98" roughness={0.5} metalness={0.4} />
              <Edges color="#ffffff" threshold={20} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/**
 * Air leaving the handler: particles ride the ducts and spill out of every
 * diffuser in proportion to the fixed duct split. An empty room gets its share
 * of cold air like any other, which is the whole problem with a shared zone.
 */
export default function Air({ frame, emphasis = 0 }: { frame: React.RefObject<Frame>; emphasis?: number }) {
  const points = useRef<THREE.Points>(null);
  const level = useRef(0);

  const sim = useMemo(() => {
    // hand out particles to routes in proportion to their share of the air
    const route = new Uint8Array(COUNT);
    const total = ROUTES.reduce((a, r) => a + r.share, 0);
    let k = 0;
    ROUTES.forEach((r, ri) => {
      const n = Math.round((r.share / total) * COUNT);
      for (let j = 0; j < n && k < COUNT; j++) route[k++] = ri;
    });
    while (k < COUNT) route[k++] = 1;
    const dist = new Float32Array(COUNT);
    const speed = new Float32Array(COUNT);
    const angle = new Float32Array(COUNT);
    const jitter = new Float32Array(COUNT * 2);
    for (let i = 0; i < COUNT; i++) {
      dist[i] = Math.random() * (ROUTES[route[i]].len + PLUME);
      speed[i] = 0.75 + Math.random() * 0.5;
      angle[i] = Math.random() * Math.PI * 2;
      jitter[i * 2] = (Math.random() - 0.5) * 0.3;
      jitter[i * 2 + 1] = (Math.random() - 0.5) * 0.24;
    }
    return { route, dist, speed, angle, jitter };
  }, []);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(COUNT), 1));
    const size = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) size[i] = 0.07 + Math.random() * 0.07;
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    return g;
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { uColor: { value: new THREE.Color('#8fe9ff') }, uScale: { value: 600 }, uGain: { value: 1 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const uniforms = material.uniforms;
  const p: [number, number, number] = [0, 0, 0];

  useFrame((state, dt) => {
    const f = frame.current;
    if (!f || !points.current) return;
    level.current = damp(level.current, f.fan, 3, dt);
    const fan = level.current;
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const alpha = geometry.attributes.aAlpha as THREE.BufferAttribute;
    const v = 7.5 * fan;
    for (let i = 0; i < COUNT; i++) {
      const r = ROUTES[sim.route[i]];
      const total = r.len + PLUME;
      let d = sim.dist[i] + v * sim.speed[i] * dt;
      if (d > total) {
        d -= total;
        sim.angle[i] = Math.random() * Math.PI * 2;
      }
      sim.dist[i] = d;
      let a = 0.85;
      if (d <= r.len) {
        along(r.pts, d, p);
        p[0] += sim.jitter[i * 2];
        p[1] += sim.jitter[i * 2 + 1];
        p[2] += sim.jitter[i * 2];
      } else {
        const q = (d - r.len) / PLUME;
        const room = PLAN[r.room];
        const end = r.pts[4];
        const spread = Math.pow(q, 0.62) * 3.4;
        p[0] = Math.min(room.x1 - 0.2, Math.max(room.x0 + 0.2, end[0] + Math.cos(sim.angle[i]) * spread));
        p[2] = Math.min(room.z1 - 0.2, Math.max(room.z0 + 0.2, end[2] + Math.sin(sim.angle[i]) * spread));
        p[1] = DUCT_Y - 0.35 - q * 2.3;
        a = 0.85 * (1 - q) * (1 - q);
      }
      pos.setXYZ(i, p[0], p[1], p[2]);
      alpha.setX(i, a * Math.min(1, fan * 2.2));
    }
    pos.needsUpdate = true;
    alpha.needsUpdate = true;
    // cold air reads as ice, an idle coil as neutral room air
    const cold = Math.min(1, Math.max(0, (24 - f.tSupply) / 10));
    uniforms.uColor.value.copy(NEUTRAL).lerp(COLD, cold);
    uniforms.uGain.value = 0.9 + 1.5 * cold + 0.8 * emphasis;
    uniforms.uScale.value = state.size.height * state.viewport.dpr * 0.9;
  });

  return (
    <group>
      <Ducts emphasis={emphasis} />
      <points ref={points} geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
}
