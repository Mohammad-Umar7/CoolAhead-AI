import { Suspense, useEffect, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { brandBackground } from '../lib/theme';

interface Props {
  children: ReactNode;
  camera?: { position: [number, number, number]; fov?: number; near?: number; far?: number };
  bloom?: number;
  className?: string;
  /** a flat background colour instead of the brand field */
  plain?: string;
}

interface FrameProps {
  /** width of the subject along the screen, metres */
  span: number;
  /** screen space the panels take, in CSS pixels */
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
  const { left = 0, right = 0, top = 0, bottom = 0 } = inset;
  const [fx, fy, fz] = from;
  const [tx, ty, tz] = target;

  useEffect(() => {
    // the canvas reports 0 x 0 for a moment before it is measured
    if (size.width < 8 || size.height < 8) return;
    const freeW = Math.max(240, size.width - left - right);
    const freeH = Math.max(200, size.height - top - bottom);
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // distance at which `span` fills the free width, and a third of it the free height
    const byWidth = span / (2 * tan * (freeW / size.height));
    const byHeight = (span * 0.42) / (2 * tan * (freeH / size.height));
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
  }, [camera, controls, size.width, size.height, span, left, right, top, bottom, fx, fy, fz, tx, ty, tz]);
  return null;
}

/** Shared canvas set-up: one look for every 3D view in the app. */
export default function Stage({ children, camera, bloom = 0.55, className, plain }: Props) {
  return (
    <Canvas
      className={className}
      dpr={[1, 1.75]}
      gl={{ antialias: false, powerPreference: 'high-performance', alpha: false }}
      camera={{ fov: 30, near: 0.5, far: 400, ...camera }}
      onCreated={(state) => {
        const { gl, scene } = state;
        if (import.meta.env.DEV) (window as unknown as { __three: unknown }).__three = state;
        scene.background = plain ? new THREE.Color(plain) : brandBackground();
      }}
    >
      <Suspense fallback={null}>{children}</Suspense>
      {/* multisampling stays off: the composer's MSAA blit fails on some GPU back ends and blanks the frame */}
      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur intensity={bloom} luminanceThreshold={0.82} luminanceSmoothing={0.2} radius={0.7} />
        {/* linear: the university navy and gold must come out exactly as authored, and filmic curves shift dark blues */}
        <ToneMapping mode={ToneMappingMode.LINEAR} />
        <SMAA />
        <Vignette offset={0.3} darkness={0.38} />
      </EffectComposer>
    </Canvas>
  );
}
