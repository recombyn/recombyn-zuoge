import { describe, expect, it } from 'vitest';
import { sharpCornerSitesForNode } from '../sceneRadii';

describe('sharpCornerSitesForNode geo', () => {
  it('places an R site on every star tip and valley', () => {
    const node = {
      key: 'shape',
      width: 200,
      height: 200,
      attrs: { shapeType: 'star', sides: 5 },
    };
    const sites = sharpCornerSitesForNode(node);
    expect(sites).toBeTruthy();
    // 5 outer + 5 inner
    expect(sites!.length).toBe(10);
    for (const s of sites!) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(200);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(200);
      expect(Math.hypot(s.ix, s.iy)).toBeCloseTo(1, 5);
    }
  });

  it('places R sites on triangle verts (not AABB only)', () => {
    const node = {
      key: 'shape',
      width: 120,
      height: 100,
      attrs: { shapeType: 'triangle' },
    };
    const sites = sharpCornerSitesForNode(node);
    expect(sites?.length).toBe(3);
  });

  it('star tips park inward; valleys park into the exterior notch', () => {
    const node = {
      key: 'shape',
      width: 200,
      height: 200,
      attrs: { shapeType: 'star', sides: 5 },
    };
    const sites = sharpCornerSitesForNode(node);
    expect(sites!.length).toBe(10);
    const cx = 100;
    const cy = 100;
    const byDist = [...sites!].sort(
      (a, b) => Math.hypot(b.x - cx, b.y - cy) - Math.hypot(a.x - cx, a.y - cy)
    );
    const tip = byDist[0];
    const valley = byDist[byDist.length - 1];
    expect(Math.hypot(tip.x + tip.ix * 4 - cx, tip.y + tip.iy * 4 - cy)).toBeLessThan(
      Math.hypot(tip.x - cx, tip.y - cy)
    );
    expect(
      Math.hypot(valley.x + valley.ix * 4 - cx, valley.y + valley.iy * 4 - cy)
    ).toBeGreaterThan(Math.hypot(valley.x - cx, valley.y - cy));
  });
});
