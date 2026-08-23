import { describe, expect, it } from 'vitest';
import { STROKE_HIT, sceneHitSlop } from '../../scene/document/sceneShapes';
import { snapBoxToGrid, snapCoordToGrid } from '../alignGuides';

describe('sceneHitSlop (high-zoom blank click)', () => {
  it('at 4000% zoom, slop stays ~12 CSS px in scene units (not 12 scene units)', () => {
    const zoom = 40; // 4000%
    const pad = sceneHitSlop(zoom);
    expect(pad).toBeCloseTo(12 / 40, 6);
    // Old bug: Math.max(STROKE_HIT/2, 12/zoom) === 12 scene u ≈ 480 CSS px.
    const oldHit = Math.max(STROKE_HIT / 2, 12 / zoom);
    expect(oldHit).toBe(12);
    expect(pad * zoom).toBeLessThan(oldHit * zoom / 10);
  });

  it('click 2 grid cells outside a 1px-stroke rect is outside hit slop at zoom 40', () => {
    const zoom = 40;
    const pad = sceneHitSlop(zoom);
    const sw = 1;
    const strokeHit = sw + pad * 2; // Path2D stroke width
    // Outer ink at path + sw/2; hit extends strokeHit/2 from path.
    const hitOuter = strokeHit / 2;
    const clickGap = 2; // 2 scene cells past path edge… user marks ~2 cells past ink
    // Past outer ink by ~2: distance from path ≈ sw/2 + 2
    const distFromPath = sw / 2 + 2;
    expect(distFromPath).toBeGreaterThan(hitOuter);
    expect(pad).toBeLessThan(1);
  });
});

describe('move snap at high zoom threshold', () => {
  it('with grid on, visual-outer snap alone keeps ink on lattice (smart must not own position)', () => {
    // At tiny zoom the smart threshold is huge; production move ignores object
    // magnets and only snapBoxToGrid(visual outer).
    const moving = { left: 10.2, top: 10.4, width: 17, height: 15 };
    const next = snapBoxToGrid(moving, 1);
    expect(next.left).toBe(snapCoordToGrid(next.left, 1));
    expect(next.top).toBe(snapCoordToGrid(next.top, 1));
  });
});
