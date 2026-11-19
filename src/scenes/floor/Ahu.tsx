import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBox } from '@react-three/drei';
import { damp, type Frame } from '../../lib/frame';
import { BRAND } from '../../lib/theme';
import { AHU_POS, SOUTH } from './layout';

const COIL_OFF = new THREE.Color('#3a5a98');
const COIL_ON = new THREE.Color('#6fdcff');
const BLADES = 10;
const FINS = 18;

/**
 * The one air handler the three rooms share. Outdoor air comes in through the
 * outside wall and mixes with return air, passes the filter and the chilled
 * coil, and the fan pushes it up into the duct. The wheel turns with the
 * commanded fan level; the coil glows with how hard it is working.
 */
export default function Ahu({ frame }: { frame: React.RefObject<Frame> }) {
  const wheel = useRef<THREE.Group>(null);
  const valve = useRef<THREE.Mesh>(null);
  const state = useRef({ fan: 0, duty: 0 });
  const { x, z, w, h, d } = AHU_POS;
  const reach = SOUTH.z1 - (z + d / 2);

  const mats = useMemo(
    () => ({
      // one material for every fin, so the whole coil lights as one
      coil: new THREE.MeshStandardMaterial({ color: COIL_OFF, emissive: COIL_ON, emissiveIntensity: 0.05, roughness: 0.3, metalness: 0.7 }),
      intake: new THREE.MeshBasicMaterial({ color: '#ff8552', transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }),
      frame: new THREE.MeshStandardMaterial({ color: '#c9d6ee', roughness: 0.28, metalness: 0.85 }),
      glass: new THREE.MeshPhysicalMaterial({ color: '#eaf3ff', transparent: true, opacity: 0.14, roughness: 0.05, envMapIntensity: 2.2, depthWrite: false, side: THREE.DoubleSide }),
      steel: new THREE.MeshStandardMaterial({ color: '#e8eef9', roughness: 0.25, metalness: 0.9 }),
      gold: new THREE.MeshStandardMaterial({ color: BRAND.gold, emissive: BRAND.gold, emissiveIntensity: 0.35, roughness: 0.3, metalness: 0.8 }),
      lamp: new THREE.MeshStandardMaterial({ color: '#6ff0b8', emissive: '#6ff0b8', emissiveIntensity: 0.2 }),
    }),
    [],
  );
  const fins = useMemo(() => Array.from({ length: FINS }, (_, i) => -d / 2 + 0.2 + (i * (d - 0.4)) / (FINS - 1)), [d]);

  useFrame((_, dt) => {
    const f = frame.current;
    if (!f) return;
    const s = state.current;
    s.fan = damp(s.fan, f.fan, 2.2, dt);
    s.duty = damp(s.duty, f.fan > 0 ? f.duty : 0, 3, dt);
    if (wheel.current && s.fan > 0.01) wheel.current.rotation.x -= dt * (1.2 + 15 * s.fan);
    mats.coil.color.copy(COIL_OFF).lerp(COIL_ON, s.duty * 0.9);
    mats.coil.emissiveIntensity = 0.05 + 2.6 * s.duty;
    mats.intake.opacity = 0.06 + 0.5 * s.fan;
    mats.lamp.emissiveIntensity = 0.2 + 2.2 * Math.min(1, s.fan * 2);
    if (valve.current) valve.current.rotation.y = -s.duty * Math.PI * 0.5;
  });

  const edge = 0.06;
  return (
    <group position={[x, 0, z]}>
      {/* plinth */}
      <RoundedBox args={[w + 0.4, 0.14, d + 0.4]} radius={0.05} smoothness={3} position={[0, 0.07, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#27447c" roughness={0.5} metalness={0.4} />
      </RoundedBox>

      {/* casing: a metal frame glazed all round, so the works can be read */}
      <group position={[0, h / 2 + 0.14, 0]}>
        <mesh material={mats.glass}>
          <boxGeometry args={[w, h, d]} />
        </mesh>
        {[-1, 1].map((sx) =>
          [-1, 1].map((sz) => (
            <mesh key={`${sx}${sz}`} position={[(sx * (w - edge)) / 2, 0, (sz * (d - edge)) / 2]} material={mats.frame} castShadow>
              <boxGeometry args={[edge, h, edge]} />
            </mesh>
          )),
        )}
        {[-1, 1].map((sy) =>
          [-1, 1].map((sz) => (
            <mesh key={`h${sy}${sz}`} position={[0, (sy * (h - edge)) / 2, (sz * (d - edge)) / 2]} material={mats.frame}>
              <boxGeometry args={[w, edge, edge]} />
            </mesh>
          )),
        )}
        {[-1, 1].map((sy) =>
          [-1, 1].map((sx) => (
            <mesh key={`d${sy}${sx}`} position={[(sx * (w - edge)) / 2, (sy * (h - edge)) / 2, 0]} material={mats.frame}>
              <boxGeometry args={[edge, edge, d]} />
            </mesh>
          )),
        )}

        {/* mixing box: outdoor air drawn in through the outside wall */}
        <mesh position={[-w / 2 + 0.5, 0, d / 2 + reach / 2]} material={mats.glass}>
          <boxGeometry args={[0.74, 0.74, reach]} />
        </mesh>
        <mesh position={[-w / 2 + 0.5, 0, d / 2 + reach - 0.03]} material={mats.intake}>
          <planeGeometry args={[0.7, 0.7]} />
        </mesh>
        {Array.from({ length: 5 }, (_, i) => (
          <mesh key={i} position={[-w / 2 + 0.5, -0.28 + i * 0.14, d / 2 + reach + 0.02]} rotation-x={0.5} material={mats.frame}>
            <boxGeometry args={[0.78, 0.02, 0.12]} />
          </mesh>
        ))}

        {/* filter */}
        <mesh position={[-w / 2 + 1.0, 0, 0]}>
          <boxGeometry args={[0.08, h - 0.22, d - 0.22]} />
          <meshStandardMaterial color="#e6edf8" roughness={0.95} transparent opacity={0.55} />
        </mesh>

        {/* chilled-water coil: a bank of fins */}
        <group position={[-w / 2 + 1.42, 0, 0]}>
          {fins.map((fz, i) => (
            <mesh key={i} position={[0, 0, fz]} material={mats.coil}>
              <boxGeometry args={[0.34, h - 0.3, 0.03]} />
            </mesh>
          ))}
        </group>

        {/* chilled-water pipes and the control valve */}
        <mesh position={[-w / 2 + 1.5, h / 2 + 0.2, -d / 2 + 0.3]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.06, 0.06, 1.0, 14]} />
          <meshStandardMaterial color="#4fb8ea" emissive="#4fb8ea" emissiveIntensity={0.6} roughness={0.3} metalness={0.6} />
        </mesh>
        <mesh position={[-w / 2 + 1.3, h / 2 + 0.2, -d / 2 + 0.3]} rotation-x={Math.PI / 2} material={mats.steel}>
          <cylinderGeometry args={[0.06, 0.06, 1.0, 14]} />
        </mesh>
        <mesh ref={valve} position={[-w / 2 + 1.5, h / 2 + 0.2, -d / 2 - 0.3]} material={mats.gold}>
          <boxGeometry args={[0.3, 0.09, 0.09]} />
        </mesh>

        {/* supply fan */}
        <group position={[w / 2 - 0.72, 0, 0]}>
          <group ref={wheel}>
            <mesh rotation-z={Math.PI / 2} material={mats.steel}>
              <torusGeometry args={[0.58, 0.04, 10, 48]} />
            </mesh>
            <mesh rotation-z={Math.PI / 2} material={mats.gold}>
              <cylinderGeometry args={[0.15, 0.15, 0.32, 20]} />
            </mesh>
            {Array.from({ length: BLADES }, (_, i) => {
              const a = (i / BLADES) * Math.PI * 2;
              return (
                <mesh key={i} position={[0, Math.cos(a) * 0.36, Math.sin(a) * 0.36]} rotation-x={a + 0.5} material={mats.steel} castShadow>
                  <boxGeometry args={[0.27, 0.4, 0.022]} />
                </mesh>
              );
            })}
          </group>
        </group>

        {/* running lamp */}
        <mesh position={[w / 2 - 0.16, h / 2 + 0.05, d / 2 - 0.16]} material={mats.lamp}>
          <sphereGeometry args={[0.06, 14, 10]} />
        </mesh>
      </group>
    </group>
  );
}
