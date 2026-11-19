import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { uiScale } from '../../lib/fit';
import type { AnchorEls } from '../Anchors';
import Liwa, { ZONE_Y } from './Liwa';
import Satellite, { mapReady } from './Satellite';
import { CAMPUS, FOOTPRINT, ORIGIN } from './data';

export interface IntroState {
  /** seconds since the sequence started */
  time: number;
  /** camera height above the ground it looks at, metres */
  alt: number;
  /** x-ray front through the building, 0..1 */
  xray: number;
  /** set to skip straight to the end */
  skip: boolean;
  /** 0..1 once the user asks to enter: the camera pushes into level three */
  enter: number;
}

export const newIntroState = (): IntroState => ({ time: 0, alt: 16000, xray: 0, skip: false, enter: 0 });

/** Beats of the sequence, seconds: one unbroken dive from the city to the building, then a look inside. */
export const BEAT = { dive: [0.15, 4.5], xray: [4.6, 5.8], title: 4.9, end: 6.0 };

const ALT_START = 16000;
const ALT_END = 118;
const CAMPUS_POS = new THREE.Vector3(CAMPUS.east, 0, -CAMPUS.north);
/** where the camera first looks: a little north-west of the campus, so the dive drifts onto it */
const START = new THREE.Vector3(CAMPUS.east - 2600, 0, -CAMPUS.north - 1500);
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

/** The campus plot drawn on the map, as on a site plan: a white line a few metres outside the footprint. */
function Plot({ state }: { state: React.RefObject<IntroState> }) {
  const ref = useRef<THREE.Group>(null);
  const pts = useMemo(() => {
    const cx = FOOTPRINT.reduce((a, p) => a + p[0], 0) / FOOTPRINT.length;
    const cy = FOOTPRINT.reduce((a, p) => a + p[1], 0) / FOOTPRINT.length;
    const ring = FOOTPRINT.map(([x, y]) => {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      const k = (d + 14) / d;
      return new THREE.Vector3(cx + dx * k, 0.4, -(cy + dy * k));
    });
    return [...ring, ring[0]];
  }, []);
  useFrame(() => {
    const s = state.current;
    if (!s || !ref.current) return;
    const on = 1 - THREE.MathUtils.smoothstep(s.alt, 900, 3200);
    ref.current.visible = on > 0.01;
  });
  const k = uiScale();
  return (
    <group ref={ref} visible={false}>
      <Line points={pts} color="#ffffff" lineWidth={3.2 * k} transparent opacity={0.95} depthWrite={false} />
    </group>
  );
}

/** A marker that stays the same size on screen whatever the altitude. */
function Beacon({ state }: { state: React.RefObject<IntroState> }) {
  const ring = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);
  const dot = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const s = state.current;
    if (!s) return;
    const k = s.alt * 0.014;
    const fade = THREE.MathUtils.smoothstep(s.alt, 700, 2600);
    const wave = (s.time * 0.7) % 1;
    const wave2 = (s.time * 0.7 + 0.5) % 1;
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
  });
  return (
    <group position={CAMPUS_POS}>
      <mesh ref={ring} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.9, 1, 64]} />
        <meshBasicMaterial color="#1f5fee" transparent opacity={0} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ring2} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.9, 1, 64]} />
        <meshBasicMaterial color="#1f5fee" transparent opacity={0} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={dot} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial color="#1f5fee" transparent opacity={0} depthTest={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

/**
 * One unbroken move from high over Abu Dhabi down to the campus building.
 * Altitude is interpolated on a log scale so every scale gets the same screen time.
 */
export default function IntroScene({ state, labels, hud }: Props) {
  const waited = useRef(0);
  const anchors = useMemo(
    () => [
      { key: 'campus', pos: CAMPUS_POS.clone() },
      { key: 'roof', pos: new THREE.Vector3(CAMPUS.east, CAMPUS.height + 6, -CAMPUS.north) },
      { key: 'zone', pos: new THREE.Vector3(CAMPUS.east - 23, ZONE_Y + 2, -CAMPUS.north + 13) },
    ],
    [],
  );

  useFrame(({ camera, size }, dt) => {
    const s = state.current;
    if (!s) return;
    if (s.skip) {
      s.time = Math.max(s.time, BEAT.end);
      s.skip = false;
    }
    // hold on the first frame until the map is there to fly over, but never for long
    waited.current += dt;
    if (mapReady() || waited.current > 2.5 || s.time > 0) s.time += Math.min(dt, 0.05);
    const t = s.time;

    const dive = ease(span(t, BEAT.dive));
    s.xray = ease(span(t, BEAT.xray));
    if (s.enter > 0) s.enter = Math.min(1, s.enter + dt / 1.5);
    const push = ease(s.enter);

    // altitude on a log scale; the camera tips forward and swings round as the ground comes up
    const alt = Math.exp(THREE.MathUtils.lerp(Math.log(ALT_START), Math.log(ALT_END), dive)) * (1 - 0.72 * push);
    s.alt = alt;
    const settle = Math.max(0, t - BEAT.dive[1]);
    const pitch = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(24), THREE.MathUtils.degToRad(66), Math.pow(dive, 1.3));
    const heading = FRONT * Math.pow(dive, 1.15) + Math.sin(settle * 0.16) * 0.3 * Math.min(1, settle / 3) * (1 - push);
    target.lerpVectors(START, CAMPUS_POS, ease(Math.min(1, dive / 0.62)));
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
    cam.far = alt * 26 + 4000;
    // once the camera has arrived the building is slid right, clear of the title
    const slide = THREE.MathUtils.smoothstep(dive, 0.82, 1) * (1 - push);
    // the canvas is measured in screen pixels; the labels and the scale bar live in the scaled layout
    const k = uiScale();
    if (size.width > 8) cam.setViewOffset(size.width, size.height, -slide * size.width * 0.23, -slide * size.height * 0.03, size.width, size.height);
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
        el.style.transform = `translate3d(${(((tmp.x * 0.5 + 0.5) * size.width) / k).toFixed(1)}px, ${(((-tmp.y * 0.5 + 0.5) * size.height) / k).toFixed(1)}px, 0)`;
        let o = 0;
        if (a.key === 'campus') o = smoothstep(alt, 1400, 4200) * (1 - smoothstep(alt, 9000, 15000));
        else if (a.key === 'roof') o = (1 - smoothstep(alt, 130, 420)) * (1 - smoothstep(s.xray, 0.02, 0.2)) * (1 - push);
        else if (a.key === 'zone') o = smoothstep(s.xray, 0.8, 0.98) * (1 - push);
        el.style.opacity = tmp.z > 1 ? '0' : o.toFixed(3);
      }
    }

    // read-outs
    const h = hud.current;
    if (h) {
      if (h.alt) h.alt.textContent = alt >= 10000 ? `${(alt / 1000).toFixed(0)} km` : alt >= 1000 ? `${(alt / 1000).toFixed(1)} km` : `${alt.toFixed(0)} m`;
      const lat = ORIGIN.lat + -target.z / R / RAD;
      const lon = ORIGIN.lon + target.x / (R * Math.cos(ORIGIN.lat * RAD)) / RAD;
      if (h.lat) h.lat.textContent = `${lat.toFixed(4)}° N`;
      if (h.lon) h.lon.textContent = `${lon.toFixed(4)}° E`;
      if (h.scale) {
        // ground width of the view, to label the scale bar
        const width = 2 * alt * Math.tan((cam.fov * RAD) / 2) * cam.aspect;
        const bar = width * ((120 * k) / size.width);
        h.scale.textContent = bar >= 1000 ? `${(bar / 1000).toFixed(bar >= 10000 ? 0 : 1)} km` : `${bar.toFixed(0)} m`;
      }
    }
  });

  return (
    <group>
      <Satellite state={state} />
      <Plot state={state} />
      <Liwa state={state} />
      <Beacon state={state} />
    </group>
  );
}
