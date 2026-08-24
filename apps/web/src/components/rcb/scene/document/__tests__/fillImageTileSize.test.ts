import { describe, expect, it } from 'vitest';
import { fillImageTileSize } from '../sceneFill';

describe('fillImageTileSize', () => {
  it('uses image natural size at 100% scale', () => {
    const tile = fillImageTileSize(900, 600, 100);
    expect(tile.w).toBe(900);
    expect(tile.h).toBe(600);
  });

  it('scales tile size with scale %', () => {
    const base = fillImageTileSize(900, 600, 100);
    const larger = fillImageTileSize(900, 600, 200);
    const smaller = fillImageTileSize(900, 600, 50);
    expect(larger.w).toBeGreaterThan(base.w);
    expect(smaller.w).toBeLessThan(base.w);
    expect(larger.w / base.w).toBeCloseTo(2, 5);
    expect(base.w / smaller.w).toBeCloseTo(2, 5);
    expect(larger.h / base.h).toBeCloseTo(2, 5);
    expect(base.h / smaller.h).toBeCloseTo(2, 5);
  });

  it('does not depend on shape box dimensions', () => {
    const fromSmall = fillImageTileSize(400, 300, 100);
    const fromLarge = fillImageTileSize(400, 300, 100);
    expect(fromSmall).toEqual(fromLarge);
  });
});
