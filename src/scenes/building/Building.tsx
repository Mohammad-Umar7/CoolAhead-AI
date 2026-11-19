import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ROOMS } from '../../engine/config';
import { MODE_HEX } from '../../lib/day';
import { damp } from '../../lib/frame';
import { useSim } from '../../state/sim';
import Anchors, { type AnchorEls, type AnchorPoint } from '../Anchors';
import { AHU_POS, BOUNDS, DUCTS, LENGTH as PLAN_W, OTHER, PLAN, PLANT } from '../floor/layout';
import Dressing from './Dressing';
import Interior from './Interior';
import { smooth as ease, type Look } from './kit';
import { CORE, CORES, DEPTH, FLOORS, FLOOR_H, LENGTH, ROOM_BOXES, SLAB, SPOTS, ZONE_D, ZONE_W, heatRgb, liveIndex, newZoneNow, sampleZone, tempRgb } from './model';

export type Layer = 'temp' | 'heat' | 'xray';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const tmp = new THREE.Object3D();
const color = new THREE.Color();
const a3: [number, number, number] = [0, 0, 0];
const b3: [number, number, number] = [0, 0, 0];
const ROOM_H = FLOOR_H - SLAB - 0.08;
/** the carpet of the opened floor: the rooms keep a tint of their colour over it */
const PAPER: [number, number, number] = [0.37, 0.41, 0.48];
const LIVE = SPOTS[liveIndex];
/** instances a zone's air system takes: the air handler, then each duct run */
const PER = DUCTS.length + 1;

function place(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
  tmp.position.set(x, y, z);
  tmp.rotation.set(0, 0, 0);
  tmp.scale.set(sx, sy, sz);
  tmp.updateMatrix();
  mesh.setMatrixAt(i, tmp.matrix);
}

/* ---------------------------------------------------------------- a stack of storeys */

/**
 * Some storeys of the building: the floor plates, the two cores, and for every
 * zone its three rooms as blocks in the colour of what is being shown. The
 * storeys above the simulated one are a separate stack so they can be lifted
 * off it.
 */
function Storeys({ floors, upper, look }: { floors: number[]; upper: boolean; look: React.RefObject<Look> }) {
  const group = useRef<THREE.Group>(null);
  const slabs = useRef<THREE.InstancedMesh>(null);
  const cores = useRef<THREE.InstancedMesh>(null);
  const mutes = useRef<THREE.InstancedMesh>(null);
  const rooms = useRef<THREE.InstancedMesh>(null);
  const strips = useRef<THREE.InstancedMesh>(null);
  const pipes = useRef<THREE.InstancedMesh>(null);
  const spots = useMemo(() => SPOTS.filter((s) => floors.includes(s.floor)), [floors]);
  const now = useMemo(() => newZoneNow(), []);
  const mats = useMemo(
    () => ({
      slab: new THREE.MeshStandardMaterial({ color: '#c9cac6', roughness: 0.88 }),
      core: new THREE.MeshStandardMaterial({ color: '#b3b5b2', roughness: 0.9 }),
      mute: new THREE.MeshStandardMaterial({ color: '#8f97a3', roughness: 0.9 }),
      room: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }),
      strip: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
      pipe: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true, opacity: 0 }),
    }),
    [],
  );

  useLayoutEffect(() => {
    const y0 = floors[0] * FLOOR_H;
    floors.forEach((f, i) => place(slabs.current!, i, 0, f * FLOOR_H, 0, LENGTH + 1.8, SLAB, DEPTH + 1.8));
    if (upper) place(slabs.current!, floors.length, 0, FLOORS * FLOOR_H + 0.05, 0, LENGTH + 2.8, SLAB * 1.5, DEPTH + 2.8);
    const tall = floors.length * FLOOR_H + (upper ? 1.8 : 0);
    CORES.forEach((x, i) => place(cores.current!, i, x, y0 + tall / 2, 0, CORE.w, tall, CORE.d));
    spots.forEach((s, i) => {
      const y = s.y + ROOM_H / 2;
      place(mutes.current!, i * 2, s.x + (PLANT.x0 + PLANT.x1) / 2, y, s.z + (PLANT.z0 + PLANT.z1) / 2, PLANT.x1 - PLANT.x0 - 0.3, ROOM_H, PLANT.z1 - PLANT.z0 - 0.3);
      place(mutes.current!, i * 2 + 1, s.x + (OTHER.x0 + OTHER.x1) / 2, y, s.z + (OTHER.z0 + OTHER.z1) / 2, OTHER.x1 - OTHER.x0 - 0.3, ROOM_H, OTHER.z1 - OTHER.z0 - 0.3);
      ROOM_BOXES.forEach((b, r) => place(rooms.current!, i * 3 + r, s.x + b.x, y, s.z + b.z, b.w - 0.3, ROOM_H, b.d - 0.3));
      place(strips.current!, i, s.x + PLAN_W / 2, s.floor * FLOOR_H, DEPTH / 2 + 0.96, ZONE_W - 1.2, SLAB + 0.1, 0.14);
      // every zone has its own air handler and duct tree: one cabinet, then the runs
      place(pipes.current!, i * PER, s.x + AHU_POS.x, s.y + AHU_POS.h / 2, s.z + AHU_POS.z, AHU_POS.w, AHU_POS.h, AHU_POS.d);
      DUCTS.forEach((run, k) => {
        const drop = Math.min(run.a[1], run.b[1]) < 2 ? 0 : -0.35;
        place(
          pipes.current!,
          i * PER + 1 + k,
          s.x + (run.a[0] + run.b[0]) / 2,
          s.y + (run.a[1] + run.b[1]) / 2 + drop,
          s.z + (run.a[2] + run.b[2]) / 2,
          Math.abs(run.b[0] - run.a[0]) + run.size,
          Math.abs(run.b[1] - run.a[1]) + run.size,
          Math.abs(run.b[2] - run.a[2]) + run.size,
        );
      });
    });
    for (const m of [slabs, cores, mutes, rooms, strips, pipes]) m.current!.instanceMatrix.needsUpdate = true;
  }, [floors, spots, upper]);

  useFrame(() => {
    const l = look.current;
    if (!l || !rooms.current || !strips.current) return;
    const t = useSim.getState().t;
    const open = ease(l.focus);

    // the upper storeys are lifted clear of level three and fade right out, so only the opened floor is left
    const base = upper ? 1 - open : 1;
    if (upper && group.current) {
      group.current.position.y = open * 17;
      // faded right out it must also stop drawing, or it still hides what is under it
      group.current.visible = base > 0.01;
    }
    const fade = (m: THREE.Material, keep: number) => {
      const o = base * (1 - (1 - keep) * l.xray);
      m.opacity = o;
      m.transparent = o < 0.995;
      m.depthWrite = o > 0.5;
    };
    fade(mats.slab, 0.26);
    fade(mats.mute, 0.03);
    fade(mats.room, 0.06);
    // the lift cores would stand up through the opened floor: they go too
    const core = base * (1 - open) * (1 - 0.9 * l.xray);
    mats.core.opacity = core;
    mats.core.transparent = core < 0.995;
    mats.core.depthWrite = core > 0.5;
    cores.current!.visible = core > 0.01;
    mats.strip.opacity = base * (1 - open);
    mats.strip.transparent = mats.strip.opacity < 0.995;
    strips.current.visible = mats.strip.opacity > 0.01;
    mats.pipe.opacity = base * l.xray;
    if (pipes.current) pipes.current.visible = l.xray > 0.01;
    const shadows = base > 0.6 && l.xray < 0.5;
    for (const m of [slabs, cores, mutes, rooms]) m.current!.castShadow = shadows;

    spots.forEach((s, i) => {
      sampleZone(s, t, now);
      for (let r = 0; r < 3; r++) {
        tempRgb(now.temp[r], a3);
        heatRgb(Math.min(1, now.occ[r] / ROOMS[r].capacity), b3);
        let cr = a3[0] + (b3[0] - a3[0]) * l.heat;
        let cg = a3[1] + (b3[1] - a3[1]) * l.heat;
        let cb = a3[2] + (b3[2] - a3[2]) * l.heat;
        if (s.floor === LIVE.floor) {
          // opened up: every room on the floor flattens; the simulated rooms keep a tint of their colour, the rest go plain
          const k = s.live ? open * Math.max(l.heat * 0.9, 0.58) : open;
          cr += (PAPER[0] - cr) * k;
          cg += (PAPER[1] - cg) * k;
          cb += (PAPER[2] - cb) * k;
          const b = ROOM_BOXES[r];
          const h = ROOM_H + (0.08 - ROOM_H) * open;
          place(rooms.current!, i * 3 + r, s.x + b.x, s.y + h / 2, s.z + b.z, b.w - 0.3, h, b.d - 0.3);
        }
        rooms.current!.setColorAt(i * 3 + r, color.setRGB(cr, cg, cb, THREE.SRGBColorSpace));
      }
      if (s.floor === LIVE.floor) {
        const h = ROOM_H + (0.08 - ROOM_H) * open;
        place(mutes.current!, i * 2, s.x + (PLANT.x0 + PLANT.x1) / 2, s.y + h / 2, s.z + (PLANT.z0 + PLANT.z1) / 2, PLANT.x1 - PLANT.x0 - 0.3, h, PLANT.z1 - PLANT.z0 - 0.3);
        place(mutes.current!, i * 2 + 1, s.x + (OTHER.x0 + OTHER.x1) / 2, s.y + h / 2, s.z + (OTHER.z0 + OTHER.z1) / 2, OTHER.x1 - OTHER.x0 - 0.3, h, OTHER.z1 - OTHER.z0 - 0.3);
        rooms.current!.instanceMatrix.needsUpdate = true;
        mutes.current!.instanceMatrix.needsUpdate = true;
      }
      strips.current!.setColorAt(i, color.set(MODE_HEX[now.mode]));
      if (l.xray > 0.01) for (let k = 0; k < PER; k++) pipes.current!.setColorAt(i * PER + k, color);
    });
    rooms.current.instanceColor!.needsUpdate = true;
    strips.current.instanceColor!.needsUpdate = true;
    if (l.xray > 0.01 && pipes.current!.instanceColor) pipes.current!.instanceColor.needsUpdate = true;
  });

  return (
    <group ref={group}>
      <instancedMesh ref={slabs} args={[BOX, mats.slab, floors.length + (upper ? 1 : 0)]} castShadow receiveShadow />
      <instancedMesh ref={cores} args={[BOX, mats.core, CORES.length]} castShadow receiveShadow />
      <instancedMesh ref={mutes} args={[BOX, mats.mute, spots.length * 2]} castShadow receiveShadow />
      <instancedMesh ref={rooms} args={[BOX, mats.room, spots.length * 3]} castShadow receiveShadow />
      <instancedMesh ref={strips} args={[BOX, mats.strip, spots.length]} />
      <instancedMesh ref={pipes} args={[BOX, mats.pipe, spots.length * PER]} visible={false} />
    </group>
  );
}

/* ---------------------------------------------------------------- the whole model */

/** Points labels can be pinned to. */
export const BUILDING_ANCHORS: AnchorPoint[] = [
  { key: 'live', position: [LIVE.x + PLAN_W / 2, LIVE.floor * FLOOR_H + FLOOR_H / 2, DEPTH / 2 + 1.4] },
  { key: 'top', position: [-LENGTH / 2 - 1.5, (FLOORS - 0.5) * FLOOR_H, DEPTH / 2 + 1] },
  { key: 'ground', position: [-LENGTH / 2 - 1.5, 0.5 * FLOOR_H, DEPTH / 2 + 1] },
  ...PLAN.map((p) => ({ key: `room${p.index}`, position: [LIVE.x + p.cx, LIVE.y + 2.6, LIVE.z + p.cz] as [number, number, number] })),
  { key: 'ahu', position: [LIVE.x + AHU_POS.x, LIVE.y + 3.2, LIVE.z + AHU_POS.z] },
];

interface Props {
  layer: Layer;
  /** open the building at level three and look into the simulated zone */
  focus: boolean;
  tags?: React.RefObject<AnchorEls>;
}

const LOWER = [0, 1, 2];
const UPPER = Array.from({ length: FLOORS - 3 }, (_, i) => i + 3);

export default function Building({ layer, focus, tags }: Props) {
  const look = useRef<Look>({ focus: 0, heat: 0, xray: 0 });
  const ring = useRef<THREE.LineBasicMaterial>(null);
  const edge = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(ZONE_W + 0.7, FLOOR_H - 0.2, ZONE_D + 3.6)), []);

  useFrame((state, dt) => {
    const l = look.current;
    l.focus = damp(l.focus, focus ? 1 : 0, 2.6, dt);
    l.heat = damp(l.heat, layer === 'heat' ? 1 : 0, 5, dt);
    l.xray = damp(l.xray, layer === 'xray' ? 1 : 0, 4, dt);
    if (ring.current) ring.current.opacity = (1 - ease(l.focus)) * (0.55 + 0.45 * Math.sin(state.clock.elapsedTime * 2.6));
  }, -1);

  return (
    <group>
      {/* the base the model stands on */}
      <mesh position={[0, -0.75, 0]} receiveShadow castShadow>
        <boxGeometry args={[LENGTH + 26, 1.2, DEPTH + 26]} />
        <meshStandardMaterial color="#cfccc3" roughness={0.95} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-1.34} receiveShadow>
        <circleGeometry args={[320, 64]} />
        <shadowMaterial transparent opacity={0.22} />
      </mesh>

      <Storeys floors={LOWER} upper={false} look={look} />
      <Storeys floors={UPPER} upper look={look} />
      <Dressing look={look} />
      <Interior look={look} />

      <lineSegments geometry={edge} position={[LIVE.x + PLAN_W / 2 + (BOUNDS.x0 + BOUNDS.x1 - PLAN_W) / 2, LIVE.floor * FLOOR_H + FLOOR_H / 2, 0]}>
        <lineBasicMaterial ref={ring} color="#0f1522" transparent opacity={1} />
      </lineSegments>

      {tags && <Anchors points={BUILDING_ANCHORS} els={tags} />}
    </group>
  );
}
