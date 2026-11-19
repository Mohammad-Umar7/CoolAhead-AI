import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Frame } from '../../lib/frame';
import { PLAN } from './layout';

const TONES = ['#cdd8e0', '#b9c7d1', '#dfe6ea', '#a9bac6', '#c3cfd8'];

interface Person {
  room: number;
  rank: number;
  x: number;
  z: number;
  phase: number;
  tone: number;
}

/**
 * Anonymous seated figures: a body and a head, nothing that could identify
 * anyone. Seats fill in a shuffled order as the head count rises.
 */
export default function People({ frame, dim = 0 }: { frame: React.RefObject<Frame>; dim?: number }) {
  const bodies = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const people = useMemo<Person[]>(
    () =>
      PLAN.flatMap((p) =>
        p.seats.map(([x, z], rank) => ({ room: p.index, rank, x, z, phase: (rank * 2.399 + p.index) % 6.283, tone: (rank * 7 + p.index * 3) % TONES.length })),
      ),
    [],
  );
  const shown = useRef(new Float32Array(people.length));
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    const c = new THREE.Color();
    people.forEach((p, i) => {
      c.set(TONES[p.tone]);
      bodies.current!.setColorAt(i, c);
      heads.current!.setColorAt(i, c);
    });
    bodies.current!.instanceColor!.needsUpdate = true;
    heads.current!.instanceColor!.needsUpdate = true;
  }, [people]);

  useFrame((state, dt) => {
    const f = frame.current;
    if (!f || !bodies.current || !heads.current) return;
    const time = state.clock.elapsedTime;
    const k = 1 - Math.exp(-dt * 7);
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      const target = Math.min(1, Math.max(0, f.occ[p.room] - p.rank));
      const s = (shown.current[i] += (target - shown.current[i]) * k);
      const ease = s * s * (3 - 2 * s);
      const sway = Math.sin(time * 0.9 + p.phase) * 0.05;
      dummy.position.set(p.x, 0.62 * ease, p.z);
      dummy.rotation.set(0, sway, 0);
      dummy.scale.set(ease, ease, ease);
      dummy.updateMatrix();
      bodies.current.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x - 0.03, 1.2 * ease + Math.sin(time * 1.3 + p.phase) * 0.008, p.z);
      dummy.updateMatrix();
      heads.current.setMatrixAt(i, dummy.matrix);
    }
    bodies.current.instanceMatrix.needsUpdate = true;
    heads.current.instanceMatrix.needsUpdate = true;
  });

  const emissive = 0.1 * (1 - dim);
  return (
    <group>
      <instancedMesh ref={bodies} args={[undefined, undefined, people.length]} castShadow frustumCulled={false}>
        <capsuleGeometry args={[0.17, 0.5, 4, 10]} />
        <meshStandardMaterial roughness={0.55} metalness={0.05} emissive="#9fb4c2" emissiveIntensity={emissive} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, people.length]} castShadow frustumCulled={false}>
        <sphereGeometry args={[0.125, 14, 12]} />
        <meshStandardMaterial roughness={0.5} metalness={0.05} emissive="#9fb4c2" emissiveIntensity={emissive} />
      </instancedMesh>
    </group>
  );
}
