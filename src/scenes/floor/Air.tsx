import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { damp, type Frame } from '../../lib/frame';
import { DUCTS, DUCT_Y, PLAN, ROUTES, along } from './layout';

const COUNT = 2200;
const PLUME = 5.5;
const COLD = new THREE.Color('#9be9ff');
const NEUTRAL = new THREE.Color('#d2def5');

const pointVertex = /* glsl */ `
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
const pointFragment = /* glsl */ `
  varying float vAlpha;
  uniform vec3 uColor;
  uniform float uGain;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    a = a * a * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor * uGain, a);
  }
`;

const uvVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
/** Light running along a duct in the direction of flow. u is metres along the run. */
const flowFragment = /* glsl */ `
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uFlow;
  uniform float uPhase;
  void main() {
    float lane = 1.0 - smoothstep(0.1, 0.5, abs(vUv.y - 0.5));
    float w = fract(vUv.x / 1.15 - uPhase);
    float pulse = smoothstep(0.0, 0.12, w) * (1.0 - smoothstep(0.12, 0.62, w));
    float a = lane * (0.16 + pulse * 0.9) * uFlow;
    gl_FragColor = vec4(uColor * (0.7 + pulse * 1.3), a);
  }
`;
/** Cold air falling from a diffuser: v = 1 at the ceiling, 0 near the floor. */
const plumeFragment = /* glsl */ `
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uFlow;
  uniform float uPhase;
  void main() {
    float fall = pow(vUv.y, 1.6);
    float ring = 0.55 + 0.45 * sin((vUv.y * 5.0 + uPhase * 2.2) * 6.2832);
    float streak = 0.75 + 0.25 * sin(vUv.x * 6.2832 * 9.0 + uPhase * 3.0);
    gl_FragColor = vec4(uColor, fall * ring * streak * 0.2 * uFlow);
  }
`;

/**
 * Supply air, from the handler to the rooms. The ducts are clear so the air can
 * be seen moving in them; it leaves every diffuser in proportion to the fixed
 * duct split. An empty room gets its share of cold air like any other, which is
 * the whole problem with a shared zone.
 */
export default function Air({ frame, emphasis = 0 }: { frame: React.RefObject<Frame>; emphasis?: number }) {
  const level = useRef(0);
  const phase = useRef(0);

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

  const geo = useMemo(() => {
    const points = new THREE.BufferGeometry();
    points.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
    points.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(COUNT), 1));
    const size = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) size[i] = 0.1 + Math.random() * 0.12;
    points.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

    const shells: THREE.BufferGeometry[] = [];
    const strips: THREE.BufferGeometry[] = [];
    for (const r of DUCTS) {
      const dx = r.b[0] - r.a[0];
      const dy = r.b[1] - r.a[1];
      const dz = r.b[2] - r.a[2];
      const len = Math.hypot(dx, dy, dz);
      const mid = [(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2, (r.a[2] + r.b[2]) / 2] as const;
      const vertical = Math.abs(dy) > 0.01;
      const alongX = Math.abs(dx) > 0.01;
      const box = vertical ? new THREE.BoxGeometry(r.size, len, r.size) : alongX ? new THREE.BoxGeometry(len + r.size, r.size * 0.74, r.size) : new THREE.BoxGeometry(r.size, r.size * 0.74, len + r.size);
      box.translate(mid[0], mid[1], mid[2]);
      shells.push(box);
      if (vertical) continue;
      // a strip of light down the middle of the run, its u coordinate in metres along the flow
      const strip = new THREE.PlaneGeometry(len, r.size * 0.8);
      const uv = strip.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len);
      strip.rotateX(-Math.PI / 2);
      if (alongX) {
        if (dx < 0) strip.rotateY(Math.PI);
      } else strip.rotateY(dz > 0 ? -Math.PI / 2 : Math.PI / 2);
      strip.translate(mid[0], mid[1], mid[2]);
      strips.push(strip);
    }

    const plumes = ROUTES.map((r) => {
      const g = new THREE.CylinderGeometry(0.42, 2.1, 2.5, 28, 1, true);
      g.translate(r.pts[4][0], DUCT_Y - 0.36 - 1.25, r.pts[4][2]);
      return g;
    });
    const plates = ROUTES.map((r) => {
      const g = new THREE.BoxGeometry(0.95, 0.07, 0.95);
      g.translate(r.pts[4][0], DUCT_Y - 0.32, r.pts[4][2]);
      return g;
    });
    return { points, shells: mergeGeometries(shells), strips: mergeGeometries(strips), plumes: mergeGeometries(plumes), plates: mergeGeometries(plates) };
  }, []);

  const mats = useMemo(
    () => ({
      points: new THREE.ShaderMaterial({
        vertexShader: pointVertex,
        fragmentShader: pointFragment,
        uniforms: { uColor: { value: new THREE.Color('#9be9ff') }, uScale: { value: 600 }, uGain: { value: 1 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      shell: new THREE.MeshPhysicalMaterial({ color: '#eaf3ff', transparent: true, opacity: 0.16, roughness: 0.08, metalness: 0.1, envMapIntensity: 2.2, depthWrite: false, side: THREE.DoubleSide }),
      strip: new THREE.ShaderMaterial({
        vertexShader: uvVertex,
        fragmentShader: flowFragment,
        uniforms: { uColor: { value: new THREE.Color('#9be9ff') }, uFlow: { value: 0 }, uPhase: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
      plume: new THREE.ShaderMaterial({
        vertexShader: uvVertex,
        fragmentShader: plumeFragment,
        uniforms: { uColor: { value: new THREE.Color('#9be9ff') }, uFlow: { value: 0 }, uPhase: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
      plate: new THREE.MeshStandardMaterial({ color: '#dfe9f8', roughness: 0.3, metalness: 0.8, emissive: '#9be9ff', emissiveIntensity: 0 }),
    }),
    [],
  );

  const p: [number, number, number] = [0, 0, 0];
  const tint = useMemo(() => new THREE.Color(), []);

  useFrame((state, dt) => {
    const f = frame.current;
    if (!f) return;
    level.current = damp(level.current, f.fan, 3, dt);
    const fan = level.current;
    phase.current += dt * (0.25 + 1.5 * fan) * (fan > 0.01 ? 1 : 0);

    const pos = geo.points.attributes.position as THREE.BufferAttribute;
    const alpha = geo.points.attributes.aAlpha as THREE.BufferAttribute;
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
      let a = 0.7;
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
        p[1] = DUCT_Y - 0.4 - q * 2.5;
        a = 0.7 * (1 - q) * (1 - q);
      }
      pos.setXYZ(i, p[0], p[1], p[2]);
      alpha.setX(i, a * Math.min(1, fan * 2.2));
    }
    pos.needsUpdate = true;
    alpha.needsUpdate = true;

    // cold air reads as ice, an idle coil as plain room air
    const cold = Math.min(1, Math.max(0, (24 - f.tSupply) / 10));
    tint.copy(NEUTRAL).lerp(COLD, cold);
    mats.points.uniforms.uColor.value.copy(tint);
    mats.points.uniforms.uGain.value = 0.8 + 1.3 * cold + 0.6 * emphasis;
    mats.points.uniforms.uScale.value = state.size.height * state.viewport.dpr * 0.9;
    for (const m of [mats.strip, mats.plume]) {
      m.uniforms.uColor.value.copy(tint);
      m.uniforms.uPhase.value = phase.current;
    }
    mats.strip.uniforms.uFlow.value = Math.min(1, fan * 1.6) * (0.75 + 0.5 * emphasis);
    mats.plume.uniforms.uFlow.value = Math.min(1, fan * 1.4) * (0.35 + 0.65 * cold) * (0.8 + 0.6 * emphasis);
    mats.plate.emissiveIntensity = 1.4 * fan * cold;
    mats.shell.opacity = 0.16 + 0.12 * emphasis;
  });

  return (
    <group>
      <mesh geometry={geo.shells} material={mats.shell} renderOrder={5} />
      <mesh geometry={geo.strips} material={mats.strip} renderOrder={6} />
      <mesh geometry={geo.plates} material={mats.plate} castShadow />
      <mesh geometry={geo.plumes} material={mats.plume} renderOrder={6} />
      <points geometry={geo.points} material={mats.points} frustumCulled={false} renderOrder={7} />
    </group>
  );
}
