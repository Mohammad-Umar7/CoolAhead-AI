import * as THREE from 'three';

/** Liwa University colours as the 3D scenes use them. */
export const BRAND = {
  navy: '#1b3460',
  navyDeep: '#0c1c3d',
  navyLit: '#27447c',
  gold: '#f3d004',
  goldWarm: '#e8b300',
  white: '#f6f9ff',
};

/** Materials of the cut-away model: navy massing with pale edges, so the data colours stand out. */
export const MODEL = {
  fog: '#14295a',
  slab: '#132a56',
  slabEdge: '#6f8fc8',
  floor: '#1a3566',
  floorLine: 'rgba(214, 228, 255, 0.13)',
  corridor: '#172f5c',
  wall: '#2c4b84',
  wallEdge: '#c6d8f7',
  desk: '#243f72',
  deskEdge: '#7a9ad2',
  mullion: '#5373ad',
  glass: '#d6ecff',
  glassEdge: '#a8c6f0',
  grid: '#17305e',
  gridSection: '#234174',
  storey: '#9fb9e6',
  duct: '#e2f0ff',
  ductEdge: '#b9d2f5',
  ductEdgeLit: '#ffffff',
  board: '#eef3fb',
};

let background: THREE.CanvasTexture | null = null;

/**
 * The navy field behind every 3D view: lighter where the model sits, deepening
 * to the corners, with a breath of gold from the university banner upper right.
 */
export function brandBackground() {
  if (background) return background;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 640;
  const g = c.getContext('2d')!;
  const base = g.createLinearGradient(0, 0, 0, c.height);
  base.addColorStop(0, '#1b3769');
  base.addColorStop(0.5, '#142a54');
  base.addColorStop(1, '#0a1836');
  g.fillStyle = base;
  g.fillRect(0, 0, c.width, c.height);
  const lift = g.createRadialGradient(c.width * 0.56, c.height * 0.42, 0, c.width * 0.56, c.height * 0.42, c.width * 0.6);
  lift.addColorStop(0, 'rgba(52, 92, 164, 0.42)');
  lift.addColorStop(1, 'rgba(52, 92, 164, 0)');
  g.fillStyle = lift;
  g.fillRect(0, 0, c.width, c.height);
  const gold = g.createRadialGradient(c.width * 1.02, -c.height * 0.1, 0, c.width * 1.02, -c.height * 0.1, c.width * 0.55);
  gold.addColorStop(0, 'rgba(243, 208, 4, 0.24)');
  gold.addColorStop(0.5, 'rgba(232, 179, 0, 0.07)');
  gold.addColorStop(1, 'rgba(232, 179, 0, 0)');
  g.fillStyle = gold;
  g.fillRect(0, 0, c.width, c.height);
  background = new THREE.CanvasTexture(c);
  background.colorSpace = THREE.SRGBColorSpace;
  return background;
}
