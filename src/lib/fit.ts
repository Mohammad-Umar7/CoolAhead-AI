/**
 * The interface is composed like a slide. It is laid out once, for a frame of
 * 1440 x 810, and that frame is scaled as a whole to the window it is shown in,
 * so a small laptop, a projector and a wall display all get the same picture.
 * A window that is wider or taller than 16:9 gives the layout the extra room.
 */
export const FRAME = { w: 1440, h: 810 };

let k = 1;

/** How many screen pixels one layout pixel takes right now. */
export const uiScale = () => k;

export function fitToWindow() {
  const apply = () => {
    k = Math.min(window.innerWidth / FRAME.w, window.innerHeight / FRAME.h);
    k = Math.min(4, Math.max(0.2, k || 1));
    const root = document.documentElement.style;
    root.setProperty('--k', k.toFixed(4));
    root.setProperty('--k-inv', (1 / k).toFixed(5));
  };
  apply();
  window.addEventListener('resize', apply);
}

/**
 * A pointer's distance from the left edge of an element, in layout pixels.
 * `width` is the element's own width in layout pixels. Current engines report
 * client rectangles in screen pixels; older ones report them before the page
 * scale is applied, so the rectangle is checked against the known width first.
 */
export function pointerX(el: Element, clientX: number, width: number) {
  const box = el.getBoundingClientRect();
  const inScreenPixels = Math.abs(box.width - width * k) <= Math.abs(box.width - width);
  return inScreenPixels ? (clientX - box.left) / k : clientX / k - box.left;
}
