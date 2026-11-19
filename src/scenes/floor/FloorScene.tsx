import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { newFrame, sampleFrame, type Frame, type Source } from '../../lib/frame';
import { useSim } from '../../state/sim';
import Anchors, { type AnchorEls, type AnchorPoint } from '../Anchors';
import Ahu from './Ahu';
import Air from './Air';
import People from './People';
import Shell from './Shell';
import { AirVolumes, HeatFloors } from './Thermal';
import { AHU_POS, CENTER, PLAN } from './layout';

export type FloorView = 'live' | 'heat' | 'thermal' | 'xray';

/** Points labels can be pinned to: each room, the air handler, the facade. */
export const FLOOR_ANCHORS: AnchorPoint[] = [
  ...PLAN.map((p) => ({ key: `room${p.index}`, position: [p.cx, 3.3, p.z0 + 0.2] as [number, number, number] })),
  { key: 'ahu', position: [AHU_POS.x - 2.2, 1.9, AHU_POS.z - 3.4] },
];

/** A camera in the corner of each room. The thin frame is what its detector can see. */
function Cameras({ frame }: { frame: React.RefObject<Frame> }) {
  const lines = useRef<(THREE.LineSegments | null)[]>([]);
  const bodies = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const rigs = useMemo(
    () =>
      PLAN.map((p) => {
        const eye = new THREE.Vector3(p.camera[0], 2.5, p.camera[1]);
        const m = 0.5;
        const floor = [
          [p.x0 + m, p.z0 + 1.6],
          [p.x1 - 2.2, p.z0 + m],
          [p.x1 - m, p.z1 - 2.6],
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
        m.opacity += ((on ? 0.13 : 0) - m.opacity) * 0.15;
      }
      const body = bodies.current[i];
      if (body) {
        body.emissive.set(on ? '#7fe3ff' : '#ff4530');
        body.emissiveIntensity = on ? 1.6 : 0.6 + 3 * blink;
      }
    }
  });
  return (
    <group>
      {rigs.map((r, i) => (
        <group key={i}>
          <mesh position={r.eye}>
            <boxGeometry args={[0.22, 0.16, 0.22]} />
            <meshStandardMaterial ref={(m) => void (bodies.current[i] = m)} color="#0e161d" emissive="#7fe3ff" emissiveIntensity={1.6} roughness={0.4} />
          </mesh>
          <lineSegments ref={(m) => void (lines.current[i] = m)} geometry={r.g}>
            <lineBasicMaterial color="#7fe3ff" transparent opacity={0.13} depthWrite={false} />
          </lineSegments>
        </group>
      ))}
    </group>
  );
}

interface Props {
  source?: Source;
  view?: FloorView;
  /** DOM elements to pin to FLOOR_ANCHORS, by key */
  tags?: React.RefObject<AnchorEls>;
}

/**
 * The simulated zone as a cut-away model. Everything in it is driven by the
 * engine's numbers for the moment on the shared clock.
 */
export default function FloorScene({ source = 'cool', view = 'live', tags }: Props) {
  const frame = useRef<Frame>(newFrame());
  useFrame(() => {
    sampleFrame(source, useSim.getState().t, frame.current);
  }, -1);

  const xray = view === 'xray' ? 1 : 0;
  const volume = view === 'thermal' ? 1 : view === 'live' ? 0.45 : view === 'xray' ? 0.3 : 0.05;
  const heat = view === 'heat' ? 1 : 0;

  return (
    <group position={[-CENTER.x, 0, -CENTER.z]}>
      <Shell ghost={xray} frame={frame} />
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
