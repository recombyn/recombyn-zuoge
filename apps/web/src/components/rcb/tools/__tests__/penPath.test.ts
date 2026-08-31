import { describe, expect, it } from 'vitest';
import {
  findClosestPathHit,
  flipAnchorsAroundCenter,
  insertAnchorOnPath,
  penAnchorsToD,
  rotateAnchorsAroundCenter,
  type PenAnchor,
} from '../penPath';

const rect: PenAnchor[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 80 },
  { x: 0, y: 80 },
];

describe('insertAnchorOnPath', () => {
  it('inserts an anchor on a path segment (mid-edge)', () => {
    const hit = insertAnchorOnPath(rect, true, 100, 40, 8);
    expect(hit).not.toBeNull();
    expect(hit!.anchors).toHaveLength(5);
    expect(hit!.index).toBe(2);
    expect(hit!.anchors[hit!.index].x).toBeCloseTo(100, 0);
    expect(hit!.anchors[hit!.index].y).toBeCloseTo(40, 0);
  });

  it('returns null when farther than maxDist', () => {
    expect(insertAnchorOnPath(rect, true, 200, 200, 5)).toBeNull();
  });

  it('keeps a single linked path after mid-edge insert + append', () => {
    const mid = insertAnchorOnPath(rect, true, 100, 40, 8)!;
    const next = mid.anchors.map((a) => ({ ...a }));
    next.splice(mid.index + 1, 0, { x: 140, y: 40 });
    const d = penAnchorsToD(next, true);
    expect(d.startsWith('M ')).toBe(true);
    expect(d.includes('Z')).toBe(true);
    expect(next).toHaveLength(6);
  });
});

describe('findClosestPathHit', () => {
  it('finds the closest point on the right edge', () => {
    const hit = findClosestPathHit(rect, true, 105, 40);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeCloseTo(100, 0);
    expect(hit!.y).toBeCloseTo(40, 0);
    expect(hit!.dist).toBeLessThan(10);
  });
});

describe('rotateAnchorsAroundCenter', () => {
  it('is a no-op at angle 0', () => {
    const out = rotateAnchorsAroundCenter(rect, 50, 40, 0);
    expect(out).toEqual(rect);
  });

  it('rotates a corner 90° about center so path-edit matches host angle', () => {
    // Box 100×80, center (50,40). Local TL (0,0) → after +90° → (90, -10)
    const out = rotateAnchorsAroundCenter([{ x: 0, y: 0 }], 50, 40, 90);
    expect(out[0].x).toBeCloseTo(90, 6);
    expect(out[0].y).toBeCloseTo(-10, 6);
  });

  it('rotates Bezier handles with the anchor', () => {
    const out = rotateAnchorsAroundCenter(
      [{ x: 50, y: 0, outX: 70, outY: 0, inX: 30, inY: 0 }],
      50,
      40,
      90
    );
    // (50,0)→(90,40); (70,0)→(90,60); (30,0)→(90,20)
    expect(out[0].x).toBeCloseTo(90, 6);
    expect(out[0].y).toBeCloseTo(40, 6);
    expect(out[0].outX).toBeCloseTo(90, 6);
    expect(out[0].outY).toBeCloseTo(60, 6);
    expect(out[0].inX).toBeCloseTo(90, 6);
    expect(out[0].inY).toBeCloseTo(20, 6);
  });
});

describe('flipAnchorsAroundCenter', () => {
  it('is a no-op when neither axis flips', () => {
    expect(flipAnchorsAroundCenter(rect, 50, 40, false, false)).toEqual(rect);
  });

  it('mirrors X so path-edit matches host flipX', () => {
    // Box 100×80, TL (0,0) → flipX → (100,0)
    const out = flipAnchorsAroundCenter([{ x: 0, y: 0 }], 50, 40, true, false);
    expect(out[0].x).toBeCloseTo(100, 6);
    expect(out[0].y).toBeCloseTo(0, 6);
  });

  it('mirrors Y so path-edit matches host flipY', () => {
    const out = flipAnchorsAroundCenter([{ x: 0, y: 0 }], 50, 40, false, true);
    expect(out[0].x).toBeCloseTo(0, 6);
    expect(out[0].y).toBeCloseTo(80, 6);
  });

  it('mirrors Bezier handles with the anchor', () => {
    const out = flipAnchorsAroundCenter(
      [{ x: 20, y: 40, outX: 30, outY: 40, inX: 10, inY: 40 }],
      50,
      40,
      true,
      false
    );
    expect(out[0].x).toBeCloseTo(80, 6);
    expect(out[0].outX).toBeCloseTo(70, 6);
    expect(out[0].inX).toBeCloseTo(90, 6);
  });
});
