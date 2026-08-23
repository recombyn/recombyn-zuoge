/** Rotate a point in box-local space around the box center. */
export function rotateBoxLocal(
  lx: number,
  ly: number,
  w: number,
  h: number,
  angleDeg: number
): { x: number; y: number } {
  if (!angleDeg) return { x: lx, y: ly };
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = w / 2;
  const cy = h / 2;
  const dx = lx - cx;
  const dy = ly - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

export function unrotateBoxLocal(
  lx: number,
  ly: number,
  w: number,
  h: number,
  angleDeg: number
): { x: number; y: number } {
  return rotateBoxLocal(lx, ly, w, h, -angleDeg);
}

/** Map a client point into unrotated box-local scene units. */
export function clientToBoxLocal(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  w: number,
  h: number,
  angleDeg: number
): { x: number; y: number } {
  if (!(rect.width > 0) || !(rect.height > 0)) return { x: 0, y: 0 };
  const sx = ((clientX - rect.left) / rect.width) * w;
  const sy = ((clientY - rect.top) / rect.height) * h;
  return unrotateBoxLocal(sx, sy, w, h, angleDeg);
}
