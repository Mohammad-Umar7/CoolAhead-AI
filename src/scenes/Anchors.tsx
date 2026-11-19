import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { uiScale } from '../lib/fit';

export interface AnchorPoint {
  key: string;
  position: [number, number, number];
}

export type AnchorEls = Record<string, HTMLElement | null>;

const v = new THREE.Vector3();

/**
 * Pins ordinary DOM elements to points in the 3D scene. Labels stay crisp HTML
 * laid over the canvas; this only moves them each frame.
 */
export default function Anchors({ points, els, offset = [0, 0, 0] }: { points: AnchorPoint[]; els: React.RefObject<AnchorEls>; offset?: [number, number, number] }) {
  useFrame(({ camera, size }) => {
    const map = els.current;
    if (!map) return;
    // the canvas is measured in screen pixels, the labels live in the scaled layout
    const k = uiScale();
    for (const p of points) {
      const el = map[p.key];
      if (!el) continue;
      v.set(p.position[0] + offset[0], p.position[1] + offset[1], p.position[2] + offset[2]).project(camera);
      const behind = v.z > 1;
      const x = ((v.x * 0.5 + 0.5) * size.width) / k;
      const y = ((-v.y * 0.5 + 0.5) * size.height) / k;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      el.style.visibility = behind ? 'hidden' : 'visible';
    }
  });
  return null;
}
