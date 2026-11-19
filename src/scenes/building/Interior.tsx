import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { MODE_HEX } from '../../lib/day';
import { damp, newFrame, sampleFrame, type Frame } from '../../lib/frame';
import { useSim } from '../../state/sim';
import { AHU_POS, CORRIDOR, DUCTS, DUCT_Y, LENGTH as PLAN_W, NORTH, OTHER, PLAN, PLANT, SOUTH, TRUNK_Z } from '../floor/layout';
import Airflow from './Airflow';
import { Bag, smooth, type Look } from './kit';
import { FLOOR_H, SLAB, SPOTS, heatLut, liveIndex } from './model';

/**
 * Level three, west wing, with the lid off: three classrooms behind glass, the
 * people the cameras count, and the one air handler whose ducts tie the rooms
 * together. Built from many small parts so it reads as a model of a real floor.
 */

const LIVE = SPOTS[liveIndex];
const PLAN_D = SOUTH.z1;
const SILL = 0.95;
const HEAD = 2.55;
const DOOR = 1.0;
const tmp = new THREE.Object3D();
const color = new THREE.Color();
const WALKERS = 44;
const PACE = 3.4;

/** A detection box as the eight corners of a unit cube: the frame a tracker draws round each person it has found. */
function bracketGeometry() {
  const bag = new Bag();
  const t = 0.035;
  const len = 0.3;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * 0.5;
        const y = sy * 0.5;
        const z = sz * 0.5;
        bag.box(len, t, t, x - (sx * len) / 2, y, z);
        bag.box(t, len, t, x, y - (sy * len) / 2, z);
        bag.box(t, t, len, x, y, z - (sz * len) / 2);
      }
    }
  }
  return bag.done();
}

interface Walker {
  on: boolean;
  room: number;
  d: number;
  len: number;
  pts: [number, number][];
  tone: number;
}

/** The way out from a seat: along the row to the aisle, to the nearest door, and off down the corridor. */
function wayOut(room: number, x: number, z: number): [number, number][] {
  const p = PLAN[room];
  const aisle = p.zCorridor + (p.side === 'north' ? -0.95 : 0.95);
  const door = p.doors.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
  const hall = TRUNK_Z + (p.side === 'north' ? -0.45 : 0.45);
  const exit = door < PLAN_W / 2 ? -2.2 : PLAN_W + 2.2;
  return [
    [x + 0.3, z],
    [x + 0.3, aisle],
    [door, aisle],
    [door, hall],
    [exit, hall],
  ];
}

/* ---------------------------------------------------------------- the fabric: walls, glass, doors */

interface Run {
  /** the wall runs along this axis at this position on the other */
  along: 'x' | 'z';
  at: number;
  from: number;
  to: number;
  doors?: number[];
  /** an outside wall: glass from a low sill, close mullions */
  facade?: boolean;
}

const zN = NORTH.z1 + 0.125;
const zS = SOUTH.z0 - 0.125;
const RUNS: Run[] = [
  { along: 'x', at: 0, from: 0, to: PLAN_W, facade: true },
  { along: 'x', at: PLAN_D, from: 0, to: PLAN_W, facade: true },
  { along: 'x', at: zN, from: 0, to: PLAN_W, doors: [PLAN[1].doors[0], PLAN[1].doors[1], PLAN[2].doors[0]] },
  { along: 'x', at: zS, from: 0, to: PLAN_W, doors: [PLANT.door, PLAN[0].doors[0], OTHER.door] },
  { along: 'z', at: 0, from: 0, to: zN, facade: true },
  { along: 'z', at: PLAN[1].x1 + 0.125, from: 0, to: zN },
  { along: 'z', at: PLAN_W, from: 0, to: zN, facade: true },
  { along: 'z', at: 0, from: zS, to: PLAN_D, facade: true },
  { along: 'z', at: PLANT.x1 + 0.125, from: zS, to: PLAN_D },
  { along: 'z', at: OTHER.x0 - 0.125, from: zS, to: PLAN_D },
  { along: 'z', at: PLAN_W, from: zS, to: PLAN_D, facade: true },
];

function fabric() {
  const solid = new Bag();
  const glass = new Bag();
  const frame = new Bag();
  const leaf = new Bag();
  for (const r of RUNS) {
    const put = (bag: Bag, a0: number, a1: number, y0: number, y1: number, t: number) => {
      const len = a1 - a0;
      const mid = (a0 + a1) / 2;
      if (len <= 0.01) return;
      if (r.along === 'x') bag.box(len, y1 - y0, t, mid, (y0 + y1) / 2, r.at);
      else bag.box(t, y1 - y0, len, r.at, (y0 + y1) / 2, mid);
    };
    const post = (a: number, y0: number, y1: number, w = 0.06) => {
      if (r.along === 'x') frame.box(w, y1 - y0, 0.1, a, (y0 + y1) / 2, r.at);
      else frame.box(0.1, y1 - y0, w, r.at, (y0 + y1) / 2, a);
    };
    const sill = r.facade ? 0.55 : SILL;
    const head = r.facade ? 2.75 : HEAD;
    // the wall is cut into stretches by its doors
    const cuts = (r.doors ?? []).slice().sort((a, b) => a - b);
    let a = r.from;
    const stretch = (b: number) => {
      put(solid, a, b, 0, sill, 0.16);
      put(glass, a, b, sill, head, 0.04);
      put(frame, a, b, sill - 0.03, sill + 0.03, 0.1);
      put(frame, a, b, head - 0.03, head + 0.04, 0.1);
      const step = r.facade ? 1.25 : 2.1;
      const n = Math.max(1, Math.round((b - a) / step));
      for (let i = 0; i <= n; i++) post(a + ((b - a) * i) / n, sill, head);
    };
    for (const c of cuts) {
      stretch(c - DOOR / 2);
      // the doorway: two posts, a glazed panel over the head, and the leaf standing open into the room
      post(c - DOOR / 2, 0, head, 0.07);
      post(c + DOOR / 2, 0, head, 0.07);
      put(frame, c - DOOR / 2, c + DOOR / 2, 2.1, 2.16, 0.1);
      put(glass, c - DOOR / 2, c + DOOR / 2, 2.16, head, 0.04);
      const inward = r.at < CORRIDOR.z0 ? -1 : 1;
      leaf.box(0.045, 2.05, 0.92, c - DOOR / 2 + 0.03, 1.05, r.at + inward * 0.47, inward * 0.24);
      a = c + DOOR / 2;
    }
    stretch(r.to);
  }
  return { solid: solid.done(), glass: glass.done(), frame: frame.done(), leaf: leaf.done() };
}

/* ---------------------------------------------------------------- furniture and the things on the walls */

function furniture() {
  const wood = new Bag();
  const metal = new Bag();
  const board = new Bag();
  const dark = new Bag();
  for (const p of PLAN) {
    for (const d of p.desks) {
      wood.box(0.46, 0.035, d.len, d.x, 0.745, d.z);
      wood.box(0.025, 0.42, d.len - 0.1, d.x - 0.2, 0.5, d.z);
      const legs = Math.max(2, Math.round(d.len / 2.2) + 1);
      for (let i = 0; i < legs; i++) metal.box(0.4, 0.72, 0.035, d.x, 0.36, d.z - d.len / 2 + 0.06 + ((d.len - 0.12) * i) / (legs - 1));
    }
    // the teaching wall: a board, a screen above it, and a lectern off to one side
    const span = Math.min(4.4, (p.z1 - p.z0) * 0.6);
    board.box(0.04, 1.25, span, p.x0 + 0.13, 1.55, p.cz);
    dark.box(0.05, 1.33, span + 0.08, p.x0 + 0.1, 1.55, p.cz);
    wood.box(0.5, 1.05, 0.6, p.x0 + 1.1, 0.525, p.cz + (p.side === 'north' ? 1 : -1) * (span / 2 + 0.3));
    dark.box(0.42, 0.03, 0.5, p.x0 + 1.1, 1.08, p.cz + (p.side === 'north' ? 1 : -1) * (span / 2 + 0.3));
  }
  return { wood: wood.done(), metal: metal.done(), board: board.done(), dark: dark.done() };
}

/* ---------------------------------------------------------------- ducts, diffusers, the air handler */

function services() {
  const duct = new Bag();
  const flange = new Bag();
  const grille = new Bag();
  const hanger = new Bag();
  for (const run of DUCTS) {
    const [ax, ay, az] = run.a;
    const [bx, by, bz] = run.b;
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const axis: 'x' | 'y' | 'z' = Math.abs(bx - ax) > 0.01 ? 'x' : Math.abs(by - ay) > 0.01 ? 'y' : 'z';
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const mz = (az + bz) / 2;
    const trunk = run.size > 0.5;
    if (trunk) {
      // rectangular main duct, with a bolted flange every metre and a bit
      const w = run.size;
      const h = run.size * 0.72;
      duct.box(axis === 'x' ? len + w : w, axis === 'y' ? len : h, axis === 'z' ? len + w : axis === 'x' ? w : w, mx, my, mz);
      const n = Math.max(1, Math.round(len / 1.2));
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        const x = ax + (bx - ax) * f;
        const y = ay + (by - ay) * f;
        const z = az + (bz - az) * f;
        if (axis === 'x') flange.box(0.05, h + 0.09, w + 0.09, x, y, z);
        else if (axis === 'z') flange.box(w + 0.09, h + 0.09, 0.05, x, y, z);
        else flange.box(w + 0.09, 0.05, w + 0.09, x, y, z);
        if (axis !== 'y' && i % 2 === 0) hanger.rod(0.012, 0.5, x, y + h / 2 + 0.25, z, 'y', 6);
      }
    } else {
      // round branch out to a ceiling diffuser
      duct.rod(run.size / 2, len, mx, my, mz, axis, 22);
      const n = Math.max(1, Math.round(len / 1.4));
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        flange.rod(run.size / 2 + 0.035, 0.05, ax + (bx - ax) * f, ay + (by - ay) * f, az + (bz - az) * f, axis, 22);
      }
      // the drop and the diffuser at its end: a square plate with a ring of slots
      duct.rod(run.size / 2 - 0.02, 0.36, bx, by - 0.2, bz, 'y', 22);
      grille.box(0.72, 0.035, 0.72, bx, DUCT_Y - 0.4, bz);
      for (const s of [0.56, 0.4, 0.24]) flange.box(s, 0.03, s, bx, DUCT_Y - 0.43 - (0.56 - s) * 0.06, bz);
    }
  }
  // return grilles high on the corridor wall of each room
  for (const p of PLAN) grille.box(1.3, 0.3, 0.06, p.cx, 2.33, p.zCorridor + (p.side === 'north' ? -0.12 : 0.12));
  return { duct: duct.done(), flange: flange.done(), grille: grille.done(), hanger: hanger.done() };
}

/** The air handler as a cabinet with its front and top glazed: filter, cooling coil, fan, and the pipes that bring chilled water. */
function airHandler() {
  const { x, z, w, h, d } = AHU_POS;
  const casing = new Bag();
  const frame = new Bag();
  const filter = new Bag();
  const coil = new Bag();
  const dark = new Bag();
  const x0 = x - w / 2;
  const z0 = z - d / 2;
  casing.box(w + 0.12, 0.14, d + 0.12, x, 0.07, z);
  casing.box(w, h - 0.14, 0.05, x, h / 2 + 0.07, z + d / 2 - 0.025);
  casing.box(0.05, h - 0.14, d, x0 + 0.025, h / 2 + 0.07, z);
  casing.box(0.05, h - 0.14, d, x0 + w - 0.025, h / 2 + 0.07, z);
  // the frame of the cabinet and the seams between its sections
  for (const fx of [0, 0.74, 1.08, 1.62, w]) {
    frame.box(0.06, h, 0.06, x0 + fx, h / 2, z0 + 0.03);
    frame.box(0.06, 0.06, d, x0 + fx, h, z);
  }
  frame.box(w, 0.06, 0.06, x, h, z0 + 0.03);
  frame.box(w, 0.06, 0.06, x, h, z0 + d - 0.03);
  frame.box(w, 0.06, 0.06, x, 0.17, z0 + 0.03);
  // intake louvres on the west end, taking outdoor air from the outside wall
  for (let i = 0; i < 7; i++) dark.box(0.03, 0.09, d - 0.3, x0 - 0.02, 0.4 + i * 0.17, z, 0).box(0.14, 0.02, d - 0.3, x0 - 0.07, 0.36 + i * 0.17, z);
  // pleated filter
  for (let i = 0; i < 12; i++) filter.box(0.26, h - 0.4, 0.03, x0 + 0.9, h / 2 + 0.05, z0 + 0.16 + (i * (d - 0.32)) / 11, i % 2 ? 0.5 : -0.5);
  // cooling coil: a bank of fins with its two headers
  for (let i = 0; i < 26; i++) coil.box(0.34, h - 0.42, 0.012, x0 + 1.35, h / 2 + 0.05, z0 + 0.14 + (i * (d - 0.28)) / 25);
  // fan section: scroll housing and motor
  dark.rod(0.2, 0.42, x0 + 2.3, 0.5, z + 0.5, 'z', 20);
  dark.box(0.5, 0.1, 0.5, x0 + 2.3, 0.24, z + 0.5);
  // the supply plenum on top, where the riser starts
  casing.box(0.74, 0.3, 0.74, x0 + w - 0.35 - 0.3 + 0.3, h + 0.15, z);
  // a control panel on the front
  dark.box(0.34, 0.5, 0.05, x0 + 2.72, 1.05, z0 - 0.02);
  return { casing: casing.done(), frame: frame.done(), filter: filter.done(), coil: coil.done(), dark: dark.done(), fan: { x: x0 + 2.3, y: 0.92, z: z - 0.05 } };
}

/** Chilled water to and from the coil, as two pipes rising and running off to the building's riser. */
function pipes() {
  const { x, z, w, d } = AHU_POS;
  const cx = x - w / 2 + 1.35;
  const make = (dz: number) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(cx, 0.4, z - d / 2 + dz), new THREE.Vector3(cx, 0.5, z - d / 2 - 0.25), new THREE.Vector3(cx, 2.0, z - d / 2 - 0.34), new THREE.Vector3(cx - 0.2, 2.42, z - d / 2 - 0.36), new THREE.Vector3(0.5, 2.42, z - d / 2 - 0.36 + dz)], false, 'catmullrom', 0.2), 40, 0.045, 10, false);
  return { cold: make(0.12), warm: make(-0.02) };
}

/* ---------------------------------------------------------------- people as a soft field on the floor */

function useHeatMap() {
  return useMemo(() => {
    const S = 256;
    const sum = document.createElement('canvas');
    sum.width = sum.height = S;
    const g = sum.getContext('2d', { willReadFrequently: true })!;
    const out = document.createElement('canvas');
    out.width = out.height = S;
    const o = out.getContext('2d')!;
    const R = 34;
    const spot = document.createElement('canvas');
    spot.width = spot.height = R * 2;
    const sg = spot.getContext('2d')!;
    const grad = sg.createRadialGradient(R, R, 0, R, R, R);
    grad.addColorStop(0, 'rgba(255,255,255,0.17)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.07)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, R * 2, R * 2);
    const lut = heatLut();
    const texture = new THREE.CanvasTexture(out);
    texture.colorSpace = THREE.SRGBColorSpace;
    let key = '';
    const draw = (occ: number[]) => {
      const k = occ.map((v) => Math.round(v)).join('-');
      if (k === key) return;
      key = k;
      g.clearRect(0, 0, S, S);
      g.globalCompositeOperation = 'lighter';
      PLAN.forEach((p) => {
        const n = Math.min(p.seats.length, Math.round(occ[p.index]));
        for (let i = 0; i < n; i++) g.drawImage(spot, (p.seats[i][0] / PLAN_W) * S - R, (p.seats[i][1] / PLAN_D) * S - R);
      });
      const img = g.getImageData(0, 0, S, S);
      const px = img.data;
      for (let i = 0; i < px.length; i += 4) {
        const v = px[i + 3] * 4;
        px[i] = lut[v];
        px[i + 1] = lut[v + 1];
        px[i + 2] = lut[v + 2];
        px[i + 3] = lut[v + 3];
      }
      o.putImageData(img, 0, 0);
      texture.needsUpdate = true;
    };
    return { texture, draw };
  }, []);
}

/* ---------------------------------------------------------------- the floor itself */

const CLOTHES = ['#27364f', '#3f6c8f', '#b4623d', '#6b7f59', '#8a5a83', '#c9a24a', '#4b5563', '#2f7d77', '#9c4a4a', '#5b6fb5'];

interface Seat {
  room: number;
  rank: number;
  x: number;
  z: number;
  phase: number;
}

export default function Interior({ look }: { look: React.RefObject<Look> }) {
  const root = useRef<THREE.Group>(null);
  const built = useRef<THREE.Group>(null);
  const frame = useRef<Frame>(newFrame());
  const heat = useHeatMap();
  const walls = useMemo(fabric, []);
  const fit = useMemo(furniture, []);
  const air = useMemo(services, []);
  const ahu = useMemo(airHandler, []);
  const water = useMemo(pipes, []);

  const seats = useMemo<Seat[]>(() => PLAN.flatMap((p) => p.seats.map(([x, z], rank) => ({ room: p.index, rank, x, z, phase: (rank * 2.399 + p.index) % 6.283 }))), []);
  const pads = useRef<THREE.InstancedMesh>(null);
  const backs = useRef<THREE.InstancedMesh>(null);
  const stems = useRef<THREE.InstancedMesh>(null);
  const torsos = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const laps = useRef<THREE.InstancedMesh>(null);
  const shown = useRef(new Float32Array(seats.length));
  const wheel = useRef<THREE.Group>(null);
  const spin = useRef(0);
  const flow = useRef(0);
  const lamps = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const heatMat = useRef<THREE.MeshBasicMaterial>(null);
  const mats = useRef<Record<string, THREE.MeshStandardMaterial | null>>({});
  const keep = (key: string) => (m: THREE.MeshStandardMaterial | null) => void (mats.current[key] = m);
  const blades = useMemo(() => Array.from({ length: 18 }, (_, i) => (i / 18) * Math.PI * 2), []);
  // what the cameras have found: a box on everyone seated, and on everyone on their way out
  const bracket = useMemo(bracketGeometry, []);
  const boxes = useRef<THREE.InstancedMesh>(null);
  const strollers = useRef<THREE.InstancedMesh>(null);
  const strollerHeads = useRef<THREE.InstancedMesh>(null);
  const walkers = useRef<Walker[]>(Array.from({ length: WALKERS }, () => ({ on: false, room: 0, d: 0, len: 1, pts: [], tone: 0 })));
  const counted = useRef<number[]>([-1, -1, -1]);
  const lastT = useRef(0);

  useLayoutEffect(() => {
    seats.forEach((s, i) => {
      tmp.rotation.set(0, 0, 0);
      tmp.scale.setScalar(1);
      tmp.position.set(s.x + 0.02, 0.45, s.z);
      tmp.updateMatrix();
      pads.current!.setMatrixAt(i, tmp.matrix);
      tmp.position.set(s.x + 0.24, 0.75, s.z);
      tmp.updateMatrix();
      backs.current!.setMatrixAt(i, tmp.matrix);
      tmp.position.set(s.x + 0.04, 0.21, s.z);
      tmp.updateMatrix();
      stems.current!.setMatrixAt(i, tmp.matrix);
      color.set(CLOTHES[(i * 7 + s.room * 3) % CLOTHES.length]);
      torsos.current!.setColorAt(i, color);
      laps.current!.setColorAt(i, color.multiplyScalar(0.72));
    });
    for (const m of [pads, backs, stems]) m.current!.instanceMatrix.needsUpdate = true;
    torsos.current!.instanceColor!.needsUpdate = true;
    laps.current!.instanceColor!.needsUpdate = true;
  }, [seats]);

  useFrame((state, dt) => {
    const l = look.current;
    if (!l || !root.current) return;
    const open = smooth(l.focus);
    root.current.visible = open > 0.01;
    if (!root.current.visible) return;
    const f = sampleFrame('cool', useSim.getState().t, frame.current);
    // the floor is built up from the slab as the storeys above are lifted off it
    if (built.current) built.current.scale.y = Math.max(0.001, open);

    const time = state.clock.elapsedTime;
    const k = 1 - Math.exp(-dt * 7);
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i];
      const target = Math.min(1, Math.max(0, f.occ[s.room] - s.rank)) * open;
      const v = (shown.current[i] += (target - shown.current[i]) * k);
      const e = Math.max(0.0001, smooth(Math.min(1, v)));
      const lean = Math.sin(time * 0.8 + s.phase) * 0.05;
      tmp.scale.setScalar(e);
      tmp.rotation.set(0, lean, -0.08);
      tmp.position.set(s.x + 0.05, 0.5 + 0.34 * e, s.z);
      tmp.updateMatrix();
      torsos.current!.setMatrixAt(i, tmp.matrix);
      tmp.rotation.set(0, lean, 0);
      tmp.position.set(s.x + 0.01, 0.5 + 0.78 * e, s.z);
      tmp.updateMatrix();
      heads.current!.setMatrixAt(i, tmp.matrix);
      tmp.rotation.set(0, 0, Math.PI / 2);
      tmp.scale.set(e, e, e * 1.75);
      tmp.position.set(s.x - 0.17, 0.53, s.z);
      tmp.updateMatrix();
      laps.current!.setMatrixAt(i, tmp.matrix);
    }
    for (const m of [torsos, heads, laps]) m.current!.instanceMatrix.needsUpdate = true;

    // when the count in a room drops, those people get up and leave by the door
    const t = useSim.getState().t;
    const steady = Math.abs(t - lastT.current) < 4;
    lastT.current = t;
    for (let r = 0; r < 3; r++) {
      const n = Math.round(f.occ[r]);
      const before = counted.current[r];
      if (before > n && steady && open > 0.6) {
        const roomSeats = PLAN[r].seats;
        for (let rank = n; rank < Math.min(before, roomSeats.length); rank++) {
          const w = walkers.current.find((x) => !x.on);
          if (!w) break;
          w.on = true;
          w.room = r;
          w.d = -0.25 * (rank - n);
          w.pts = wayOut(r, roomSeats[rank][0], roomSeats[rank][1]);
          w.len = 0;
          for (let i = 1; i < w.pts.length; i++) w.len += Math.abs(w.pts[i][0] - w.pts[i - 1][0]) + Math.abs(w.pts[i][1] - w.pts[i - 1][1]);
          w.tone = (rank * 7 + r * 3) % CLOTHES.length;
        }
      }
      counted.current[r] = n;
    }
    let b = 0;
    const tag = (x: number, y: number, z: number, sx: number, sy: number) => {
      tmp.rotation.set(0, 0, 0);
      tmp.position.set(x, y, z);
      tmp.scale.set(sx, sy, sx);
      tmp.updateMatrix();
      boxes.current!.setMatrixAt(b++, tmp.matrix);
    };
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i];
      const e = shown.current[i];
      if (e > 0.5 && f.online[s.room]) tag(s.x, 0.74, s.z, 0.66 * e, 1.24 * e);
    }
    walkers.current.forEach((w, i) => {
      let scale = 0.0001;
      if (w.on) {
        w.d += dt * PACE;
        if (w.d >= w.len) w.on = false;
        else if (w.d >= 0) {
          let left = w.d;
          let x = w.pts[0][0];
          let z = w.pts[0][1];
          for (let k = 1; k < w.pts.length; k++) {
            const seg = Math.abs(w.pts[k][0] - w.pts[k - 1][0]) + Math.abs(w.pts[k][1] - w.pts[k - 1][1]);
            if (left <= seg) {
              const u = seg > 0 ? left / seg : 0;
              x = w.pts[k - 1][0] + (w.pts[k][0] - w.pts[k - 1][0]) * u;
              z = w.pts[k - 1][1] + (w.pts[k][1] - w.pts[k - 1][1]) * u;
              break;
            }
            left -= seg;
          }
          scale = Math.min(1, w.d / 0.5, (w.len - w.d) / 1.2) * open;
          const bob = Math.abs(Math.sin(w.d * 3.2)) * 0.05;
          tmp.rotation.set(0, 0, 0);
          tmp.scale.setScalar(Math.max(0.0001, scale));
          tmp.position.set(x, 0.86 + bob, z);
          tmp.updateMatrix();
          strollers.current!.setMatrixAt(i, tmp.matrix);
          tmp.position.set(x, 1.62 + bob, z);
          tmp.updateMatrix();
          strollerHeads.current!.setMatrixAt(i, tmp.matrix);
          strollers.current!.setColorAt(i, color.set(CLOTHES[w.tone]));
          if (scale > 0.5 && f.online[w.room]) tag(x, 0.92, z, 0.62, 1.84);
          return;
        }
      }
      tmp.scale.setScalar(0.0001);
      tmp.position.set(0, -5, 0);
      tmp.updateMatrix();
      strollers.current!.setMatrixAt(i, tmp.matrix);
      strollerHeads.current!.setMatrixAt(i, tmp.matrix);
    });
    boxes.current!.count = b;
    boxes.current!.instanceMatrix.needsUpdate = true;
    strollers.current!.instanceMatrix.needsUpdate = true;
    strollerHeads.current!.instanceMatrix.needsUpdate = true;
    if (strollers.current!.instanceColor) strollers.current!.instanceColor.needsUpdate = true;

    flow.current = damp(flow.current, f.fan, 3, dt);
    spin.current += dt * (0.3 + flow.current * 14);
    if (wheel.current) wheel.current.rotation.z = spin.current;
    const blink = 0.5 + 0.5 * Math.sin(time * 8);
    lamps.current.forEach((m, i) => m && m.color.set(f.online[i] ? '#12c79a' : blink > 0.5 ? '#ff4a36' : '#5a1a14'));

    // the coil frosts over as it works; the cabinet wears the colour of the mode
    const m = mats.current;
    m.coil?.color.set('#c98b5a').lerp(color.set('#8fd2ff'), Math.min(1, f.duty * 1.3));
    if (m.coil) m.coil.emissiveIntensity = 0.5 * Math.min(1, f.duty * 1.3);
    m.cap?.color.set(MODE_HEX[f.mode]);
    // seen through: walls and furniture thin out, the ducts turn to glass around the moving air
    const x = l.xray;
    const ghost = (mat: THREE.MeshStandardMaterial | null | undefined, full: number, thin: number) => {
      if (!mat) return;
      mat.opacity = full + (thin - full) * x;
      mat.transparent = mat.opacity < 0.995;
      mat.depthWrite = mat.opacity > 0.5;
    };
    ghost(m.solid, 1, 0.22);
    ghost(m.wood, 1, 0.2);
    ghost(m.metal, 1, 0.2);
    ghost(m.chair, 1, 0.16);
    ghost(m.duct, 1, 0.26);
    ghost(m.casing, 1, 0.3);

    heat.draw(f.occ);
    if (heatMat.current) heatMat.current.opacity = l.heat * open;
  });

  return (
    <group ref={root} position={[LIVE.x, LIVE.y + 0.09, LIVE.z]} visible={false}>
      {/* corridor floor */}
      <mesh rotation-x={-Math.PI / 2} position={[PLAN_W / 2, 0.012, (CORRIDOR.z0 + CORRIDOR.z1) / 2]} receiveShadow>
        <planeGeometry args={[PLAN_W, CORRIDOR.z1 - CORRIDOR.z0 + 0.5]} />
        <meshStandardMaterial color="#8b9199" roughness={0.75} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[PLAN_W / 2, 0.03, PLAN_D / 2]}>
        <planeGeometry args={[PLAN_W, PLAN_D]} />
        <meshBasicMaterial ref={heatMat} map={heat.texture} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>

      <group ref={built}>
        <mesh geometry={walls.solid} castShadow receiveShadow>
          <meshStandardMaterial ref={keep('solid')} color="#f7f5ef" roughness={0.9} />
        </mesh>
        <mesh geometry={walls.frame} castShadow>
          <meshStandardMaterial color="#3f4853" roughness={0.35} metalness={0.75} />
        </mesh>
        <mesh geometry={walls.leaf} castShadow>
          <meshStandardMaterial color="#9a6a41" roughness={0.55} />
        </mesh>
        <mesh geometry={walls.glass} renderOrder={1}>
          <meshStandardMaterial color="#9fcbe6" roughness={0.03} metalness={0.4} transparent opacity={0.2} depthWrite={false} envMapIntensity={2.4} />
        </mesh>

        <mesh geometry={fit.wood} castShadow receiveShadow>
          <meshStandardMaterial ref={keep('wood')} color="#b98c5c" roughness={0.5} />
        </mesh>
        <mesh geometry={fit.metal} castShadow>
          <meshStandardMaterial ref={keep('metal')} color="#4b535e" roughness={0.4} metalness={0.7} />
        </mesh>
        <mesh geometry={fit.board}>
          <meshStandardMaterial color="#ffffff" roughness={0.25} />
        </mesh>
        <mesh geometry={fit.dark} castShadow>
          <meshStandardMaterial color="#2a3345" roughness={0.6} />
        </mesh>
        <instancedMesh ref={pads} args={[undefined, undefined, seats.length]} castShadow receiveShadow>
          <boxGeometry args={[0.44, 0.06, 0.44]} />
          <meshStandardMaterial ref={keep('chair')} color="#22304a" roughness={0.8} />
        </instancedMesh>
        <instancedMesh ref={backs} args={[undefined, undefined, seats.length]} castShadow>
          <boxGeometry args={[0.05, 0.46, 0.42]} />
          <meshStandardMaterial color="#22304a" roughness={0.8} />
        </instancedMesh>
        <instancedMesh ref={stems} args={[undefined, undefined, seats.length]}>
          <cylinderGeometry args={[0.03, 0.14, 0.42, 10]} />
          <meshStandardMaterial color="#9aa2ad" roughness={0.35} metalness={0.7} />
        </instancedMesh>

        <mesh geometry={air.duct} castShadow>
          <meshStandardMaterial ref={keep('duct')} color="#b9c1ca" roughness={0.28} metalness={0.9} envMapIntensity={1.8} />
        </mesh>
        <mesh geometry={air.flange} castShadow>
          <meshStandardMaterial color="#8a939e" roughness={0.3} metalness={0.9} />
        </mesh>
        <mesh geometry={air.grille}>
          <meshStandardMaterial color="#f3f5f7" roughness={0.5} metalness={0.2} />
        </mesh>
        <mesh geometry={air.hanger}>
          <meshStandardMaterial color="#8b939e" roughness={0.4} metalness={0.8} />
        </mesh>

        <mesh geometry={ahu.casing} castShadow receiveShadow>
          <meshStandardMaterial ref={keep('casing')} color="#cfd5db" roughness={0.38} metalness={0.6} />
        </mesh>
        <mesh geometry={ahu.frame} castShadow>
          <meshStandardMaterial ref={keep('cap')} color="#9aa1ae" roughness={0.45} metalness={0.3} />
        </mesh>
        <mesh geometry={ahu.filter}>
          <meshStandardMaterial color="#f4f1e6" roughness={0.95} />
        </mesh>
        <mesh geometry={ahu.coil}>
          <meshStandardMaterial ref={keep('coil')} color="#c98b5a" emissive="#5fb8ff" emissiveIntensity={0} roughness={0.35} metalness={0.7} />
        </mesh>
        <mesh geometry={ahu.dark} castShadow>
          <meshStandardMaterial color="#27303f" roughness={0.55} metalness={0.3} />
        </mesh>
        <mesh geometry={water.cold} castShadow>
          <meshStandardMaterial color="#2f7bff" roughness={0.35} metalness={0.4} />
        </mesh>
        <mesh geometry={water.warm} castShadow>
          <meshStandardMaterial color="#ff7a59" roughness={0.35} metalness={0.4} />
        </mesh>
        {/* the fan: a centrifugal wheel you can see turning through the glazed front */}
        <group ref={wheel} position={[ahu.fan.x, ahu.fan.y, ahu.fan.z]}>
          <mesh rotation-x={Math.PI / 2}>
            <torusGeometry args={[0.46, 0.035, 10, 36]} />
            <meshStandardMaterial color="#27303f" roughness={0.4} metalness={0.6} />
          </mesh>
          <mesh rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.12, 0.12, 0.5, 18]} />
            <meshStandardMaterial color="#59647a" roughness={0.4} metalness={0.7} />
          </mesh>
          {blades.map((a) => (
            <mesh key={a} position={[Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0]} rotation-z={a + 0.7}>
              <boxGeometry args={[0.2, 0.02, 0.48]} />
              <meshStandardMaterial color="#cfd6de" roughness={0.3} metalness={0.8} />
            </mesh>
          ))}
        </group>
        <mesh position={[AHU_POS.x, AHU_POS.h / 2 + 0.07, AHU_POS.z - AHU_POS.d / 2 + 0.02]} renderOrder={1}>
          <boxGeometry args={[AHU_POS.w - 0.1, AHU_POS.h - 0.2, 0.03]} />
          <meshStandardMaterial color="#cfe8f8" roughness={0.04} transparent opacity={0.16} depthWrite={false} />
        </mesh>

        {PLAN.map((p, i) => (
          <group key={p.index} position={[p.camera[0], 0, p.camera[1]]}>
            <mesh position-y={2.62}>
              <cylinderGeometry args={[0.02, 0.02, 0.36, 8]} />
              <meshStandardMaterial color="#2a3345" roughness={0.5} />
            </mesh>
            <mesh position-y={2.4} rotation-x={Math.PI}>
              <sphereGeometry args={[0.17, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color="#1b2333" roughness={0.2} metalness={0.5} />
            </mesh>
            <mesh position-y={2.3}>
              <sphereGeometry args={[0.05, 12, 8]} />
              <meshBasicMaterial ref={(m) => void (lamps.current[i] = m)} color="#12c79a" toneMapped={false} />
            </mesh>
          </group>
        ))}
      </group>

      <instancedMesh ref={torsos} args={[undefined, undefined, seats.length]} castShadow>
        <capsuleGeometry args={[0.165, 0.34, 6, 14]} />
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={laps} args={[undefined, undefined, seats.length]} castShadow>
        <capsuleGeometry args={[0.09, 0.3, 4, 10]} />
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={strollers} args={[undefined, undefined, WALKERS]} castShadow>
        <capsuleGeometry args={[0.17, 0.9, 6, 14]} />
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={strollerHeads} args={[undefined, undefined, WALKERS]} castShadow>
        <sphereGeometry args={[0.13, 18, 14]} />
        <meshStandardMaterial color="#d9b99b" roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={boxes} args={[bracket, undefined, seats.length + WALKERS]} frustumCulled={false} renderOrder={5}>
        <meshBasicMaterial color="#00e0a4" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, seats.length]} castShadow>
        <sphereGeometry args={[0.125, 18, 14]} />
        <meshStandardMaterial color="#d9b99b" roughness={0.7} />
      </instancedMesh>

      <Airflow frame={frame} look={look} />
    </group>
  );
}

export const ROOM_TAG_Y = FLOOR_H - SLAB;
export const DUCT_LEVEL = DUCT_Y;
export const TRUNK_LINE = TRUNK_Z;
