import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CAMPUS, ORIGIN } from './data';
import type { IntroState } from './IntroScene';

/**
 * The ground the building stands on: real satellite imagery round the campus,
 * printed in sepia so it sits on the same paper as the rest of the app. Three
 * layers of map tiles, from 3 km across down to 700 m, each sharper than the
 * one under it. The tiles are downloaded once and shared: the intro shows them
 * with the campus in colour, the digital twin shows them washed out, so the
 * model on top of them stays the thing you look at.
 */

const R = 6371008.8;
const RAD = Math.PI / 180;
const TILE = 256;
const URL = (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

interface LayerSpec {
  z: number;
  /** tiles on each side of the campus */
  span: number;
  /** width of the soft edge, as a share of the layer */
  edge: number;
  /** the layer fades out in a ring round the campus, between these distances in metres, so no tile edge is ever seen */
  ring: [number, number];
}

const LAYERS: LayerSpec[] = [
  { z: 16, span: 3, edge: 0.02, ring: [700, 1600] },
  { z: 17, span: 3, edge: 0.02, ring: [380, 800] },
  { z: 18, span: 2, edge: 0.02, ring: [130, 270] },
];

const lonOf = (x: number, n: number) => (x / n) * 360 - 180;
const latOf = (y: number, n: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / RAD;
/** metres east and north of the map origin */
const east = (lon: number) => R * Math.cos(ORIGIN.lat * RAD) * (lon - ORIGIN.lon) * RAD;
const north = (lat: number) => R * (lat - ORIGIN.lat) * RAD;

function tileOf(z: number, lat: number, lon: number) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2) * n;
  return [Math.floor(x), Math.floor(y)];
}

const vertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  uniform sampler2D uMap;
  uniform vec2 uFocus;
  uniform float uColor;
  uniform float uWash;
  uniform float uEdge;
  uniform vec2 uRing;
  uniform float uFar;
  uniform float uOn;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    // the photograph, printed in two inks: a warm brown for the shadows, paper for the light
    float l = sqrt(dot(t.rgb, vec3(0.2126, 0.7152, 0.0722)));
    vec3 ink = vec3(0.075, 0.058, 0.036);
    vec3 paper = vec3(0.86, 0.81, 0.71);
    vec3 print = mix(ink, paper, smoothstep(0.04, 0.82, l));
    // the campus keeps its own colours
    float d = distance(vWorld.xz, uFocus);
    float keep = (1.0 - smoothstep(70.0, 190.0, d)) * uColor;
    vec3 col = mix(print, t.rgb * 1.12, keep);
    // washed towards the page, so whatever stands on the map reads first
    col = mix(col, vec3(0.9, 0.88, 0.82), uWash);
    // each layer dissolves in a wide ring round the campus, under the sharper one above it and finally into the paper
    float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float ring = 1.0 - smoothstep(uRing.x, uRing.y, d);
    ring = ring * ring * (3.0 - 2.0 * ring);
    float a = t.a * smoothstep(0.0, uEdge, e) * ring * (1.0 - smoothstep(0.45 * uFar, 0.8 * uFar, distance(vWorld, cameraPosition)));
    gl_FragColor = vec4(col, a * uOn);
  }
`;

/** One layer of tiles: its picture, where it lies, and whether all of it has arrived. */
interface Tiles {
  spec: LayerSpec;
  order: number;
  texture: THREE.CanvasTexture;
  geometry: THREE.PlaneGeometry;
  position: THREE.Vector3;
  load: () => Promise<void>;
  ready: boolean;
}

function makeTiles(spec: LayerSpec, order: number): Tiles {
  const n = 2 ** spec.z;
  const [cx, cy] = tileOf(spec.z, ORIGIN.lat, ORIGIN.lon);
  const x0 = cx - spec.span;
  const y0 = cy - spec.span;
  const count = spec.span * 2 + 1;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = count * TILE;
  const g = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  const w = east(lonOf(x0 + count, n)) - east(lonOf(x0, n));
  const h = north(latOf(y0, n)) - north(latOf(y0 + count, n));
  const geometry = new THREE.PlaneGeometry(w, h);
  geometry.rotateX(-Math.PI / 2);
  const position = new THREE.Vector3((east(lonOf(x0, n)) + east(lonOf(x0 + count, n))) / 2, 0, -(north(latOf(y0, n)) + north(latOf(y0 + count, n))) / 2);

  const tiles: Tiles = { spec, order, texture, geometry, position, load: () => Promise.resolve(), ready: false };
  tiles.load = () =>
    new Promise<void>((done) => {
      let left = count * count;
      // the texture is sent to the graphics card once, when the last tile is in, not once per tile
      const finish = () => {
        if (--left > 0) return;
        texture.needsUpdate = true;
        tiles.ready = true;
        done();
      };
      for (let j = 0; j < count; j++) {
        for (let i = 0; i < count; i++) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            g.drawImage(img, i * TILE, j * TILE);
            finish();
          };
          img.onerror = finish;
          img.src = URL(spec.z, x0 + i, y0 + j);
        }
      }
    });
  return tiles;
}

let layers: Tiles[] | null = null;
/** Downloaded once and kept, so moving between the intro and the twin does not fetch the map again. */
function ground() {
  if (!layers) {
    layers = LAYERS.map(makeTiles);
    // widest first: it is under everything else
    void layers.reduce((chain, l) => chain.then(() => l.load()), Promise.resolve());
  }
  return layers;
}

/** Start downloading the map before it is needed. */
export const preloadSatellite = () => void ground();

/** Meshes of the map for one scene, each with its own material, and the textures sent to that scene's graphics card as they arrive. */
function useMap(focus: [number, number], wash: number) {
  const all = useMemo(ground, []);
  const meshes = useMemo(
    () =>
      all.map((t) => {
        const material = new THREE.ShaderMaterial({
          vertexShader: vertex,
          fragmentShader: fragment,
          uniforms: {
            uMap: { value: t.texture },
            uFocus: { value: new THREE.Vector2(focus[0], focus[1]) },
            uColor: { value: 0 },
            uWash: { value: wash },
            uEdge: { value: t.spec.edge },
            uRing: { value: new THREE.Vector2(t.spec.ring[0], t.spec.ring[1]) },
            uFar: { value: 1e6 },
            uOn: { value: 1 },
          },
          transparent: true,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(t.geometry, material);
        mesh.position.copy(t.position);
        mesh.renderOrder = -10 + t.order;
        mesh.frustumCulled = false;
        return mesh;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all],
  );
  useEffect(() => () => meshes.forEach((m) => (m.material as THREE.Material).dispose()), [meshes]);

  const gl = useThree((s) => s.gl);
  const sent = useRef(new Set<Tiles>());
  useFrame(({ camera }) => {
    // upload each layer as soon as it is complete, one per frame, before it is ever on screen
    for (const t of all) {
      if (t.ready && !sent.current.has(t)) {
        gl.initTexture(t.texture);
        sent.current.add(t);
        break;
      }
    }
    for (const m of meshes) (m.material as THREE.ShaderMaterial).uniforms.uFar.value = (camera as THREE.PerspectiveCamera).far;
  });
  return meshes;
}

/** The intro's ground: it comes up with the building, and the campus turns to colour as the camera arrives. */
export default function Satellite({ state }: { state: React.RefObject<IntroState> }) {
  const meshes = useMap([CAMPUS.east, -CAMPUS.north], 0);
  useFrame(() => {
    const s = state.current;
    if (!s) return;
    const colour = 1 - THREE.MathUtils.smoothstep(s.alt, 160, 1400);
    const on = 1 - THREE.MathUtils.smoothstep(s.alt, 1200, 4200);
    for (const m of meshes) {
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      m.visible = on > 0.005;
      u.uOn.value = on;
      u.uColor.value = colour;
    }
  });
  return (
    <group>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}

/**
 * The same map under the digital twin: laid so the real campus block is
 * under the model, turned to the model's axes, and washed out.
 */
export function MapGround({ wash = 0.55, y = -1.4 }: { wash?: number; y?: number }) {
  const meshes = useMap([0, 0], wash);
  return (
    <group position-y={y} rotation-y={-CAMPUS.yaw}>
      <group position={[-CAMPUS.east, 0, CAMPUS.north]}>
        {meshes.map((m, i) => (
          <primitive key={i} object={m} />
        ))}
      </group>
    </group>
  );
}
