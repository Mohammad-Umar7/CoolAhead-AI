import { use, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { AnchorEls } from '../Anchors';
import City from './City';
import Country from './Country';
import Liwa, { ZONE_Y } from './Liwa';
import { CAMPUS, cityData, geoData } from './data';

export interface IntroState {
  /** seconds since the sequence started */
  time: number;
  /** camera height above the ground it looks at, metres */
  alt: number;
  /** how much of the coastline has been drawn, 0..1 */
  draw: number;
  /** borders, dots and neighbours, 0..1 */
  detail: number;
  /** x-ray front through the building, 0..1 */
  xray: number;
  /** set to skip straight to the end */
  skip: boolean;
  /** 0..1 once the user asks to enter: the camera pushes into level three */
  enter: number;
}

export const newIntroState = (): IntroState => ({ time: 0, alt: 800000, draw: 0, detail: 0, xray: 0, skip: false, enter: 0 });

/** Beats of the sequence, seconds. */
export const BEAT = { draw: [0.5, 3.4], detail: [2.3, 3.8], ping: 3.9, dive: [4.9, 11.2], xray: [11.9, 14.4], title: 12.6, end: 14.6 };

const ALT_START = 760000;
const ALT_END = 78;
const COUNTRY = new THREE.Vector3(-52000, 0, 28000);
const CAMPUS_POS = new THREE.Vector3(CAMPUS.east, 0, -CAMPUS.north);
/** compass bearing the building's front is seen along (looking north-east at a south-west face) */
const FRONT = THREE.MathUtils.degToRad(52);

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const span = (t: number, [a, b]: number[]) => Math.min(1, Math.max(0, (t - a) / (b - a)));

export interface IntroHud {
  alt: HTMLElement | null;
  lat: HTMLElement | null;
  lon: HTMLElement | null;
  scale: HTMLElement | null;
}

interface Props {
  state: React.RefObject<IntroState>;
  labels: React.RefObject<AnchorEls>;
  hud: React.RefObject<IntroHud>;
}

const R = 6371008.8;
const RAD = Math.PI / 180;
const tmp = new THREE.Vector3();
const hd = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const fwd = new THREE.Vector3();
const target = new THREE.Vector3();
const basis = new THREE.Matrix4();

/** A marker that stays the same size on screen whatever the altitude. */
function Beacon({ state }: { state: React.RefObject<IntroState> }) {
  const ring = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);
  const dot = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const s = state.current;
    if (!s) return;
    const on = s.time >= BEAT.ping ? 1 : 0;
    const k = s.alt * 0.014;
    const since = Math.max(0, s.time - BEAT.ping);
    const fade = THREE.MathUtils.smoothstep(s.alt, 900, 5000) * on;
    const wave = (since * 0.55) % 1;
    const wave2 = (since * 0.55 + 0.5) % 1;
    if (ring.current) {
      ring.current.scale.setScalar(k * (0.6 + wave * 4.2));
      (ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - wave) * 0.9 * fade;
    }
    if (ring2.current) {
      ring2.current.scale.setScalar(k * (0.6 + wave2 * 4.2));
      (ring2.current.material as THREE.MeshBasicMaterial).opacity = (1 - wave2) * 0.9 * fade;
    }
    if (dot.current) {
      dot.current.scale.setScalar(k * 0.42);
      (dot.current.material as THREE.MeshBasicMaterial).opacity = fade;
    }
    if (beam.current) {
      beam.current.scale.set(k * 0.09, s.alt * 0.2, k * 0.09);
      beam.current.position.y = s.alt * 0.1;
      (beam.current.material as THREE.MeshBasicMaterial).opacity = 0.55 * fade;
    }
  });
  return (
    <group position={CAMPUS_POS}>
      <mesh ref={ring} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.94, 1, 64]} />
        <meshBasicMaterial color="#f3d004" transparent opacity={0} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring2} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.94, 1, 64]} />
        <meshBasicMaterial color="#f3d004" transparent opacity={0} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={dot} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0} depthTest={false} depthWrite={false} />
      </mesh>
      <mesh ref={beam}>
        <cylinderGeometry args={[1, 1, 1, 12, 1, true]} />
        <meshBasicMaterial color="#f3d004" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

const groundFragment = /* glsl */ `
  varying vec2 vUv;
  uniform float uOn;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    // a pool of site lighting around the campus, falling off into the night
    vec3 base = vec3(0.006, 0.017, 0.06);
    vec3 pool = vec3(0.014, 0.036, 0.11) * pow(max(0.0, 1.0 - r * 6.0), 2.0);
    gl_FragColor = vec4((base + pool) * uOn, uOn * (1.0 - smoothstep(0.75, 1.0, r)));
  }
`;

/** Dark ground under the district, so the blocks stand on something. */
function Ground({ state }: { state: React.RefObject<IntroState> }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: groundFragment,
        uniforms: { uOn: { value: 0 } },
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  useFrame(() => {
    const s = state.current;
    if (s) mat.uniforms.uOn.value = 1 - THREE.MathUtils.smoothstep(s.alt, 1500, 6000);
  });
  return (
    <mesh rotation-x={-Math.PI / 2} position={[CAMPUS.east, -0.4, -CAMPUS.north]} material={mat} renderOrder={-1}>
      <planeGeometry args={[3200, 3200]} />
    </mesh>
  );
}

/**
 * One unbroken move from orbit to the pavement: the country outline, the
 * island's roads, the street grid, the real footprints, and the campus building.
 * Altitude is interpolated on a log scale so every scale gets the same screen time.
 */
export default function IntroScene({ state, labels, hud }: Props) {
  const geo = use(geoData());
  const city = use(cityData());

  const anchors = useMemo(
    () => [
      { key: 'uae', pos: new THREE.Vector3(-92000, 0, 118000) },
      ...geo.places.map((p) => ({ key: `place:${p.name}`, pos: new THREE.Vector3(p.x, 0, -p.y) })),
      { key: 'campus', pos: CAMPUS_POS.clone() },
      { key: 'roof', pos: new THREE.Vector3(CAMPUS.east, CAMPUS.height + 6, -CAMPUS.north) },
      { key: 'zone', pos: new THREE.Vector3(CAMPUS.east - 23, ZONE_Y + 2, -CAMPUS.north + 13) },
    ],
    [geo],
  );

  useFrame(({ camera, size }, dt) => {
    const s = state.current;
    if (!s) return;
    if (s.skip) {
      s.time = Math.max(s.time, BEAT.end);
      s.skip = false;
    }
    s.time += Math.min(dt, 0.05);
    const t = s.time;

    s.draw = ease(span(t, BEAT.draw));
    s.detail = span(t, BEAT.detail);
    const dive = ease(span(t, BEAT.dive));
    s.xray = ease(span(t, BEAT.xray));
    if (s.enter > 0) s.enter = Math.min(1, s.enter + dt / 1.5);
    const push = ease(s.enter);

    // altitude on a log scale; pitch and heading swing round as the ground comes up
    const alt = Math.exp(THREE.MathUtils.lerp(Math.log(ALT_START), Math.log(ALT_END), dive)) * (1 - 0.72 * push);
    s.alt = alt;
    const settle = Math.max(0, t - BEAT.dive[1]);
    const pitch = THREE.MathUtils.lerp(0.02, THREE.MathUtils.degToRad(66), Math.pow(dive, 2.2));
    const heading = FRONT * Math.pow(dive, 1.6) + Math.sin(settle * 0.16) * 0.34 * Math.min(1, settle / 3) * (1 - push);
    target.lerpVectors(COUNTRY, CAMPUS_POS, ease(Math.min(1, dive / 0.42)));
    target.y = THREE.MathUtils.lerp(0, 17, Math.pow(dive, 6)) + (ZONE_Y - 15) * push;

    hd.set(Math.sin(heading), 0, -Math.cos(heading));
    right.set(Math.cos(heading), 0, Math.sin(heading));
    camera.position.copy(target).addScaledVector(hd, -alt * Math.tan(pitch));
    camera.position.y += alt;
    fwd.copy(target).sub(camera.position).normalize();
    up.crossVectors(right, fwd).normalize();
    basis.makeBasis(right, up, tmp.copy(fwd).negate());
    camera.quaternion.setFromRotationMatrix(basis);
    const cam = camera as THREE.PerspectiveCamera;
    cam.near = Math.max(0.8, alt * 0.02);
    cam.far = alt * 80 + 6000;
    // once the camera has arrived the building is slid right, clear of the title
    const slide = THREE.MathUtils.smoothstep(dive, 0.82, 1) * (1 - push);
    if (size.width > 8) cam.setViewOffset(size.width, size.height, -slide * size.width * (size.width > 900 ? 0.2 : 0), -slide * size.height * 0.02, size.width, size.height);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // labels
    const els = labels.current;
    if (els) {
      const { smoothstep } = THREE.MathUtils;
      for (const a of anchors) {
        const el = els[a.key];
        if (!el) continue;
        tmp.copy(a.pos).project(cam);
        el.style.transform = `translate3d(${((tmp.x * 0.5 + 0.5) * size.width).toFixed(1)}px, ${((-tmp.y * 0.5 + 0.5) * size.height).toFixed(1)}px, 0)`;
        let o = 0;
        if (a.key === 'uae') o = s.detail * smoothstep(alt, 220000, 520000);
        else if (a.key === 'campus') o = (t >= BEAT.ping ? 1 : 0) * smoothstep(alt, 1800, 6000);
        else if (a.key === 'roof') o = (1 - smoothstep(alt, 130, 420)) * (1 - smoothstep(s.xray, 0.02, 0.2)) * (1 - push);
        else if (a.key === 'zone') o = smoothstep(s.xray, 0.8, 0.98) * (1 - push);
        else o = s.detail * smoothstep(alt, 45000, 160000) * (a.key === 'place:Abu Dhabi' ? 1 - (t >= BEAT.ping ? smoothstep(alt, 300000, 700000) : 0) : 1);
        el.style.opacity = tmp.z > 1 ? '0' : o.toFixed(3);
      }
    }

    // read-outs
    const h = hud.current;
    if (h) {
      if (h.alt) h.alt.textContent = alt >= 10000 ? `${(alt / 1000).toFixed(0)} km` : alt >= 1000 ? `${(alt / 1000).toFixed(1)} km` : `${alt.toFixed(0)} m`;
      const lat = geo.origin.lat + -target.z / R / RAD;
      const lon = geo.origin.lon + target.x / (R * Math.cos(geo.origin.lat * RAD)) / RAD;
      if (h.lat) h.lat.textContent = `${lat.toFixed(4)}° N`;
      if (h.lon) h.lon.textContent = `${lon.toFixed(4)}° E`;
      if (h.scale) {
        // ground width of the view, to label the scale bar
        const width = 2 * alt * Math.tan((cam.fov * RAD) / 2) * cam.aspect;
        const bar = width * (120 / size.width);
        h.scale.textContent = bar >= 1000 ? `${(bar / 1000).toFixed(bar >= 10000 ? 0 : 1)} km` : `${bar.toFixed(0)} m`;
      }
    }
  });

  return (
    <group>
      <Ground state={state} />
      <Country geo={geo} state={state} />
      <City city={city} state={state} />
      <Liwa state={state} />
      <Beacon state={state} />
    </group>
  );
}
