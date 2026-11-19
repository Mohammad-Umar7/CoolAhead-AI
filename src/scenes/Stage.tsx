import { Suspense, useEffect, useRef, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Bloom, EffectComposer, N8AO, SMAA, TiltShift2, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { uiScale } from '../lib/fit';
import { brandBackground } from '../lib/theme';

interface Props {
  children: ReactNode;
  camera?: { position: [number, number, number]; fov?: number; near?: number; far?: number };
  bloom?: number;
  className?: string;
  /** a flat background colour instead of the brand field */
  plain?: string;
  /** model-shop treatment: soft shadows, studio reflections, contact shading and a shallow focus */
  studio?: boolean;
  /** strength of the tilt-shift blur towards the top and bottom of the frame */
  tilt?: number;
}

interface FrameProps {
  /** width of the subject along the screen, metres */
  span: number;
  /** screen space the panels take, in layout pixels */
  inset?: { left?: number; right?: number; top?: number; bottom?: number };
  /** direction the camera looks from, relative to the target */
  from: [number, number, number];
  target?: [number, number, number];
}

/**
 * Frames a subject in the part of the canvas the panels leave free. The camera
 * is backed off until the subject fits, and the picture is slid over with a view
 * offset so the perspective itself is not skewed. Runs again on every resize.
 */
export function Framing({ span, inset = {}, from, target = [0, 0, 0] }: FrameProps) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const [fx, fy, fz] = from;
  const [tx, ty, tz] = target;
  // insets are given in layout pixels; the canvas is measured in screen pixels
  const k = uiScale();
  const left = (inset.left ?? 0) * k;
  const right = (inset.right ?? 0) * k;
  const top = (inset.top ?? 0) * k;
  const bottom = (inset.bottom ?? 0) * k;

  useEffect(() => {
    // the canvas reports 0 x 0 for a moment before it is measured
    if (size.width < 8 || size.height < 8) return;
    const freeW = Math.max(80 * k, size.width - left - right);
    const freeH = Math.max(60 * k, size.height - top - bottom);
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // back off until `span` fits the free width, and about two thirds of it the free height
    const byWidth = span / (2 * tan * (freeW / size.height));
    const byHeight = (span * 0.66) / (2 * tan * (freeH / size.height));
    const distance = Math.max(byWidth, byHeight);
    const dir = new THREE.Vector3(fx, fy, fz).normalize();
    camera.position.set(tx + dir.x * distance, ty + dir.y * distance, tz + dir.z * distance);
    camera.lookAt(tx, ty, tz);
    camera.setViewOffset(size.width, size.height, -(left - right) / 2, -(top - bottom) / 2, size.width, size.height);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.set(tx, ty, tz);
      controls.update();
    }
    return () => {
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    };
  }, [camera, controls, size.width, size.height, span, k, left, right, top, bottom, fx, fy, fz, tx, ty, tz]);
  return null;
}

interface Orbit {
  getAzimuthalAngle: () => number;
  setAzimuthalAngle: (a: number) => void;
  update: () => void;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
}

/** A slow sway of the camera while nobody is steering it, so the model never sits dead still. */
export function IdleSway({ amount = 0.09, period = 26 }: { amount?: number; period?: number }) {
  const controls = useThree((s) => s.controls) as unknown as Orbit | null;
  const held = useRef(false);
  const base = useRef<number | null>(null);
  const t0 = useRef(0);
  useEffect(() => {
    if (!controls) return;
    const start = () => {
      held.current = true;
    };
    const end = () => {
      held.current = false;
      base.current = null;
    };
    controls.addEventListener('start', start);
    controls.addEventListener('end', end);
    return () => {
      controls.removeEventListener('start', start);
      controls.removeEventListener('end', end);
    };
  }, [controls]);
  useFrame(({ clock }) => {
    if (!controls || held.current) return;
    if (base.current === null) {
      base.current = controls.getAzimuthalAngle();
      t0.current = clock.elapsedTime;
    }
    controls.setAzimuthalAngle(base.current + Math.sin(((clock.elapsedTime - t0.current) / period) * Math.PI * 2) * amount);
    controls.update();
  });
  return null;
}

/** Soft boxes around the model: what the polished floor, the glass and the metal reflect. */
function StudioLight() {
  return (
    <Environment resolution={256} frames={1}>
      <color attach="background" args={['#0c1c3d']} />
      <Lightformer form="rect" intensity={1.1} color="#dfe9ff" position={[0, 14, 0]} rotation-x={Math.PI / 2} scale={[34, 34, 1]} />
      <Lightformer form="rect" intensity={0.8} color="#8fb2ff" position={[-22, 6, 6]} rotation-y={Math.PI / 2} scale={[26, 9, 1]} />
      <Lightformer form="rect" intensity={0.7} color="#ffd75a" position={[22, 5, -8]} rotation-y={-Math.PI / 2} scale={[18, 6, 1]} />
      <Lightformer form="ring" intensity={0.9} color="#ffffff" position={[6, 9, 20]} rotation-y={Math.PI} scale={7} />
    </Environment>
  );
}

/** Shared canvas set-up: one look for every 3D view in the app. */
export default function Stage({ children, camera, bloom = 0.55, className, plain, studio = false, tilt = 0 }: Props) {
  return (
    <div className="unscaled">
      <Canvas
        className={className}
        shadows={studio ? 'soft' : false}
        dpr={[1, 1.75]}
        gl={{ antialias: false, powerPreference: 'high-performance', alpha: false }}
        camera={{ fov: 30, near: 0.5, far: 400, ...camera }}
        onCreated={(state) => {
          const { scene } = state;
          if (import.meta.env.DEV) (window as unknown as { __three: unknown }).__three = state;
          scene.background = plain ? new THREE.Color(plain) : brandBackground();
        }}
      >
        <Suspense fallback={null}>
          {studio && <StudioLight />}
          {children}
        </Suspense>
        {/* multisampling stays off: the composer's MSAA blit fails on some GPU back ends and blanks the frame */}
        <EffectComposer multisampling={0}>
          {studio ? <N8AO aoRadius={1.4} intensity={2.4} distanceFalloff={0.8} color="#06112a" quality="medium" /> : <></>}
          <Bloom mipmapBlur intensity={bloom} luminanceThreshold={studio ? 1.0 : 0.82} luminanceSmoothing={studio ? 0.12 : 0.2} radius={studio ? 0.55 : 0.7} />
          {/* linear: the university navy and gold must come out exactly as authored, and filmic curves shift dark blues */}
          <ToneMapping mode={ToneMappingMode.LINEAR} />
          {tilt > 0 ? <TiltShift2 blur={tilt} taper={0.55} samples={8} /> : <></>}
          <SMAA />
          <Vignette offset={0.3} darkness={0.38} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
