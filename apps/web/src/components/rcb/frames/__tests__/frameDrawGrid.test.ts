import { describe, expect, it } from 'vitest';
import {
  FRAME_PLATE_STROKE,
  FRAME_PLATE_STROKE_WIDTH,
  framePlateStrokeSceneWidth,
  resolveFrameDrawBox,
} from '../FrameDrawFeature';
import { snapCoordToGrid } from '../../selection/alignGuides';

/**
 * Artboard draw: rect-like snap/commit, but plate chrome stays artboard hairline.
 * CSS camera `scale(zoom)` thickens non-scaling-stroke — scene width must be 1/zoom.
 */
describe('frame draw (artboard) vs rect contract', () => {
  it('plate stroke stays artboard hairline (not closed-rect #333)', () => {
    // eslint-disable-next-line no-console
    console.log('[test:frame-stroke]', {
      color: FRAME_PLATE_STROKE,
      width: FRAME_PLATE_STROKE_WIDTH,
    });
    expect(FRAME_PLATE_STROKE_WIDTH).toBe(1);
    expect(FRAME_PLATE_STROKE).not.toBe('#333333');
    expect(FRAME_PLATE_STROKE.includes('color-mix')).toBe(true);
  });

  it('idle plate stroke scene width = 1/zoom (no fat border after CSS scale)', () => {
    const cases = [
      { zoom: 1, sw: 1 },
      { zoom: 10, sw: 0.1 },
      { zoom: 20, sw: 0.05 },
      { zoom: 224.7 / 100, sw: 1 / (224.7 / 100) },
    ];
    for (const c of cases) {
      const sw = framePlateStrokeSceneWidth(c.zoom);
      // eslint-disable-next-line no-console
      console.log('[test:frame-stroke-scene]', {
        zoom: c.zoom,
        sw,
        afterCssScale: sw * c.zoom,
      });
      expect(sw).toBeCloseTo(c.sw, 6);
      // After parent CSS scale(zoom), painted width ≈ 1 CSS px.
      expect(sw * c.zoom).toBeCloseTo(FRAME_PLATE_STROKE_WIDTH, 6);
    }
  });

  it('mid-cell rubber-band snaps plate fill edges onto 1px grid', () => {
    const raw = { left: 10.4, top: 20.6, width: 15.3, height: 12.2 };
    const box = resolveFrameDrawBox(raw, true, 1);
    // eslint-disable-next-line no-console
    console.log('[test:frame-grid]', { raw, box });
    expect(box.left).toBe(snapCoordToGrid(box.left, 1));
    expect(box.top).toBe(snapCoordToGrid(box.top, 1));
    expect(box.left + box.width).toBe(snapCoordToGrid(box.left + box.width, 1));
    expect(box.top + box.height).toBe(snapCoordToGrid(box.top + box.height, 1));
    expect(Number.isInteger(box.left)).toBe(true);
    expect(Number.isInteger(box.top)).toBe(true);
  });

  it('high-zoom soft drag 5×4 still commits (old 24 min rejected)', () => {
    const box = resolveFrameDrawBox(
      { left: 100.2, top: 50.7, width: 4.6, height: 3.4 },
      true,
      1
    );
    // eslint-disable-next-line no-console
    console.log('[test:frame-commit-small]', box);
    expect(box.width).toBeGreaterThanOrEqual(1);
    expect(box.height).toBeGreaterThanOrEqual(1);
    expect(box.width < 24 || box.height < 24).toBe(true);
  });

  it('Ctrl / skip grid still rounds to integer px', () => {
    const box = resolveFrameDrawBox(
      { left: 10.4, top: 20.6, width: 15.3, height: 12.2 },
      false,
      1
    );
    // eslint-disable-next-line no-console
    console.log('[test:frame-skip-grid]', box);
    expect(box).toEqual({ left: 10, top: 21, width: 15, height: 12 });
  });

  it('full flow: raw drag → snap → integer plate payload', () => {
    const raw = normalize(12.3, 8.7, 40.1, 35.4);
    const box = resolveFrameDrawBox(raw, true, 1);
    const payload = { x: box.left, y: box.top, width: box.width, height: box.height };
    // eslint-disable-next-line no-console
    console.log('[test:frame-flow]', { raw, payload });
    expect(Number.isInteger(payload.x)).toBe(true);
    expect(Number.isInteger(payload.y)).toBe(true);
    expect(Number.isInteger(payload.width)).toBe(true);
    expect(Number.isInteger(payload.height)).toBe(true);
    expect(payload.width).toBeGreaterThan(0);
    expect(payload.height).toBeGreaterThan(0);
  });
});

function normalize(x0: number, y0: number, x1: number, y1: number) {
  return {
    left: Math.min(x0, x1),
    top: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  };
}
