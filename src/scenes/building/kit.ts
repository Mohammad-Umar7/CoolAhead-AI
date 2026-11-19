import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** What the model is easing towards, each 0..1. */
export interface Look {
  /** opened at level three */
  focus: number;
  /** showing the people heat map */
  heat: number;
  /** seeing through to the air system */
  xray: number;
}

export const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * A bag of simple solids that become one mesh. The model is built from many
 * small parts (mullions, chair backs, duct flanges); drawing each on its own
 * would cost a draw call apiece.
 */
export class Bag {
  private parts: THREE.BufferGeometry[] = [];

  box(w: number, h: number, d: number, x: number, y: number, z: number, turn = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (turn) g.rotateY(turn);
    g.translate(x, y, z);
    this.parts.push(g);
    return this;
  }

  /** A cylinder of radius r and length len, lying along the given axis. */
  rod(r: number, len: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y', sides = 18) {
    const g = new THREE.CylinderGeometry(r, r, len, sides);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    this.parts.push(g);
    return this;
  }

  add(g: THREE.BufferGeometry) {
    this.parts.push(g);
    return this;
  }

  done() {
    return this.parts.length ? mergeGeometries(this.parts) : new THREE.BufferGeometry();
  }
}

/** A path of straight runs, as a curve a tube can follow. */
export class Polyline extends THREE.Curve<THREE.Vector3> {
  private lens: number[] = [];
  private total = 0;
  constructor(private pts: THREE.Vector3[]) {
    super();
    for (let i = 1; i < pts.length; i++) {
      const l = pts[i].distanceTo(pts[i - 1]);
      this.lens.push(l);
      this.total += l;
    }
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    let left = Math.min(1, Math.max(0, t)) * this.total;
    for (let i = 0; i < this.lens.length; i++) {
      if (left <= this.lens[i] || i === this.lens.length - 1) return target.lerpVectors(this.pts[i], this.pts[i + 1], this.lens[i] > 0 ? Math.min(1, left / this.lens[i]) : 0);
      left -= this.lens[i];
    }
    return target.copy(this.pts[this.pts.length - 1]);
  }
}

/** A linear-space colour triple from a hex string, for shader uniforms. */
export const lin = (hex: string) => {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
};
