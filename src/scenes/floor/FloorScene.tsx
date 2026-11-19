import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { tempColor } from '../../lib/color';
import { damp, newFrame, sampleFrame, type Frame, type Source } from '../../lib/frame';
import { useSim } from '../../state/sim';
import Anchors, { type AnchorEls, type AnchorPoint } from '../Anchors';
import Ahu from './Ahu';
import Air from './Air';
import People from './People';
import Shell from './Shell';
import { AirVolumes, HeatFloors } from './Thermal';
import { CENTER, DUCT_Y, PLAN, TRUNK_Z } from './layout';

export type FloorView = 'live' | 'heat' | 'thermal' | 'xray';

/** Points labels can be pinned to: each room, where its duct branch leaves the trunk, and the air handler. */
export const FLOOR_ANCHORS: AnchorPoint[] = [
  ...PLAN.map((p) => ({ key: `room${p.index}`, position: [p.side === 'north' ? p.cx : p.x1 - 1.3, 3.2, p.side === 'north' ? p.zFacade + 0.4 : p.zFacade - 1.6] as [number, number, number] })),
  ...PLAN.map((p) => ({ key: `duct${p.index}`, position: [p.diffusers[0][0], DUCT_Y + 0.35, (TRUNK_Z + p.diffusers[0][1]) / 2] as [number, number, number] })),
];

/** A camera in the corner of each room. The thin frame is the floor its detector can see. */
function Cameras({ frame }: { frame: React.RefObject<Frame> }) {
  const lines = useRef<(THREE.LineSegments | null)[]>([]);
  const lamps = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const rigs = useMemo(
    () =>
      PLAN.map((p) => {
        const eye = new THREE.Vector3(p.camera[0], 2.55, p.camera[1]);
        const m = 0.5;
        const floor = [
          [p.x0 + m, p.z0 + m],
          [p.x1 - m, p.z0 + m],
          [p.x1 - m, p.z1 - m],
          [p.x0 + m, p.z1 - m],
        ];
        const pts: number[] = [];
        floor.forEach(([x, z], k) => {
          const [nx, nz] = floor[(k + 1) % 4];
          pts.push(eye.x, eye.y, eye.z, x, 0.03, z, x, 0.03, z, nx, 0.03, nz);
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        return { eye, g };
      }),
    [],
  );
  useFrame((state) => {
    const f = frame.current;
    if (!f) return;
    const blink = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 7);
    for (let i = 0; i < PLAN.length; i++) {
      const on = f.online[i];
      const line = lines.current[i];
      if (line) {
        const m = line.material as THREE.LineBasicMaterial;
        m.opacity += ((on ? 0.14 : 0) - m.opacity) * 0.15;
      }
      const lamp = lamps.current[i];
      if (lamp) {
        lamp.emissive.set(on ? '#ffffff' : '#ff4d5e');
        lamp.emissiveIntensity = on ? 1.8 : 0.6 + 3.2 * blink;
      }
    }
  });
  return (
    <group>
      {rigs.map((r, i) => (
        <group key={i}>
          <mesh position={[r.eye.x, 1.3, r.eye.z]}>
            <cylinderGeometry args={[0.025, 0.025, 2.5, 8]} />
            <meshStandardMaterial color="#c9d6ee" roughness={0.3} metalness={0.85} />
          </mesh>
          <mesh position={r.eye}>
            <sphereGeometry args={[0.15, 18, 14]} />
            <meshStandardMaterial ref={(m) => void (lamps.current[i] = m)} color="#16305c" emissive="#ffffff" emissiveIntensity={1.8} roughness={0.25} metalness={0.4} />
          </mesh>
          <lineSegments ref={(m) => void (lines.current[i] = m)} geometry={r.g}>
            <lineBasicMaterial color="#ffffff" transparent opacity={0.14} depthWrite={false} />
          </lineSegments>
        </group>
      ))}
    </group>
  );
}

/** Each room is lit from inside in the colour of its temperature, so the frosted walls take it up. */
function RoomGlow({ frame, strength }: { frame: React.RefObject<Frame>; strength: number }) {
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const shown = useRef([24, 24, 24]);
  const power = useRef(0);
  useFrame((_, dt) => {
    const f = frame.current;
    if (!f) return;
    power.current = damp(power.current, strength, 3, dt);
    for (let i = 0; i < PLAN.length; i++) {
      const l = lights.current[i];
      if (!l) continue;
      shown.current[i] = damp(shown.current[i], f.temp[i], 6, dt);
      tempColor(shown.current[i], l.color);
      l.intensity = 46 * power.current;
    }
  });
  return (
    <>
      {PLAN.map((p, i) => (
        <pointLight key={p.index} ref={(l) => void (lights.current[i] = l)} position={[p.cx, 2.7, p.cz]} distance={14} decay={1.6} intensity={0} />
      ))}
    </>
  );
}

interface Props {
  source?: Source;
  view?: FloorView;
  /** DOM elements to pin to FLOOR_ANCHORS, by key */
  tags?: React.RefObject<AnchorEls>;
  /** drop the mirror floor in small or doubled-up views */
  reflect?: boolean;
}

/**
 * The simulated zone as a cut-away model. Everything in it is driven by the
 * engine's numbers for the moment on the shared clock.
 */
export default function FloorScene({ source = 'cool', view = 'live', tags, reflect = true }: Props) {
  const frame = useRef<Frame>(newFrame());
  useFrame(() => {
    sampleFrame(source, useSim.getState().t, frame.current);
  }, -1);

  const xray = view === 'xray' ? 1 : 0;
  const volume = view === 'thermal' ? 0.9 : view === 'live' ? 0.3 : view === 'xray' ? 0.1 : 0.04;
  const glow = view === 'thermal' ? 1 : view === 'live' ? 0.62 : view === 'xray' ? 0.3 : 0.22;
  const heat = view === 'heat' ? 1 : 0;

  return (
    <group position={[-CENTER.x, 0, -CENTER.z]}>
      <Shell ghost={xray} frame={frame} reflect={reflect} />
      <RoomGlow frame={frame} strength={glow} />
      <HeatFloors frame={frame} strength={heat} />
      <People frame={frame} dim={heat} />
      <Cameras frame={frame} />
      <AirVolumes frame={frame} strength={volume} />
      <Ahu frame={frame} />
      <Air frame={frame} emphasis={xray} />
      {tags && <Anchors points={FLOOR_ANCHORS} els={tags} offset={[-CENTER.x, 0, -CENTER.z]} />}
    </group>
  );
}
