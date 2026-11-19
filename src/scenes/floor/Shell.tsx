import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { MeshReflectorMaterial, RoundedBox } from '@react-three/drei';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROOMS } from '../../engine/config';
import { damp, type Frame } from '../../lib/frame';
import { BRAND } from '../../lib/theme';
import { BOUNDS, CORRIDOR, GLASS_H, LENGTH, NORTH, OTHER, PLAN, PLANT, SOUTH, WALL, WALL_H } from './layout';

type Box = { x0: number; x1: number; z0: number; z1: number };

const DOOR = 1.2;
const W = WALL;

/** Split a run of wall at every door. */
function withDoors(x0: number, x1: number, z0: number, z1: number, doors: number[]): Box[] {
  const out: Box[] = [];
  let from = x0;
  for (const d of doors.slice().sort((a, b) => a - b)) {
    out.push({ x0: from, x1: d - DOOR / 2, z0, z1 });
    from = d + DOOR / 2;
  }
  out.push({ x0: from, x1, z0, z1 });
  return out.filter((b) => b.x1 - b.x0 > 0.05);
}

/** Every solid wall of the cut-away model. */
function wallBoxes(): Box[] {
  const [south, hall, seminar] = PLAN;
  return [
    // outer ends: the west end is closed, the corridor opens to the east
    { x0: -W, x1: 0, z0: -W, z1: SOUTH.z1 + W },
    { x0: LENGTH, x1: LENGTH + W, z0: -W, z1: NORTH.z1 + W },
    { x0: LENGTH, x1: LENGTH + W, z0: SOUTH.z0 - W, z1: SOUTH.z1 + W },
    // partitions
    { x0: hall.x1, x1: seminar.x0, z0: 0, z1: NORTH.z1 },
    { x0: PLANT.x1, x1: south.x0, z0: SOUTH.z0, z1: SOUTH.z1 },
    { x0: south.x1, x1: OTHER.x0, z0: SOUTH.z0, z1: SOUTH.z1 },
    // corridor walls, opened at the doors
    ...withDoors(0, LENGTH, NORTH.z1, CORRIDOR.z0, [...hall.doors, ...seminar.doors]),
    ...withDoors(0, LENGTH, CORRIDOR.z1, SOUTH.z0, [PLANT.door, ...south.doors, OTHER.door]),
    // the outside wall is solid where there is no classroom behind it
    { x0: PLANT.x0, x1: PLANT.x1 + W, z0: SOUTH.z1, z1: SOUTH.z1 + W },
    { x0: OTHER.x0 - W, x1: OTHER.x1, z0: SOUTH.z1, z1: SOUTH.z1 + W },
  ];
}

function boxes(list: Box[], y0: number, y1: number, inset = 0) {
  return mergeGeometries(
    list.map((b) => {
      const g = new THREE.BoxGeometry(b.x1 - b.x0 - inset * 2, y1 - y0, b.z1 - b.z0 - inset * 2);
      g.translate((b.x0 + b.x1) / 2, (y0 + y1) / 2, (b.z0 + b.z1) / 2);
      return g;
    }),
  );
}

function floorTexture(hatch = false) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = hatch ? '#12264f' : '#1b3460';
  g.fillRect(0, 0, 256, 256);
  if (hatch) {
    g.strokeStyle = 'rgba(214, 228, 255, 0.1)';
    g.lineWidth = 6;
    for (let k = -256; k < 512; k += 64) {
      g.beginPath();
      g.moveTo(k, 256);
      g.lineTo(k + 256, 0);
      g.stroke();
    }
  } else {
    g.strokeStyle = 'rgba(214, 228, 255, 0.16)';
    g.lineWidth = 2;
    g.strokeRect(0, 0, 256, 256);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A word painted on the floor, the way a drawing labels a room. */
function decal(text: string, sub: string) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(246, 249, 255, 0.92)';
  g.font = '700 128px "Archivo Variable", Archivo, sans-serif';
  g.textBaseline = 'alphabetic';
  g.fillText(text, 8, 150);
  g.fillStyle = 'rgba(243, 208, 4, 0.95)';
  g.font = '600 46px "Geist Mono Variable", "Geist Mono", monospace';
  g.fillText(sub.toUpperCase(), 12, 222);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const flatVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
/** Hot ground outside the glazing: v = 1 at the glass, 0 out in the open. */
const heatFragment = /* glsl */ `
  varying vec2 vUv;
  uniform float uHeat;
  uniform float uTime;
  void main() {
    float fall = pow(vUv.y, 1.7);
    float wave = fract(vUv.y * 5.0 - uTime * 0.22);
    float flow = smoothstep(0.42, 0.5, wave) * (1.0 - smoothstep(0.5, 0.58, wave));
    float side = smoothstep(0.0, 0.07, vUv.x) * smoothstep(0.0, 0.07, 1.0 - vUv.x);
    vec3 col = mix(vec3(1.0, 0.36, 0.2), vec3(1.0, 0.78, 0.25), vUv.y);
    gl_FragColor = vec4(col, uHeat * side * (fall * 0.42 + flow * 0.2 * vUv.y));
  }
`;
/** Sunlight falling through the window bays onto the floor. u runs along the facade, v from glass to floor. */
const shaftFragment = /* glsl */ `
  varying vec2 vUv;
  uniform float uSun;
  uniform float uBays;
  void main() {
    float bay = abs(fract(vUv.x * uBays) - 0.5) * 2.0;
    float pane = 1.0 - smoothstep(0.62, 0.86, bay);
    float fade = pow(1.0 - vUv.y, 1.4) * smoothstep(0.0, 0.08, vUv.y);
    gl_FragColor = vec4(vec3(1.0, 0.88, 0.52), uSun * pane * fade * 0.34);
  }
`;

interface Props {
  ghost?: number;
  frame?: React.RefObject<Frame>;
  /** the mirror floor costs a second render of the scene; small views can do without */
  reflect?: boolean;
}

/**
 * The model itself, built like an architect's maquette: a navy plinth with a
 * line of gold let into it, polished floors, walls of frosted acrylic lit along
 * their top edge, and glazing that lets the afternoon sun in.
 */
export default function Shell({ ghost = 0, frame, reflect = true }: Props) {
  const geo = useMemo(() => {
    const walls = wallBoxes();
    const sills = PLAN.map((p) => ({ x0: p.x0, x1: p.x1, z0: p.side === 'north' ? -W : SOUTH.z1, z1: p.side === 'north' ? 0 : SOUTH.z1 + W }));
    return {
      walls: boxes(walls, 0, WALL_H),
      caps: boxes(walls, WALL_H, WALL_H + 0.035, 0.03),
      sills: boxes(sills, 0, 0.32),
      heads: boxes(sills, GLASS_H + 0.32, GLASS_H + 0.4),
    };
  }, []);

  const tex = useMemo(() => {
    const base = floorTexture();
    const rooms = PLAN.map((p) => {
      const t = base.clone();
      t.needsUpdate = true;
      t.repeat.set(p.x1 - p.x0, p.z1 - p.z0);
      return t;
    });
    const hatch = floorTexture(true);
    hatch.repeat.set((OTHER.x1 - OTHER.x0) / 2, (OTHER.z1 - OTHER.z0) / 2);
    return { rooms, hatch, labels: PLAN.map((p) => decal(ROOMS[p.index].id, ROOMS[p.index].name)), other: decal('A-304', 'another zone') };
  }, []);

  const mats = useMemo(
    () => ({
      // frosted acrylic: the rooms' own light shows through it
      wall: new THREE.MeshPhysicalMaterial({ color: '#a9bfe8', transparent: true, opacity: 0.34, roughness: 0.22, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.25, envMapIntensity: 0.9 }),
      cap: new THREE.MeshStandardMaterial({ color: '#cfdcf5', emissive: '#dfe9ff', emissiveIntensity: 0.62, roughness: 0.4 }),
      frame: new THREE.MeshStandardMaterial({ color: '#b9c9e6', roughness: 0.35, metalness: 0.75 }),
      glass: new THREE.MeshPhysicalMaterial({ color: '#eaf4ff', transparent: true, opacity: 0.13, roughness: 0.03, metalness: 0, envMapIntensity: 2.4, side: THREE.DoubleSide, depthWrite: false }),
      heat: [0, 1].map(
        () =>
          new THREE.ShaderMaterial({
            vertexShader: flatVertex,
            fragmentShader: heatFragment,
            uniforms: { uHeat: { value: 0 }, uTime: { value: 0 } },
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
          }),
      ),
      shaft: PLAN.map(
        (p) =>
          new THREE.ShaderMaterial({
            vertexShader: flatVertex,
            fragmentShader: shaftFragment,
            uniforms: { uSun: { value: 0 }, uBays: { value: Math.round((p.x1 - p.x0) / 1.5) } },
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
          }),
      ),
    }),
    [],
  );

  // sun shafts: a slanted sheet from the top of each window wall down to the floor inside
  const shafts = useMemo(
    () =>
      PLAN.map((p) => {
        const dir = p.side === 'north' ? 1 : -1;
        const zFloor = p.zFacade + dir * 3.4;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([p.x0, GLASS_H + 0.3, p.zFacade, p.x1, GLASS_H + 0.3, p.zFacade, p.x1, 0.03, zFloor, p.x0, 0.03, zFloor], 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
        g.setIndex([0, 1, 2, 0, 2, 3]);
        return g;
      }),
    [],
  );

  const desks = useMemo(() => PLAN.flatMap((p) => p.desks), []);
  const tops = useRef<THREE.InstancedMesh>(null);
  const fronts = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Object3D();
    desks.forEach((d, i) => {
      m.position.set(d.x, 0.74, d.z);
      m.scale.set(0.46, 0.045, d.len);
      m.updateMatrix();
      tops.current!.setMatrixAt(i, m.matrix);
      m.position.set(d.x - 0.12, 0.36, d.z);
      m.scale.set(0.05, 0.72, d.len - 0.08);
      m.updateMatrix();
      fronts.current!.setMatrixAt(i, m.matrix);
    });
    tops.current!.instanceMatrix.needsUpdate = true;
    fronts.current!.instanceMatrix.needsUpdate = true;
  }, [desks]);

  const heat = useRef(0);
  useFrame((state, dt) => {
    mats.wall.opacity = 0.34 - 0.24 * ghost;
    const f = frame?.current;
    if (!f) return;
    const drive = Math.min(1, Math.max(0, (f.tOut - 28) / 14) * 0.6 + f.sun * 0.55);
    heat.current = damp(heat.current, drive, 2, dt);
    for (const m of mats.heat) {
      m.uniforms.uHeat.value = heat.current;
      m.uniforms.uTime.value = state.clock.elapsedTime;
    }
    for (const m of mats.shaft) m.uniforms.uSun.value = damp(m.uniforms.uSun.value, f.sun, 2, dt);
  });

  const w = BOUNDS.x1 - BOUNDS.x0;
  const d = BOUNDS.z1 - BOUNDS.z0;
  const cx = (BOUNDS.x0 + BOUNDS.x1) / 2;
  const cz = (BOUNDS.z0 + BOUNDS.z1) / 2;
  const rim = 0.55;
  const inlay: [number, number, number, number][] = [
    [cx, BOUNDS.z0 - rim, w + rim * 2, 0.07],
    [cx, BOUNDS.z1 + rim, w + rim * 2, 0.07],
    [BOUNDS.x0 - rim, cz, 0.07, d + rim * 2],
    [BOUNDS.x1 + rim, cz, 0.07, d + rim * 2],
  ];

  return (
    <group>
      {/* a dark mirror for the model to stand on */}
      <mesh rotation-x={-Math.PI / 2} position={[cx, -0.62, cz]} receiveShadow>
        <planeGeometry args={[320, 320]} />
        {reflect ? (
          <MeshReflectorMaterial
            color="#16305e"
            roughness={0.85}
            metalness={0.05}
            mirror={0.45}
            mixBlur={1.2}
            mixStrength={1.15}
            blur={[420, 140]}
            resolution={1024}
            depthScale={0.6}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.3}
          />
        ) : (
          <meshStandardMaterial color="#16305e" roughness={0.7} metalness={0.05} />
        )}
      </mesh>

      {/* plinth, with a line of Liwa gold let into its top */}
      <RoundedBox args={[w + 2.6, 0.56, d + 2.6]} radius={0.2} smoothness={5} position={[cx, -0.33, cz]} receiveShadow castShadow>
        <meshPhysicalMaterial color="#10244c" roughness={0.3} metalness={0.25} clearcoat={1} clearcoatRoughness={0.18} envMapIntensity={1.4} />
      </RoundedBox>
      {inlay.map(([x, z, sx, sz], i) => (
        <mesh key={i} position={[x, -0.044, z]}>
          <boxGeometry args={[sx, 0.012, sz]} />
          <meshStandardMaterial color={BRAND.gold} emissive={BRAND.gold} emissiveIntensity={0.75} roughness={0.3} metalness={0.6} />
        </mesh>
      ))}

      {/* floors */}
      <mesh rotation-x={-Math.PI / 2} position={[cx, -0.045, cz]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#17305e" roughness={0.5} metalness={0.2} />
      </mesh>
      {PLAN.map((p, i) => (
        <mesh key={p.index} rotation-x={-Math.PI / 2} position={[p.cx, 0, p.cz]} receiveShadow>
          <planeGeometry args={[p.x1 - p.x0, p.z1 - p.z0]} />
          <meshStandardMaterial map={tex.rooms[i]} roughness={0.38} metalness={0.2} envMapIntensity={0.9} />
        </mesh>
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[LENGTH / 2, 0, (CORRIDOR.z0 + CORRIDOR.z1) / 2]} receiveShadow>
        <planeGeometry args={[LENGTH, CORRIDOR.z1 - CORRIDOR.z0]} />
        <meshStandardMaterial color="#223f74" roughness={0.36} metalness={0.25} envMapIntensity={0.8} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[(PLANT.x0 + PLANT.x1) / 2, 0, (PLANT.z0 + PLANT.z1) / 2]} receiveShadow>
        <planeGeometry args={[PLANT.x1 - PLANT.x0, PLANT.z1 - PLANT.z0]} />
        <meshStandardMaterial color="#1b3668" roughness={0.45} metalness={0.3} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[(OTHER.x0 + OTHER.x1) / 2, 0, (OTHER.z0 + OTHER.z1) / 2]} receiveShadow>
        <planeGeometry args={[OTHER.x1 - OTHER.x0, OTHER.z1 - OTHER.z0]} />
        <meshStandardMaterial map={tex.hatch} roughness={0.6} metalness={0.1} />
      </mesh>

      {/* names on the floor, by each room's door */}
      {PLAN.map((p, i) => (
        <mesh key={p.index} rotation-x={-Math.PI / 2} position={[p.x0 + 2.35, 0.012, p.zCorridor + (p.side === 'north' ? -0.75 : 0.75)]}>
          <planeGeometry args={[4, 1]} />
          <meshBasicMaterial map={tex.labels[i]} transparent opacity={0.5} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[OTHER.x0 + 2.25, 0.012, OTHER.z0 + 0.75]}>
        <planeGeometry args={[4, 1]} />
        <meshBasicMaterial map={tex.other} transparent opacity={0.28} depthWrite={false} toneMapped={false} />
      </mesh>

      {/* walls of frosted acrylic, lit along their top edge */}
      <mesh geometry={geo.walls} material={mats.wall} castShadow />
      <mesh geometry={geo.caps} material={mats.cap} />

      {/* glazed outside walls of the classrooms */}
      <mesh geometry={geo.sills} material={mats.frame} castShadow />
      <mesh geometry={geo.heads} material={mats.frame} />
      {PLAN.map((p) => {
        const z = p.side === 'north' ? -W / 2 : SOUTH.z1 + W / 2;
        const span = p.x1 - p.x0;
        const bays = Math.round(span / 1.5);
        return (
          <group key={p.index}>
            <mesh position={[p.cx, 0.32 + GLASS_H / 2, z]} material={mats.glass}>
              <boxGeometry args={[span, GLASS_H, 0.05]} />
            </mesh>
            {Array.from({ length: bays + 1 }, (_, k) => (
              <mesh key={k} position={[p.x0 + (k * span) / bays, 0.32 + GLASS_H / 2, z]} material={mats.frame}>
                <boxGeometry args={[0.05, GLASS_H, 0.1]} />
              </mesh>
            ))}
          </group>
        );
      })}

      {/* sunlight through the bays, and the hot ground outside them */}
      {shafts.map((g, i) => (
        <mesh key={i} geometry={g} material={mats.shaft[i]} renderOrder={4} />
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[LENGTH / 2, -0.03, -W - 2.6]} scale={[1, -1, 1]} material={mats.heat[0]}>
        <planeGeometry args={[LENGTH, 5.2]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[PLAN[0].cx, -0.03, SOUTH.z1 + W + 2.6]} material={mats.heat[1]}>
        <planeGeometry args={[PLAN[0].x1 - PLAN[0].x0, 5.2]} />
      </mesh>

      {/* desks: a pale top on a dark front */}
      <instancedMesh ref={tops} args={[undefined, undefined, desks.length]} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#7d93bf" roughness={0.45} metalness={0.1} />
      </instancedMesh>
      <instancedMesh ref={fronts} args={[undefined, undefined, desks.length]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#2a467c" roughness={0.5} metalness={0.2} />
      </instancedMesh>

      {/* teaching wall: a lit board in each room */}
      {PLAN.map((p) => (
        <mesh key={p.index} position={[p.x0 + 0.04, 0.86, p.cz]}>
          <boxGeometry args={[0.05, 0.78, 3.6]} />
          <meshStandardMaterial color="#dfe8f8" emissive="#eaf2ff" emissiveIntensity={0.3} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}
