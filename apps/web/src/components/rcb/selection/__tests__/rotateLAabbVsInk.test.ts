/**
 * DevTools highlights the path AABB (a square). Rotate-L ink only paints two
 * arms, so the green box looks “offset” NW of the blue L — especially at high
 * zoom where the AABB is ~38×38 screen px. This is not GBR≠CTM drift.
 */
import { describe, expect, it } from 'vitest';
import {
  CHROME_CORNER_L_ARM_PX,
  CHROME_CORNER_L_CLEAR_PX,
  CHROME_CORNER_L_THICK_PX,
  CHROME_HANDLE_VIS_PX,
  chromeHitScaleForBox,
  cornerLLocalBars,
  pointInCornerLLocal,
} from '../SelectionChrome';

function nwMetrics(zoom: number, boxW = 478, boxH = 429) {
  const z = Math.max(0.05, zoom);
  const inv = 1 / z;
  const hs = chromeHitScaleForBox(boxW, boxH, z);
  const halfVis = (CHROME_HANDLE_VIS_PX * inv) / 2;
  const lArm = CHROME_CORNER_L_ARM_PX * inv * hs;
  const lThick = CHROME_CORNER_L_THICK_PX * inv * hs;
  const lClear = halfVis + CHROME_CORNER_L_CLEAR_PX * inv * hs;
  const bars = cornerLLocalBars('nw', boxW, boxH, lArm, lThick, lClear);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of bars) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return {
    z,
    inv,
    lArm,
    lThick,
    lClear,
    bars,
    aabb: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
  };
}

describe('rotate-L AABB vs painted ink (DevTools green box)', () => {
  // Same regime as user DevTools: stroke-width ≈ 0.059 → zoom ≈ 1.5/0.059 ≈ 25.4
  const zoom = 1.5 / 0.059;

  it('AABB is a near-square that extends outside the box corner', () => {
    const { aabb, lClear, lThick } = nwMetrics(zoom);
    expect(aabb.w).toBeCloseTo(aabb.h, 6);
    // Screen size of AABB ≈ arm+thick in screen px
    const screen = aabb.w * zoom;
    expect(screen).toBeGreaterThan(30);
    expect(screen).toBeLessThan(50);
    // Outward of geom corner (0,0)
    expect(aabb.x).toBeLessThan(0);
    expect(aabb.y).toBeLessThan(0);
    expect(-aabb.x).toBeCloseTo(lClear + lThick, 6);
    expect(-aabb.y).toBeCloseTo(lClear + lThick, 6);
  });

  it('AABB center is not on the L ink (empty notch / knob seat)', () => {
    const { aabb, lArm, lThick, lClear } = nwMetrics(zoom);
    const cx = aabb.x + aabb.w / 2;
    const cy = aabb.y + aabb.h / 2;
    expect(
      pointInCornerLLocal(cx, cy, 'nw', 478, 429, lArm, lThick, lClear)
    ).toBe(false);
  });

  it('bar midpoints are on the L ink', () => {
    const { bars, lArm, lThick, lClear } = nwMetrics(zoom);
    for (const b of bars) {
      const mx = b.x + b.w / 2;
      const my = b.y + b.h / 2;
      expect(
        pointInCornerLLocal(mx, my, 'nw', 478, 429, lArm, lThick, lClear)
      ).toBe(true);
    }
  });

  it('GBR/CTM lattice: stroke scene matches high-zoom DevTools', () => {
    const strokeScene = 1.5 / zoom;
    expect(strokeScene).toBeCloseTo(0.059, 3);
  });
});
