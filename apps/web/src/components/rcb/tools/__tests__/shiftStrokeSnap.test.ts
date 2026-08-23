import { describe, expect, it } from 'vitest';
import { snapStrokeOctant } from '@/components/rcb/tools/ShapeDrawFeature';
import { snapPenStrokeOctant } from '@/components/rcb/tools/PenDrawFeature';

describe('snapStrokeOctant', () => {
  it('passes through when Shift is up', () => {
    expect(snapStrokeOctant(0, 0, 10, 3, false)).toEqual({ x1: 10, y1: 3 });
  });

  it('locks near-horizontal to H', () => {
    const r = snapStrokeOctant(0, 0, 100, 12, true);
    expect(r.y1).toBeCloseTo(0, 5);
    expect(r.x1).toBeCloseTo(Math.hypot(100, 12), 5);
  });

  it('locks near-45° to diagonal', () => {
    const r = snapStrokeOctant(0, 0, 100, 90, true);
    expect(Math.abs(r.x1)).toBeCloseTo(Math.abs(r.y1), 5);
    expect(Math.hypot(r.x1, r.y1)).toBeCloseTo(Math.hypot(100, 90), 5);
  });

  it('locks near-vertical to V', () => {
    const r = snapStrokeOctant(10, 20, 14, 120, true);
    expect(r.x1).toBeCloseTo(10, 5);
    expect(r.y1).toBeCloseTo(20 + Math.hypot(4, 100), 5);
  });
});

describe('snapPenStrokeOctant', () => {
  it('needs a from-anchor and Shift', () => {
    expect(snapPenStrokeOctant(null, 8, 2, true)).toEqual({ x: 8, y: 2 });
    expect(snapPenStrokeOctant({ x: 0, y: 0 }, 8, 2, false)).toEqual({ x: 8, y: 2 });
  });

  it('snaps place tip to 45° from last anchor', () => {
    const tip = snapPenStrokeOctant({ x: 0, y: 0 }, 50, 48, true);
    expect(Math.abs(tip.x)).toBeCloseTo(Math.abs(tip.y), 5);
  });
});
