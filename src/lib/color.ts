import * as THREE from 'three';
import type { Mode } from '../engine/types';

type Stop = [number, [number, number, number]];

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Room air temperature. The comfort band (22 to 25 °C) sits in the calm middle. */
const TEMP: Stop[] = [
  [19.5, hex('#2f6bff')],
  [21.5, hex('#3fb6ff')],
  [23, hex('#6fe6e0')],
  [24.2, hex('#8df0b6')],
  [25, hex('#f3dc74')],
  [26, hex('#ffa23f')],
  [27.2, hex('#ff5a36')],
  [29, hex('#ff2d55')],
];

/** People density on the floor: nothing, then cold to white-hot. */
const HEAT: Stop[] = [
  [0, hex('#12264f')],
  [0.12, hex('#1c4f9c')],
  [0.3, hex('#1489b8')],
  [0.48, hex('#22c7a9')],
  [0.64, hex('#d9e34a')],
  [0.8, hex('#ff9a2e')],
  [0.92, hex('#ff3d2e')],
  [1, hex('#fff1e6')],
];

function ramp(stops: Stop[], v: number): [number, number, number] {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const f = (v - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f];
    }
  }
  return stops[stops.length - 1][1];
}

export const tempRgb = (t: number) => ramp(TEMP, t);
export const heatRgb = (v: number) => ramp(HEAT, v);

export const tempCss = (t: number) => {
  const [r, g, b] = tempRgb(t);
  return `rgb(${r | 0} ${g | 0} ${b | 0})`;
};

const scratch = new THREE.Color();
/** Temperature colour in linear space, for materials. */
export function tempColor(t: number, target = scratch) {
  const [r, g, b] = tempRgb(t);
  return target.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
}

function lut(stops: Stop[], from: number, to: number, alpha?: (v: number) => number) {
  const n = 256;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const [r, g, b] = ramp(stops, from + (to - from) * f);
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = alpha ? Math.round(255 * alpha(f)) : 255;
  }
  const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export const TEMP_RANGE: [number, number] = [19.5, 29];
let tempLutTex: THREE.DataTexture | null = null;
let heatLutTex: THREE.DataTexture | null = null;
export const tempLut = () => (tempLutTex ??= lut(TEMP, TEMP_RANGE[0], TEMP_RANGE[1]));
export const heatLut = () => (heatLutTex ??= lut(HEAT, 0, 1, (f) => Math.min(1, f * 3.2)));

/** CSS gradient of a ramp, for legends. */
export const cssRamp = (kind: 'temp' | 'heat', dir = 'to right') => {
  const stops = kind === 'temp' ? TEMP : HEAT;
  const a = stops[0][0];
  const b = stops[stops.length - 1][0];
  return `linear-gradient(${dir}, ${stops.map(([v, c]) => `rgb(${c.join(' ')}) ${(((v - a) / (b - a)) * 100).toFixed(1)}%`).join(', ')})`;
};

export const MODE_COLOR: Record<Mode, string> = {
  OFF: '#6b7fa6',
  STANDBY: '#8a9cc0',
  REDUCED: '#6ff0b8',
  NORMAL: '#8fe6ff',
  PRECOOL: '#c8adff',
};

export const MODE_NAME: Record<Mode, string> = {
  OFF: 'Off',
  STANDBY: 'Standby',
  REDUCED: 'Reduced',
  NORMAL: 'Normal',
  PRECOOL: 'Pre-cool',
};
