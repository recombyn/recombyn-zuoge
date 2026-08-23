import { describe, expect, it } from 'vitest';
import {
  buildOutlinePath,
  outlineNodePatch,
  pathDBounds,
} from '../outlineToPath';

function arrowNode(partial?: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  angle?: number;
  borderWidth?: number;
}) {
  const borderWidth = partial?.borderWidth ?? 10;
  return {
    key: 'shape' as const,
    x: partial?.x ?? 80,
    y: partial?.y ?? 120,
    width: partial?.width ?? 140,
    height: partial?.height ?? 48,
    attrs: {
      shapeType: 'arrow',
      'border-color': '#222222',
      'border-width': borderWidth,
      'stroke-enabled': 'true',
      angle: partial?.angle ?? 0,
    },
  };
}

/** Rough path centroid from absolute M/L numbers (good enough for shift checks). */
function pathCentroid(d: string): { x: number; y: number } {
  const re = /[ML]\s*([-\d.eE]+)\s+([-\d.eE]+)/gi;
  let sx = 0;
  let sy = 0;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    sx += Number(m[1]);
    sy += Number(m[2]);
    n += 1;
  }
  return { x: sx / Math.max(1, n), y: sy / Math.max(1, n) };
}

describe('arrow outline keeps scene position', () => {
  it('does not jump to the node top-left after multi-subpath union', () => {
    const node = arrowNode();
    const outline = buildOutlinePath(node, { zoom: 1 });
    expect(outline?.pathD).toBeTruthy();

    const patch = outlineNodePatch(node, outline!);
    // Stroke is centered on midY — union AABB sits below the box top.
    // Dropping the union offset used to pin the fill at (node.x, node.y).
    expect(patch.y).toBeGreaterThan(node.y + 4);

    const localBb = pathDBounds(outline!.pathD);
    expect(localBb).toBeTruthy();
    // After fit, path local top-left is ~0; scene top = node.y + pre-fit minY.
    expect(Math.abs(localBb!.minX)).toBeLessThan(1.5);
    expect(Math.abs(localBb!.minY)).toBeLessThan(1.5);

    const worldCy = patch.y + pathCentroid(String(patch.attrs.path)).y;
    // Original shaft mid in scene: node.y + height/2
    const shaftMid = node.y + node.height / 2;
    expect(Math.abs(worldCy - shaftMid)).toBeLessThan(node.height * 0.35);
  });

  it('keeps rotated arrow silhouette near the pre-outline center', () => {
    const node = arrowNode({ angle: 35, x: 200, y: 160, width: 160, height: 36 });
    const outline = buildOutlinePath(node, { zoom: 1 });
    expect(outline?.pathD).toBeTruthy();
    expect(outline!.bakeAngle).toBe(true);

    const patch = outlineNodePatch(node, outline!);
    expect(Number((patch.attrs as { angle?: unknown }).angle) || 0).toBe(0);

    const c = pathCentroid(String(patch.attrs.path));
    const world = { x: patch.x + c.x, y: patch.y + c.y };
    const boxCx = node.x + node.width / 2;
    const boxCy = node.y + node.height / 2;
    // Union-offset bug shoved the whole ribbon toward the unrotated box corner
    // (often 40+ px). Head asymmetry keeps the centroid a bit off box center.
    expect(Math.hypot(world.x - boxCx, world.y - boxCy)).toBeLessThan(36);
  });
});
