import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CAMPUS, ORIGIN } from './data';
import type { IntroState } from './IntroScene';

/**
 * The ground the building stands on: real satellite imagery round the campus,
 * printed in sepia so it sits on the same paper as the rest of the app, with
 * the campus block left in full colour. Three layers of map tiles, from 3 km
 * across down to 700 m, each sharper than the one under it. It comes up with
 * the building; on the way down there is only the outline of the country.
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
}

/** Only the ground round the building: it appears with the building and nowhere else. */
const LAYERS: LayerSpec[] = [
  { z: 16, span: 2, edge: 0.3 },
  { z: 17, span: 3, edge: 0.2 },
  { z: 18, span: 2, edge: 0.2 },
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
  uniform float uEdge;
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
    // soft at the layer's edge, and fading into the paper towards the horizon
    float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float a = t.a * smoothstep(0.0, uEdge, e) * (1.0 - smoothstep(0.45 * uFar, 0.8 * uFar, distance(vWorld, cameraPosition)));
    gl_FragColor = vec4(col, a * uOn);
  }
`;

interface Layer {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  texture: THREE.CanvasTexture;
  load: () => Promise<void>;
  /** all tiles are in; the texture still has to go to the graphics card */
  ready: boolean;
  sent: boolean;
}

function makeLayer(spec: LayerSpec, order: number): Layer {
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
  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uMap: { value: texture },
      uFocus: { value: new THREE.Vector2(CAMPUS.east, -CAMPUS.north) },
      uColor: { value: 0 },
      uEdge: { value: spec.edge },
      uFar: { value: 1e6 },
      uOn: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set((east(lonOf(x0, n)) + east(lonOf(x0 + count, n))) / 2, 0, -(north(latOf(y0, n)) + north(latOf(y0 + count, n))) / 2);
  mesh.renderOrder = -10 + order;
  mesh.frustumCulled = false;

  const load = () =>
    new Promise<void>((done) => {
      let left = count * count;
      // the texture is sent to the graphics card once, when the last tile is in, not once per tile
      const finish = () => {
        if (--left > 0) return;
        texture.needsUpdate = true;
        layer.ready = true;
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
  const layer: Layer = { mesh, material, texture, load, ready: false, sent: false };
  return layer;
}

let layers: Layer[] | null = null;
/** Built once and kept, so a second visit to the intro does not download the map again. */
function ground() {
  if (!layers) {
    layers = LAYERS.map(makeLayer);
    // widest first: it is under everything else
    void layers.reduce((chain, l) => chain.then(() => l.load()), Promise.resolve());
  }
  return layers;
}

/** Start downloading the map before the intro is on screen. */
export const preloadSatellite = () => void ground();

export default function Satellite({ state }: { state: React.RefObject<IntroState> }) {
  const all = useMemo(ground, []);
  const gl = useThree((s) => s.gl);
  useFrame(({ camera }) => {
    // upload each layer as soon as it is complete, long before the building comes up, so nothing stutters then
    for (const l of all) {
      if (l.ready && !l.sent) {
        gl.initTexture(l.texture);
        l.sent = true;
        break;
      }
    }
    const s = state.current;
    if (!s) return;
    // the campus comes into colour as the camera arrives over it
    const colour = 1 - THREE.MathUtils.smoothstep(s.alt, 160, 1400);
    const on = 1 - THREE.MathUtils.smoothstep(s.alt, 1200, 4200);
    for (const l of all) {
      l.mesh.visible = on > 0.005;
      l.material.uniforms.uOn.value = on;
      l.material.uniforms.uColor.value = colour;
      l.material.uniforms.uFar.value = (camera as THREE.PerspectiveCamera).far;
    }
  });
  return (
    <group>
      {all.map((l, i) => (
        <primitive key={i} object={l.mesh} />
      ))}
    </group>
  );
}
