import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Bag, smooth, type Look } from './kit';
import { DEPTH, FLOORS, FLOOR_H, LENGTH, SLAB } from './model';

/**
 * What makes the stack of floors read as a building: a glazed curtain wall
 * with its mullions, plant on the roof, a canopy over the entrance, paving
 * and a few trees for scale. The curtain wall above level two lifts away with
 * the storeys it belongs to.
 */

const W = LENGTH + 1.2;
const D = DEPTH + 1.2;
const H = FLOOR_H - SLAB;
const STEP = 2.4;

function curtain(floors: number[]) {
  const glass = new Bag();
  const fins = new Bag();
  for (const f of floors) {
    const y = f * FLOOR_H + SLAB / 2 + H / 2;
    for (const z of [-D / 2, D / 2]) {
      glass.box(W, H, 0.05, 0, y, z);
      const n = Math.round(W / STEP);
      for (let i = 0; i <= n; i++) fins.box(0.07, H, 0.26, -W / 2 + (W * i) / n, y, z + Math.sign(z) * 0.1);
    }
    for (const x of [-W / 2, W / 2]) {
      glass.box(0.05, H, D, x, y, 0);
      const n = Math.round(D / STEP);
      for (let i = 0; i <= n; i++) fins.box(0.26, H, 0.07, x + Math.sign(x) * 0.1, y, -D / 2 + (D * i) / n);
    }
  }
  return { glass: glass.done(), fins: fins.done() };
}

function roof() {
  const y = FLOORS * FLOOR_H + SLAB;
  const metal = new Bag();
  const dark = new Bag();
  // parapet
  for (const z of [-D / 2 - 0.7, D / 2 + 0.7]) metal.box(W + 1.6, 0.9, 0.22, 0, y + 0.45, z);
  for (const x of [-W / 2 - 0.7, W / 2 + 0.7]) metal.box(0.22, 0.9, D + 1.6, x, y + 0.45, 0);
  // chillers: long cabinets with a row of fans on top
  for (const [cx, cz] of [
    [-20, -3],
    [-4, -3],
    [14, 3],
  ]) {
    metal.box(11, 2.1, 3.2, cx, y + 1.25, cz);
    dark.box(11.2, 0.25, 3.4, cx, y + 0.15, cz);
    for (let i = 0; i < 5; i++) {
      dark.rod(1.15, 0.16, cx - 4.4 + i * 2.2, y + 2.38, cz, 'y', 28);
      metal.rod(0.28, 0.2, cx - 4.4 + i * 2.2, y + 2.42, cz, 'y', 14);
    }
  }
  // stair heads and a run of pipework
  metal.box(6, 3, 6, 28, y + 1.5, -4);
  metal.box(6, 3, 6, -30, y + 1.5, 4);
  dark.rod(0.22, 50, -2, y + 0.5, 6.5, 'x', 12);
  dark.rod(0.22, 50, -2, y + 0.5, 7.2, 'x', 12);
  return { metal: metal.done(), dark: dark.done() };
}

function ground() {
  const stone = new Bag();
  const dark = new Bag();
  // entrance: a canopy on slim columns, and steps up to it
  stone.box(16, 0.3, 6.5, 8, 4.6, D / 2 + 3.6);
  for (const x of [1.2, 14.8]) dark.rod(0.16, 4.5, x, 2.25, D / 2 + 6.2, 'y', 14);
  for (let i = 0; i < 3; i++) stone.box(17 - i * 0.6, 0.16, 1.2, 8, 0.08 + i * 0.16, D / 2 + 7.6 - i * 0.6);
  // paving joints across the forecourt
  for (let i = -5; i <= 5; i++) dark.box(0.05, 0.02, 11, i * 7.4, 0.012, D / 2 + 6.4);
  dark.box(LENGTH + 22, 0.02, 0.05, 0, 0.012, D / 2 + 4.2);
  dark.box(LENGTH + 22, 0.02, 0.05, 0, 0.012, D / 2 + 8.6);
  return { stone: stone.done(), dark: dark.done() };
}

const TREES: [number, number, number][] = [
  [-40, 20, 1.0],
  [-31, 21.5, 1.15],
  [-22, 20.5, 0.9],
  [-12, 22, 1.1],
  [26, 21, 1.05],
  [35, 20, 0.95],
  [43, 21.5, 1.2],
  [-46, -3, 1.1],
  [-46, 9, 0.95],
  [46, -6, 1.05],
  [46, 7, 1.15],
  [-34, -21, 1.0],
  [-14, -22, 1.1],
  [8, -21, 0.95],
  [30, -22, 1.2],
];

const tmp = new THREE.Object3D();
const LOWER = [0, 1];
const MIDDLE = [2];
const UPPER = Array.from({ length: FLOORS - 3 }, (_, i) => i + 3);

export default function Dressing({ look }: { look: React.RefObject<Look> }) {
  const lower = useMemo(() => curtain(LOWER), []);
  const middle = useMemo(() => curtain(MIDDLE), []);
  const upper = useMemo(() => curtain(UPPER), []);
  const top = useMemo(roof, []);
  const base = useMemo(ground, []);
  const lifted = useRef<THREE.Group>(null);
  const crowns = useRef<THREE.InstancedMesh>(null);
  const trunks = useRef<THREE.InstancedMesh>(null);
  const grove = useRef<THREE.Group>(null);
  const mats = useMemo(() => {
    const glass = () => new THREE.MeshStandardMaterial({ color: '#6fa6cf', roughness: 0.04, metalness: 0.6, transparent: true, opacity: 0.42, depthWrite: false, envMapIntensity: 2.2 });
    const fin = () => new THREE.MeshStandardMaterial({ color: '#3f4853', roughness: 0.4, metalness: 0.7 });
    const solid = (c: string, m = 0.2) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: m });
    return { glass: [glass(), glass(), glass()], fin: [fin(), fin(), fin()], roofMetal: solid('#b4bcc5', 0.6), roofDark: solid('#39424e', 0.6) };
  }, []);

  useLayoutEffect(() => {
    TREES.forEach(([x, z, s], i) => {
      tmp.rotation.set(0, i * 1.7, 0);
      tmp.position.set(x, 3.1 * s + 1.2, z);
      tmp.scale.set(2.1 * s, 2.7 * s, 2.1 * s);
      tmp.updateMatrix();
      crowns.current!.setMatrixAt(i, tmp.matrix);
      tmp.position.set(x, 1.1, z);
      tmp.scale.set(1, 1, 1);
      tmp.updateMatrix();
      trunks.current!.setMatrixAt(i, tmp.matrix);
    });
    crowns.current!.instanceMatrix.needsUpdate = true;
    trunks.current!.instanceMatrix.needsUpdate = true;
  }, []);

  useFrame(() => {
    const l = look.current;
    if (!l) return;
    const open = smooth(l.focus);
    if (lifted.current) lifted.current.position.y = open * 17;
    // the trees step back when the view moves inside, so nothing stands between the eye and level three
    if (grove.current) {
      grove.current.scale.setScalar(Math.max(0.001, 1 - open));
      grove.current.visible = open < 0.98;
    }
    // glass thins out when looking through the building, and comes off the storeys that are lifted or opened
    const fade = [1, 1 - open, 1 - 0.93 * open];
    for (let i = 0; i < 3; i++) {
      mats.glass[i].opacity = 0.42 * fade[i] * (1 - 0.75 * l.xray);
      const o = fade[i] * (1 - 0.8 * l.xray);
      mats.fin[i].opacity = o;
      mats.fin[i].transparent = o < 0.995;
      mats.fin[i].depthWrite = o > 0.5;
    }
    for (const m of [mats.roofMetal, mats.roofDark]) {
      m.opacity = fade[2] * (1 - 0.7 * l.xray);
      m.transparent = m.opacity < 0.995;
      m.depthWrite = m.opacity > 0.5;
    }
  });

  return (
    <group>
      {[lower, middle].map((c, i) => (
        <group key={i}>
          <mesh geometry={c.fins} material={mats.fin[i]} castShadow={i === 0} />
          <mesh geometry={c.glass} material={mats.glass[i]} renderOrder={2} />
        </group>
      ))}
      <group ref={lifted}>
        <mesh geometry={upper.fins} material={mats.fin[2]} castShadow />
        <mesh geometry={upper.glass} material={mats.glass[2]} renderOrder={2} />
        <mesh geometry={top.metal} material={mats.roofMetal} castShadow receiveShadow />
        <mesh geometry={top.dark} material={mats.roofDark} castShadow />
      </group>

      <mesh geometry={base.stone} castShadow receiveShadow>
        <meshStandardMaterial color="#d9d6ce" roughness={0.85} />
      </mesh>
      <mesh geometry={base.dark}>
        <meshStandardMaterial color="#8f8b80" roughness={0.9} />
      </mesh>
      <group ref={grove}>
        <instancedMesh ref={crowns} args={[undefined, undefined, TREES.length]} castShadow receiveShadow>
          <icosahedronGeometry args={[1, 3]} />
          <meshStandardMaterial color="#5c9a5f" roughness={0.9} />
        </instancedMesh>
        <instancedMesh ref={trunks} args={[undefined, undefined, TREES.length]} castShadow>
          <cylinderGeometry args={[0.16, 0.24, 2.4, 8]} />
          <meshStandardMaterial color="#6b5440" roughness={0.9} />
        </instancedMesh>
      </group>
    </group>
  );
}
