import { describe, expect, it } from 'vitest';
import { orientedBoxAabb, orientedBoxVerticalExtents } from '../SelectionToolbarShell';

describe('oriented toolbar placement', () => {
  const box = { left: 100, top: 200, width: 80, height: 40 };

  it('returns axis-aligned box at 0°', () => {
    expect(orientedBoxAabb(box, 0)).toEqual(box);
    expect(orientedBoxVerticalExtents(box, 0)).toEqual({
      top: 200,
      bottom: 240,
    });
  });

  it('expands AABB at 90° for upright toolbar docking', () => {
    const aabb = orientedBoxAabb(box, 90);
    expect(aabb.width).toBeCloseTo(40, 0);
    expect(aabb.height).toBeCloseTo(80, 0);
    expect(aabb.left).toBeCloseTo(120, 0);
    expect(aabb.top).toBeCloseTo(180, 0);
    const ext = orientedBoxVerticalExtents(box, 90);
    expect(ext.top).toBeCloseTo(aabb.top, 0);
    expect(ext.bottom).toBeCloseTo(aabb.top + aabb.height, 0);
  });
});
