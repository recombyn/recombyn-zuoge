import { describe, expect, it } from 'vitest';
import {
  SMART_SNAP_PX,
  SMART_SNAP_MAX_SCENE,
  GUIDE_COINCIDE_EPS,
  smartSnapThreshold,
  snapBoxToGrid,
  collectMoveSnapIndicators,
  collectSmartGuidesAt,
} from '../alignGuides';
import {
  CHROME_HANDLE_HIT_PX,
  CHROME_RADIUS_HIT_PX,
  CHROME_RADIUS_PARK_GAP_PX,
  chromeHitScaleForBox,
  radiusHandleParkScreenPx,
  radiusHandlesFitOnScreen,
  radiusParkSceneForBox,
} from '../SelectionChrome';
import { DRAG_DISTANCE_SQUARED, DRAG_SCREEN_PX, isMotionlessClick } from '../selectionLogic';

/** Canvas zooms from floor → extreme (includes user repro ~31%). */
const CANVAS_ZOOMS = [0.05, 0.13, 0.25, 0.31, 0.5, 0.8, 1, 2, 8, 20, 40, 80] as const;

describe('move follows pointer (grid only, no travel gate)', () => {
  it('any positive screen travel is a drag; only 0 is a click', () => {
    expect(isMotionlessClick(0)).toBe(true);
    expect(isMotionlessClick(0.25)).toBe(false);
    expect(isMotionlessClick(1)).toBe(false);
    expect(DRAG_SCREEN_PX).toBe(1);
    expect(DRAG_DISTANCE_SQUARED).toBe(1);
  });
});

describe('smartSnapThreshold @ all canvas zooms (guide proximity, no magnets)', () => {
  it.each([...CANVAS_ZOOMS])('is screen-constant (px/zoom) at zoom %s', (zoom) => {
    const threshold = smartSnapThreshold(zoom);
    expect(threshold).toBeCloseTo(Math.min(SMART_SNAP_PX / zoom, SMART_SNAP_MAX_SCENE), 6);
  });

  it.each([0.13, 0.25, 0.31, 0.5, 1])(
    'move and inspect show gap badges when elements are separated at zoom %s',
    (zoom) => {
      const left = { left: 0, top: 0, width: 100, height: 80 };
      const right = { left: 140, top: 10, width: 100, height: 80 };
      const guides = collectSmartGuidesAt(right, [left], GUIDE_COINCIDE_EPS);
      const gaps = guides.filter((g) => g.kind === 'gap');
      expect(gaps.length).toBeGreaterThan(0);
      expect(gaps.some((g) => g.kind === 'gap' && g.dist === 40)).toBe(true);
      expect(guides.some((g) => g.kind === 'align')).toBe(false);
      const moveIndicators = collectMoveSnapIndicators(right, [left], GUIDE_COINCIDE_EPS);
      expect(moveIndicators.some((g) => g.kind === 'gap' && g.dist === 40)).toBe(true);
      void zoom;
    }
  );

  it('at 31% zoom move paints near-align guides without claiming distant edges', () => {
    const zoom = 0.31;
    const threshold = smartSnapThreshold(zoom);
    expect(threshold).toBeCloseTo(Math.min(SMART_SNAP_PX / zoom, SMART_SNAP_MAX_SCENE), 6);
    const left = { left: 0, top: 0, width: 100, height: 80 };
    const gap = Math.max(1, Math.floor(threshold * 0.5));
    const right = {
      left: left.left + left.width + gap,
      top: 6,
      width: 100,
      height: 80,
    };

    expect(collectMoveSnapIndicators(right, [left], GUIDE_COINCIDE_EPS).some((g) => g.kind === 'align')).toBe(
      false
    );

    // Production drag paints with screen-constant threshold (still no magnets).
    const nearPaint = collectMoveSnapIndicators(right, [left], Math.max(0.51, threshold));
    expect(nearPaint.some((g) => g.kind === 'align' && g.axis === 'x')).toBe(true);
    expect(nearPaint.some((g) => g.kind === 'align' && g.axis === 'x' && g.at === 100)).toBe(true);
  });

  it('near-align probe must not clear guides (old stillAligned bug)', () => {
    const left = { left: 0, top: 0, width: 100, height: 80 };
    const right = { left: 100.3, top: 0, width: 100, height: 80 };
    const guides = collectSmartGuidesAt(snapBoxToGrid(right, 1), [left], 8);
    expect(guides.some((g) => g.kind === 'gap' || g.kind === 'align')).toBe(true);
  });
});

describe('radius park + chrome hits @ all canvas zooms', () => {
  const box = { w: 200, h: 150 };

  it.each([...CANVAS_ZOOMS])(
    'keeps park near the corner (<=45% half-side) at zoom %s',
    (zoom) => {
      const park = radiusParkSceneForBox(box.w, box.h, zoom);
      const half = Math.min(box.w, box.h) / 2;
      expect(park).toBeGreaterThanOrEqual(0);
      expect(park).toBeLessThanOrEqual(half * 0.45 + 1e-9);
      const parkPx = radiusHandleParkScreenPx();
      const unclamped = parkPx / zoom;
      if (unclamped <= half * 0.45) {
        expect(park * zoom).toBeCloseTo(parkPx, 5);
      }
    }
  );

  it.each([...CANVAS_ZOOMS])(
    'park clears scaled resize/radius hits when radius is interactive at zoom %s',
    (zoom) => {
      if (!radiusHandlesFitOnScreen(box.w, box.h, zoom)) return;
      const parkPx = radiusHandleParkScreenPx();
      const parkScene = radiusParkSceneForBox(box.w, box.h, zoom, parkPx);
      const half = Math.min(box.w, box.h) / 2;
      const expectedScene = Math.min(parkPx / zoom, half * 0.45);
      expect(parkScene).toBeCloseTo(expectedScene, 5);
      const hitScale = chromeHitScaleForBox(box.w, box.h, zoom);
      const resizeHalf = (CHROME_HANDLE_HIT_PX * hitScale) / 2 / zoom;
      const radiusHalf = (CHROME_RADIUS_HIT_PX * hitScale) / 2 / zoom;
      const clearance = parkScene - resizeHalf - radiusHalf;
      if (expectedScene >= parkPx / zoom - 1e-6) {
        expect(clearance * zoom).toBeGreaterThanOrEqual(CHROME_RADIUS_PARK_GAP_PX - 0.05);
      } else {
        expect(clearance).toBeGreaterThanOrEqual(0);
      }
    }
  );

  it.each([...CANVAS_ZOOMS])(
    'hit scale follows on-screen size at zoom %s',
    (zoom) => {
      const scale = chromeHitScaleForBox(box.w, box.h, zoom);
      const minScreen = Math.min(box.w, box.h) * zoom;
      if (minScreen >= 56) expect(scale).toBe(1);
      else {
        expect(scale).toBeLessThan(1);
        expect(scale).toBeGreaterThanOrEqual(0.35);
      }
    }
  );

  it('disables radius hits only when on-screen box is too small (any zoom)', () => {
    expect(radiusHandlesFitOnScreen(8, 8, 1)).toBe(false);
    expect(radiusHandlesFitOnScreen(200, 150, 1)).toBe(true);
  });
});
