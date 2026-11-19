import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { heatLut, tempColor } from '../../lib/color';
import { damp, type Frame } from '../../lib/frame';
import { CEIL, PLAN } from './layout';

/* ---------- room air, drawn as a soft volume tinted by its temperature ---------- */

const volVertex = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vPos = position;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const volFragment = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec3 vView;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uHeight;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main() {
    float y = (vPos.y + uHeight * 0.5) / uHeight;
    // denser near the floor, thinning towards the ceiling
    float body = mix(1.0, 0.25, smoothstep(0.0, 1.0, y));
    float drift = noise(vec3(vPos.x * 0.55, vPos.y * 0.9 - uTime * 0.12, vPos.z * 0.55 + uTime * 0.05));
    float rim = pow(1.0 - abs(dot(vNormal, vView)), 2.0);
    float a = uOpacity * (body * (0.72 + 0.4 * drift) + rim * 0.55);
    gl_FragColor = vec4(uColor * (1.0 + rim * 0.6), a);
  }
`;

export function AirVolumes({ frame, strength = 0.5 }: { frame: React.RefObject<Frame>; strength?: number }) {
  const shown = useRef([24, 24, 24]);
  const opacity = useRef(0);
  // materials are built by hand so their uniforms are ours to drive every frame
  const mats = useMemo(
    () =>
      PLAN.map(
        () =>
          new THREE.ShaderMaterial({
            vertexShader: volVertex,
            fragmentShader: volFragment,
            uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 }, uTime: { value: 0 }, uHeight: { value: CEIL - 0.1 } },
            transparent: true,
            depthWrite: false,
            side: THREE.FrontSide,
          }),
      ),
    [],
  );

  useFrame((state, dt) => {
    const f = frame.current;
    if (!f) return;
    opacity.current = damp(opacity.current, strength, 4, dt);
    for (let i = 0; i < PLAN.length; i++) {
      shown.current[i] = damp(shown.current[i], f.temp[i], 6, dt);
      const u = mats[i].uniforms;
      tempColor(shown.current[i], u.uColor.value);
      u.uOpacity.value = 0.34 * opacity.current;
      u.uTime.value = state.clock.elapsedTime;
    }
  });

  return (
    <group>
      {PLAN.map((p, i) => (
        <mesh key={i} position={[p.cx, (CEIL - 0.1) / 2 + 0.02, p.cz]} renderOrder={3} material={mats[i]}>
          <boxGeometry args={[p.x1 - p.x0 - 0.04, CEIL - 0.1, p.z1 - p.z0 - 0.04]} />
        </mesh>
      ))}
    </group>
  );
}

/* ---------- where people are, as a heat map on the floor ---------- */

const GW = 64;
const GH = 44;
const SIGMA = 0.62;

const heatVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const heatFragment = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uMap;
  uniform sampler2D uLut;
  uniform float uOpacity;
  uniform vec2 uTexel;
  void main() {
    // light blur so cells never show
    float d = 0.0;
    d += texture2D(uMap, vUv).r * 0.36;
    d += (texture2D(uMap, vUv + vec2(uTexel.x, 0.0)).r + texture2D(uMap, vUv - vec2(uTexel.x, 0.0)).r
        + texture2D(uMap, vUv + vec2(0.0, uTexel.y)).r + texture2D(uMap, vUv - vec2(0.0, uTexel.y)).r) * 0.16;
    vec4 c = texture2D(uLut, vec2(clamp(d, 0.0, 1.0), 0.5));
    // faint contour lines, like a thermal survey
    float bands = abs(fract(d * 7.0) - 0.5);
    float line = (1.0 - smoothstep(0.0, 0.06, bands)) * smoothstep(0.05, 0.2, d);
    vec3 col = c.rgb + line * 0.22;
    float edge = smoothstep(0.0, 0.03, vUv.x) * smoothstep(0.0, 0.03, 1.0 - vUv.x) * smoothstep(0.0, 0.04, vUv.y) * smoothstep(0.0, 0.04, 1.0 - vUv.y);
    gl_FragColor = vec4(col, c.a * uOpacity * edge);
  }
`;

export function HeatFloors({ frame, strength = 1 }: { frame: React.RefObject<Frame>; strength?: number }) {
  const opacity = useRef(0);
  const clock = useRef(0);
  const layers = useMemo(
    () =>
      PLAN.map((p) => {
        const data = new Uint8Array(GW * GH);
        const acc = new Float32Array(GW * GH);
        const tex = new THREE.DataTexture(data, GW, GH, THREE.RedFormat);
        tex.minFilter = tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        const mat = new THREE.ShaderMaterial({
          vertexShader: heatVertex,
          fragmentShader: heatFragment,
          uniforms: { uMap: { value: tex }, uLut: { value: heatLut() }, uOpacity: { value: 0 }, uTexel: { value: new THREE.Vector2(1 / GW, 1 / GH) } },
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        return { p, data, acc, tex, mat };
      }),
    [],
  );

  useFrame((_, dt) => {
    const f = frame.current;
    if (!f) return;
    opacity.current = damp(opacity.current, strength, 5, dt);
    clock.current += dt;
    const refresh = clock.current > 0.09;
    if (refresh) clock.current = 0;
    for (const l of layers) {
      l.mat.uniforms.uOpacity.value = opacity.current;
      if (!refresh || strength <= 0) continue;
      const { p, acc, data } = l;
      const w = p.x1 - p.x0;
      const d = p.z1 - p.z0;
      const cellX = w / GW;
      const cellZ = d / GH;
      const present = f.occ[p.index];
      const next = new Float32Array(GW * GH);
      const reach = Math.ceil((SIGMA * 2.6) / Math.min(cellX, cellZ));
      for (let s = 0; s < p.seats.length; s++) {
        const weight = Math.min(1, Math.max(0, present - s));
        if (weight <= 0) continue;
        const gx = (p.seats[s][0] - p.x0) / cellX;
        const gz = (p.seats[s][1] - p.z0) / cellZ;
        const ix = Math.floor(gx);
        const iz = Math.floor(gz);
        for (let dz = -reach; dz <= reach; dz++) {
          const z = iz + dz;
          if (z < 0 || z >= GH) continue;
          for (let dx = -reach; dx <= reach; dx++) {
            const x = ix + dx;
            if (x < 0 || x >= GW) continue;
            const rx = (x + 0.5 - gx) * cellX;
            const rz = (z + 0.5 - gz) * cellZ;
            next[z * GW + x] += weight * Math.exp(-(rx * rx + rz * rz) / (2 * SIGMA * SIGMA));
          }
        }
      }
      for (let k = 0; k < next.length; k++) {
        acc[k] += (next[k] - acc[k]) * 0.35;
        data[k] = Math.min(255, acc[k] * 118);
      }
      l.tex.needsUpdate = true;
    }
  });

  return (
    <group>
      {layers.map((l) => (
        <mesh key={l.p.index} rotation-x={-Math.PI / 2} position={[l.p.cx, 0.025, l.p.cz]} scale={[1, -1, 1]} renderOrder={2} material={l.mat}>
          <planeGeometry args={[l.p.x1 - l.p.x0, l.p.z1 - l.p.z0]} />
        </mesh>
      ))}
    </group>
  );
}
