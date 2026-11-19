import { Suspense, useEffect, useRef, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { EffectComposer, N8AO, SMAA, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { uiScale } from '../lib/fit';

export const PAPER = '#f3f1ea';

/**
 * Daylight set-up for the building model: an architect's maquette on a white
 * base, one soft sun, and contact shading so the floors read as separate plates.
 */
export default function LightStage({ children }: { children: ReactNode }) {
  return (
    <div className="unscaled">
      <Canvas
        shadows="soft"
        dpr={[1, 1.75]}
        gl={{ antialias: false, powerPreference: 'high-performance', alpha: false }}
        camera={{ fov: 26, near: 2, far: 1200, position: [-90, 60, 110] }}
        onCreated={(state) => {
          state.scene.background = new THREE.Color(PAPER);
          if (import.meta.env.DEV) (window as unknown as { __three: unknown }).__three = state;
        }}
      >
        <hemisphereLight args={['#eaf2ff', '#a89f8c', 0.95]} />
        <directionalLight
          castShadow
          position={[-80, 120, 90]}
          intensity={3.1}
          color="#fff3de"
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.08}
          shadow-camera-left={-85}
          shadow-camera-right={85}
          shadow-camera-top={85}
          shadow-camera-bottom={-85}
          shadow-camera-near={10}
          shadow-camera-far={400}
        />
        <directionalLight position={[70, 45, -80]} intensity={0.55} color="#dde7ff" />
        <Suspense fallback={null}>
          {/* soft boxes for the glass and the metal to reflect */}
          <Environment resolution={256} frames={1}>
            <color attach="background" args={['#e9e6de']} />
            <Lightformer form="rect" intensity={2.2} color="#ffffff" position={[0, 60, 0]} rotation-x={Math.PI / 2} scale={[160, 160, 1]} />
            <Lightformer form="rect" intensity={1.4} color="#dce9ff" position={[-90, 30, 20]} rotation-y={Math.PI / 2} scale={[120, 40, 1]} />
            <Lightformer form="rect" intensity={1.1} color="#fff1d6" position={[90, 25, -30]} rotation-y={-Math.PI / 2} scale={[100, 30, 1]} />
          </Environment>
          {children}
          <KeepSize />
        </Suspense>
        {/* multisampling stays off: the composer's MSAA blit fails on some GPU back ends and blanks the frame */}
        <EffectComposer multisampling={0}>
          <N8AO aoRadius={4} intensity={3.4} distanceFalloff={1} color="#1c1a16" quality="medium" />
          <ToneMapping mode={ToneMappingMode.NEUTRAL} />
          <SMAA />
        </EffectComposer>
      </Canvas>
    </div>
  );
}

/**
 * The page is scaled as a whole to fit the window, and a canvas inside a scaled
 * page can miss a change of size. This measures the canvas again whenever the
 * window changes and tells the renderer.
 */
function KeepSize() {
  const gl = useThree((s) => s.gl);
  const setSize = useThree((s) => s.setSize);
  useEffect(() => {
    const host = gl.domElement.parentElement?.parentElement;
    if (!host) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const box = host.getBoundingClientRect();
        if (box.width > 8 && box.height > 8) setSize(box.width, box.height);
      });
    };
    measure();
    const late = window.setTimeout(measure, 400);
    window.addEventListener('resize', measure);
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(late);
      window.removeEventListener('resize', measure);
      ro.disconnect();
    };
  }, [gl, setSize]);
  return null;
}

export interface Shot {
  target: [number, number, number];
  /** direction the camera looks from, relative to the target */
  from: [number, number, number];
  /** width and height of the subject as the camera sees it, metres */
  span: number;
  rise: number;
}

interface RigProps {
  shot: Shot;
  /** screen space the panels take, in layout pixels */
  inset?: { left?: number; right?: number; top?: number; bottom?: number };
  seconds?: number;
}

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/**
 * Flies the camera to a shot and frames it in the part of the canvas the panels
 * leave free. After the move the camera belongs to whoever is dragging it.
 */
export function Rig({ shot, inset = {}, seconds = 1.7 }: RigProps) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const move = useRef({ t: 1, first: true, p0: new THREE.Vector3(), q0: new THREE.Vector3(), p1: new THREE.Vector3(), q1: new THREE.Vector3() });
  const k = uiScale();
  const left = (inset.left ?? 0) * k;
  const right = (inset.right ?? 0) * k;
  const top = (inset.top ?? 0) * k;
  const bottom = (inset.bottom ?? 0) * k;

  useEffect(() => {
    if (size.width < 8 || size.height < 8) return;
    const freeW = Math.max(120, size.width - left - right);
    const freeH = Math.max(90, size.height - top - bottom);
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distance = Math.max(shot.span / (2 * tan * (freeW / size.height)), shot.rise / (2 * tan * (freeH / size.height)));
    const m = move.current;
    m.q1.set(...shot.target);
    m.p1.set(...shot.from).normalize().multiplyScalar(distance).add(m.q1);
    m.p0.copy(camera.position);
    m.q0.copy(controls ? controls.target : m.q1);
    m.t = m.first ? 1 : 0;
    if (m.first) {
      camera.position.copy(m.p1);
      camera.lookAt(m.q1);
      if (controls) {
        controls.target.copy(m.q1);
        controls.update();
      }
      m.first = false;
    }
    camera.setViewOffset(size.width, size.height, -(left - right) / 2, -(top - bottom) / 2, size.width, size.height);
    camera.updateProjectionMatrix();
  }, [camera, controls, size.width, size.height, left, right, top, bottom, shot]);

  useEffect(
    () => () => {
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    },
    [camera],
  );

  useFrame((_, dt) => {
    const m = move.current;
    if (m.t >= 1) return;
    m.t = Math.min(1, m.t + dt / seconds);
    const e = easeInOut(m.t);
    camera.position.lerpVectors(m.p0, m.p1, e);
    if (controls) {
      controls.target.lerpVectors(m.q0, m.q1, e);
      controls.update();
    } else camera.lookAt(m.q1);
  });
  return null;
}
