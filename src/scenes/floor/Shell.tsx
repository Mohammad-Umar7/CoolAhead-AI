import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Edges, Grid } from '@react-three/drei';
import { damp, type Frame } from '../../lib/frame';
import { MODEL } from '../../lib/theme';
import { BOUNDS, CORRIDOR, PLAN, PLANT, ROOMS_X1, WALL, WALL_H } from './layout';

type Box = { x0: number; x1: number; z0: number; z1: number; h: number };

const D = PLAN[0].z1;
const DOOR = 1.15;
const GLASS_H = 1.7;

/** Solid walls of the cut-away model: partitions, plant room and the corridor wall with its doors. */
function wallBoxes(): Box[] {
  const boxes: Box[] = [];
  const h = WALL_H;
  boxes.push({ x0: PLANT.x0 - WALL, x1: PLANT.x0, z0: -WALL, z1: D + WALL, h });
  boxes.push({ x0: -WALL, x1: 0, z0: 0, z1: D, h });
  for (const p of PLAN) boxes.push({ x0: p.x1, x1: p.x1 + WALL, z0: -WALL, z1: D + WALL, h });
  boxes.push({ x0: PLANT.x0, x1: 0, z0: -WALL, z1: 0, h });
  const gaps = [...PLAN.flatMap((p) => p.doors), PLANT.x1 - 1.4].sort((a, b) => a - b);
  let from = PLANT.x0;
  for (const g of gaps) {
    boxes.push({ x0: from, x1: g - DOOR / 2, z0: D, z1: D + WALL, h });
    from = g + DOOR / 2;
  }
  boxes.push({ x0: from, x1: ROOMS_X1, z0: D, z1: D + WALL, h });
  return boxes;
}

function gridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = MODEL.floor;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = MODEL.floorLine;
  g.lineWidth = 2;
  g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The rest of the storey, as faint drawing lines, so the zone reads as part of a building. */
function storeyLines() {
  const pts: number[] = [];
  const seg = (x0: number, z0: number, x1: number, z1: number) => pts.push(x0, 0.01, z0, x1, 0.01, z1);
  const X0 = PLANT.x0 - 10;
  const X1 = ROOMS_X1 + 12;
  const Z1 = CORRIDOR.z1 + 9.4;
  seg(X0, -WALL, X1, -WALL);
  seg(X1, -WALL, X1, Z1);
  seg(X1, Z1, X0, Z1);
  seg(X0, Z1, X0, -WALL);
  seg(X0, CORRIDOR.z1, X1, CORRIDOR.z1);
  seg(X0, D, PLANT.x0, D);
  seg(ROOMS_X1, D, X1, D);
  for (const x of [X0 + 5, ROOMS_X1 + 6]) seg(x, -WALL, x, D);
  for (let x = X0 + 4; x < X1 - 2; x += 7.2) seg(x, CORRIDOR.z1, x, Z1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

const sunVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const sunFragment = /* glsl */ `
  varying vec2 vUv;
  uniform float uHeat;
  uniform float uTime;
  void main() {
    // v = 1 at the glass, 0 out in the open
    float fall = pow(vUv.y, 1.6);
    float flow = smoothstep(0.42, 0.5, fract(vUv.y * 5.0 - uTime * 0.22)) * (1.0 - smoothstep(0.5, 0.58, fract(vUv.y * 5.0 - uTime * 0.22)));
    float side = smoothstep(0.0, 0.06, vUv.x) * smoothstep(0.0, 0.06, 1.0 - vUv.x);
    vec3 col = mix(vec3(1.0, 0.42, 0.14), vec3(1.0, 0.72, 0.3), vUv.y);
    float a = uHeat * side * (fall * 0.34 + flow * 0.16 * vUv.y);
    gl_FragColor = vec4(col, a);
  }
`;

export default function Shell({ ghost = 0, frame }: { ghost?: number; frame?: React.RefObject<Frame> }) {
  const walls = useMemo(wallBoxes, []);
  const grid = useMemo(gridTexture, []);
  const storey = useMemo(storeyLines, []);
  const floors = useMemo(
    () =>
      PLAN.map((p) => {
        const tex = grid.clone();
        tex.needsUpdate = true;
        tex.repeat.set(p.x1 - p.x0, p.z1 - p.z0);
        return tex;
      }),
    [grid],
  );
  const sunMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: sunVertex,
        fragmentShader: sunFragment,
        uniforms: { uHeat: { value: 0 }, uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const sun = sunMat.uniforms;
  const heat = useRef(0);

  useFrame((state, dt) => {
    const f = frame?.current;
    if (!f) return;
    // heat pressing on the glass: outdoor excess plus direct sun
    const drive = Math.min(1, Math.max(0, (f.tOut - 28) / 14) * 0.6 + f.sun * 0.55);
    heat.current = damp(heat.current, drive, 2, dt);
    sun.uHeat.value = heat.current;
    sun.uTime.value = state.clock.elapsedTime;
  });

  const wallOpacity = 1 - 0.8 * ghost;
  const span = ROOMS_X1;

  return (
    <group>
      {/* an endless drawing grid under everything */}
      <Grid
        position={[(BOUNDS.x0 + BOUNDS.x1) / 2, -0.33, (BOUNDS.z0 + BOUNDS.z1) / 2]}
        args={[10, 10]}
        infiniteGrid
        cellSize={1}
        sectionSize={5}
        cellThickness={0.5}
        sectionThickness={0.9}
        cellColor={MODEL.grid}
        sectionColor={MODEL.gridSection}
        fadeDistance={95}
        fadeStrength={1.6}
      />
      <lineSegments geometry={storey} position={[0, -0.3, 0]}>
        <lineBasicMaterial color={MODEL.storey} transparent opacity={0.3} />
      </lineSegments>

      {/* slab of the zone */}
      <mesh position={[(BOUNDS.x0 + BOUNDS.x1) / 2 - WALL / 2, -0.16, (BOUNDS.z0 + BOUNDS.z1) / 2 - WALL / 2]}>
        <boxGeometry args={[BOUNDS.x1 - BOUNDS.x0 + WALL * 3, 0.3, BOUNDS.z1 - BOUNDS.z0 + WALL * 3]} />
        <meshStandardMaterial color={MODEL.slab} roughness={0.95} />
        <Edges color={MODEL.slabEdge} threshold={30} />
      </mesh>

      {PLAN.map((p, i) => (
        <mesh key={p.index} rotation-x={-Math.PI / 2} position={[p.cx, 0, p.cz]}>
          <planeGeometry args={[p.x1 - p.x0, p.z1 - p.z0]} />
          <meshStandardMaterial map={floors[i]} roughness={0.85} metalness={0.05} />
        </mesh>
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[(PLANT.x0 + ROOMS_X1) / 2, 0, (CORRIDOR.z0 + CORRIDOR.z1) / 2]}>
        <planeGeometry args={[ROOMS_X1 - PLANT.x0, CORRIDOR.z1 - CORRIDOR.z0]} />
        <meshStandardMaterial color={MODEL.corridor} roughness={0.9} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[(PLANT.x0 + PLANT.x1) / 2, 0, D / 2]}>
        <planeGeometry args={[PLANT.x1 - PLANT.x0, D]} />
        <meshStandardMaterial color={MODEL.corridor} roughness={0.9} />
      </mesh>

      {walls.map((b, i) => (
        <mesh key={i} position={[(b.x0 + b.x1) / 2, b.h / 2, (b.z0 + b.z1) / 2]}>
          <boxGeometry args={[b.x1 - b.x0, b.h, b.z1 - b.z0]} />
          <meshStandardMaterial color={MODEL.wall} roughness={0.6} transparent={ghost > 0} opacity={wallOpacity} depthWrite={ghost === 0} />
          <Edges color={MODEL.wallEdge} threshold={20} />
        </mesh>
      ))}

      {/* glazed facade along the classrooms */}
      {PLAN.map((p) => {
        const w = p.x1 - p.x0;
        const bays = Math.round(w / 1.5);
        return (
          <group key={p.index}>
            <mesh position={[p.cx, 0.15, -WALL / 2]}>
              <boxGeometry args={[w, 0.3, WALL]} />
              <meshStandardMaterial color={MODEL.wall} roughness={0.6} />
              <Edges color={MODEL.wallEdge} threshold={20} />
            </mesh>
            <mesh position={[p.cx, 0.3 + GLASS_H / 2, -WALL / 2]}>
              <boxGeometry args={[w, GLASS_H, 0.04]} />
              <meshPhysicalMaterial color={MODEL.glass} transparent opacity={0.09} roughness={0.05} side={THREE.DoubleSide} depthWrite={false} />
              <Edges color={MODEL.glassEdge} threshold={20} />
            </mesh>
            {Array.from({ length: bays - 1 }, (_, k) => (
              <mesh key={k} position={[p.x0 + ((k + 1) * w) / bays, 0.3 + GLASS_H / 2, -WALL / 2]}>
                <boxGeometry args={[0.045, GLASS_H, 0.08]} />
                <meshStandardMaterial color={MODEL.mullion} roughness={0.5} metalness={0.4} />
              </mesh>
            ))}
          </group>
        );
      })}

      {/* outdoor heat pressing on the glass */}
      <mesh rotation-x={-Math.PI / 2} position={[span / 2, -0.29, -WALL - 3.4]} scale={[1, -1, 1]} material={sunMat}>
        <planeGeometry args={[span, 6.8]} />
      </mesh>

      {/* desks */}
      {PLAN.map((p) =>
        p.desks.map((d, k) => (
          <mesh key={`${p.index}-${k}`} position={[d.x, 0.36, d.z]}>
            <boxGeometry args={[0.34, 0.72, d.len]} />
            <meshStandardMaterial color={MODEL.desk} roughness={0.7} />
            <Edges color={MODEL.deskEdge} threshold={20} />
          </mesh>
        )),
      )}

      {/* teaching wall: a board in each room */}
      {PLAN.map((p) => (
        <mesh key={p.index} position={[p.x0 + 0.03, 0.78, p.cz - 0.6]}>
          <boxGeometry args={[0.04, 0.62, 3.4]} />
          <meshStandardMaterial color={MODEL.board} emissive={MODEL.board} emissiveIntensity={0.2} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}
