import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';
import { damp, type Frame } from '../../lib/frame';
import { AHU_POS } from './layout';

const COIL_OFF = new THREE.Color('#2c4b84');
const COIL_ON = new THREE.Color('#58d6ff');
const WARM = new THREE.Color('#ff8a3d');
const BLADES = 9;
const FINS = 16;

/**
 * The one air handler the three rooms share. Outdoor air and return air mix on
 * the left, pass the chilled coil, and the fan pushes them up into the duct.
 * The fan wheel turns with the commanded fan level; the coil glows with its duty.
 */
export default function Ahu({ frame }: { frame: React.RefObject<Frame> }) {
  const wheel = useRef<THREE.Group>(null);
  // one material for every fin, so the whole coil lights as one
  const coil = useMemo(() => new THREE.MeshStandardMaterial({ color: COIL_OFF, emissive: COIL_ON, emissiveIntensity: 0.05, roughness: 0.35, metalness: 0.6 }), []);
  const intake = useRef<THREE.MeshBasicMaterial>(null);
  const valve = useRef<THREE.Mesh>(null);
  const state = useRef({ fan: 0, duty: 0 });
  const { x, z, w, h, d } = AHU_POS;

  const fins = useMemo(() => Array.from({ length: FINS }, (_, i) => -d / 2 + 0.18 + (i * (d - 0.36)) / (FINS - 1)), [d]);

  useFrame((_, dt) => {
    const f = frame.current;
    if (!f) return;
    const s = state.current;
    s.fan = damp(s.fan, f.fan, 2.2, dt);
    s.duty = damp(s.duty, f.fan > 0 ? f.duty : 0, 3, dt);
    if (wheel.current) wheel.current.rotation.x -= dt * (1.2 + 15 * s.fan) * (s.fan > 0.01 ? 1 : 0);
    coil.color.copy(COIL_OFF).lerp(COIL_ON, s.duty * 0.9);
    coil.emissiveIntensity = 0.05 + 2.4 * s.duty;
    if (intake.current) intake.current.opacity = 0.08 + 0.5 * s.fan;
    if (valve.current) valve.current.rotation.y = -s.duty * Math.PI * 0.5;
  });

  return (
    <group position={[x, 0, z]}>
      {/* plinth */}
      <mesh position={[0, 0.06, 0]}>
        <boxGeometry args={[w + 0.3, 0.12, d + 0.3]} />
        <meshStandardMaterial color="#132a56" roughness={0.8} />
      </mesh>

      {/* casing, glazed so the inside can be read */}
      <mesh position={[0, h / 2 + 0.12, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshPhysicalMaterial color="#e2f0ff" transparent opacity={0.1} roughness={0.15} depthWrite={false} side={THREE.DoubleSide} />
        <Edges color="#ffffff" threshold={20} />
      </mesh>
      {[-w / 2 + 0.95, -w / 2 + 1.65].map((px, i) => (
        <mesh key={i} position={[px, h / 2 + 0.12, 0]}>
          <boxGeometry args={[0.02, h, d]} />
          <meshBasicMaterial color="#e2f0ff" transparent opacity={0.06} depthWrite={false} />
          <Edges color="#8fa9d8" threshold={20} />
        </mesh>
      ))}

      {/* mixing box: outdoor air louvre on the facade side */}
      <mesh position={[-w / 2 + 0.45, h / 2 + 0.12, -d / 2 - 0.9]}>
        <boxGeometry args={[0.7, 0.7, 1.8]} />
        <meshPhysicalMaterial color="#ffb37a" transparent opacity={0.07} roughness={0.2} depthWrite={false} side={THREE.DoubleSide} />
        <Edges color="#a8683c" threshold={20} />
      </mesh>
      <mesh position={[-w / 2 + 0.45, h / 2 + 0.12, -d / 2 - 1.82]}>
        <planeGeometry args={[0.66, 0.66]} />
        <meshBasicMaterial ref={intake} color={WARM} transparent opacity={0.2} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* filter */}
      <mesh position={[-w / 2 + 0.95, h / 2 + 0.12, 0]}>
        <boxGeometry args={[0.07, h - 0.24, d - 0.24]} />
        <meshStandardMaterial color="#3a5a98" roughness={0.9} transparent opacity={0.7} />
      </mesh>

      {/* chilled-water coil: a bank of fins */}
      <group position={[-w / 2 + 1.38, h / 2 + 0.12, 0]}>
        {fins.map((fz, i) => (
          <mesh key={i} position={[0, 0, fz]} material={coil}>
            <boxGeometry args={[0.32, h - 0.3, 0.035]} />
          </mesh>
        ))}
      </group>

      {/* chilled-water pipes and control valve */}
      <mesh position={[-w / 2 + 1.38, h + 0.32, d / 2 - 0.25]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.055, 0.055, 0.9, 12]} />
        <meshStandardMaterial color="#2f8fbf" emissive="#2f8fbf" emissiveIntensity={0.5} roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[-w / 2 + 1.2, h + 0.32, d / 2 - 0.25]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.055, 0.055, 0.9, 12]} />
        <meshStandardMaterial color="#8fa9d8" roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh ref={valve} position={[-w / 2 + 1.38, h + 0.32, d / 2 + 0.26]}>
        <boxGeometry args={[0.26, 0.08, 0.08]} />
        <meshStandardMaterial color="#f3d004" emissive="#f3d004" emissiveIntensity={0.7} />
      </mesh>

      {/* supply fan */}
      <group position={[w / 2 - 0.72, h / 2 + 0.12, 0]}>
        <group ref={wheel}>
          <mesh rotation-z={Math.PI / 2}>
            <torusGeometry args={[0.56, 0.035, 8, 40]} />
            <meshStandardMaterial color="#9fb4c2" roughness={0.3} metalness={0.8} />
          </mesh>
          <mesh rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.13, 0.13, 0.3, 16]} />
            <meshStandardMaterial color="#56687a" roughness={0.35} metalness={0.8} />
          </mesh>
          {Array.from({ length: BLADES }, (_, i) => {
            const a = (i / BLADES) * Math.PI * 2;
            return (
              <mesh key={i} position={[0, Math.cos(a) * 0.34, Math.sin(a) * 0.34]} rotation-x={a + 0.5}>
                <boxGeometry args={[0.26, 0.4, 0.025]} />
                <meshStandardMaterial color="#c5d2da" roughness={0.3} metalness={0.7} />
              </mesh>
            );
          })}
        </group>
      </group>
    </group>
  );
}
