/**
 * Executable checks: resize vs corner-radius hit pads at any canvas zoom.
 * Hits are centered on their icons (control-box corner / radius dot).
 */
import { describe, expect, it } from 'vitest';
import {
  CHROME_HANDLE_HIT_PX,
  CHROME_HANDLE_VIS_PX,
  CHROME_RADIUS_HIT_PX,
  CHROME_RADIUS_PARK_GAP_PX,
  chromeHitScaleForBox,
  radiusHandleParkScreenPx,
  radiusHandlesFitOnScreen,
  radiusParkSceneForBox,
} from '../SelectionChrome';
import {
  boxRadiusSeatLocal,
  pathRadiusSeatAlong,
  radiusParkAlongBisector,
} from '../chrome/CornerRadiusHandlesOverlay';

type Aabb = { left: number; top: number; right: number; bottom: number };

function aabbFixed(cx: number, cy: number, half: number): Aabb {
  return {
    left: cx - half,
    top: cy - half,
    right: cx + half,
    bottom: cy + half,
  };
}

function aabbsOverlap(a: Aabb, b: Aabb): boolean {
  return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
}

function pointInAabb(x: number, y: number, box: Aabb): boolean {
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

/** Box-mode: SE resize hit (icon center) + BR radius seat (R≈0). */
function seCornerHitLayout(boxW: number, boxH: number, zoom: number, r = 0) {
  const z = Math.max(0.05, zoom);
  const inv = 1 / z;
  const hitScale = chromeHitScaleForBox(boxW, boxH, z);
  const parkScene = radiusParkSceneForBox(boxW, boxH, z);
  const seat = boxRadiusSeatLocal({ cx: 1, cy: 1 }, r, boxW, boxH, parkScene);

  const halfHit = (CHROME_HANDLE_HIT_PX * hitScale * inv) / 2;
  const resizeCx = boxW;
  const resizeCy = boxH;
  const radiusCx = seat.lx;
  const radiusCy = seat.ly;

  const radiusHalfScene = (CHROME_RADIUS_HIT_PX * hitScale * inv) / 2;
  const resizeHit = aabbFixed(resizeCx, resizeCy, halfHit);
  const radiusHit = aabbFixed(radiusCx, radiusCy, radiusHalfScene);

  const axisClearanceScene = Math.min(
    resizeHit.left - radiusHit.right,
    resizeHit.top - radiusHit.bottom
  );

  return {
    z,
    parkScene,
    resizeCx,
    resizeCy,
    radiusCx,
    radiusCy,
    resizeHit,
    radiusHit,
    overlap: aabbsOverlap(resizeHit, radiusHit),
    axisClearanceScreen: axisClearanceScene * z,
    resizeHitScreen: CHROME_HANDLE_HIT_PX * hitScale,
    radiusHitScreen: CHROME_RADIUS_HIT_PX * hitScale,
    radiusInteractive: radiusHandlesFitOnScreen(boxW, boxH, z),
  };
}

/** Path-mode: seat along fill bisector (no axis amplification). */
function sePathHitLayout(boxW: number, boxH: number, zoom: number, r = 0) {
  const z = Math.max(0.05, zoom);
  const inv = 1 / z;
  const hitScale = chromeHitScaleForBox(boxW, boxH, z);
  const parkScene = radiusParkSceneForBox(boxW, boxH, z);
  const ix = -Math.SQRT1_2;
  const iy = -Math.SQRT1_2;
  const along = pathRadiusSeatAlong(r, parkScene);

  const halfHit = (CHROME_HANDLE_HIT_PX * hitScale * inv) / 2;
  const resizeHit = aabbFixed(boxW, boxH, halfHit);
  const radiusCx = boxW + ix * along;
  const radiusCy = boxH + iy * along;
  const radiusHit = aabbFixed(radiusCx, radiusCy, (CHROME_RADIUS_HIT_PX * hitScale * inv) / 2);
  const axisClearanceScene = Math.min(
    resizeHit.left - radiusHit.right,
    resizeHit.top - radiusHit.bottom
  );

  return {
    overlap: aabbsOverlap(resizeHit, radiusHit),
    axisClearanceScreen: axisClearanceScene * z,
    radiusCx,
    radiusCy,
    along,
    resizeHit,
    radiusInteractive: radiusHandlesFitOnScreen(boxW, boxH, z),
  };
}

const ZOOMS = [0.05, 0.13, 0.25, 0.5, 1, 2, 8, 20, 49.9, 80, 90] as const;
const BOX = { w: 200, h: 150 };

describe('resize vs radius hit pads (icon-centered)', () => {
  it('hit is larger than paint; park keeps R-dot clear of resize', () => {
    expect(CHROME_HANDLE_HIT_PX).toBeGreaterThan(CHROME_HANDLE_VIS_PX);
    expect(CHROME_RADIUS_HIT_PX).toBeGreaterThanOrEqual(CHROME_HANDLE_VIS_PX);
    expect(radiusHandleParkScreenPx()).toBe(
      CHROME_HANDLE_HIT_PX / 2 + CHROME_RADIUS_HIT_PX / 2 + CHROME_RADIUS_PARK_GAP_PX
    );
  });

  it.each([...ZOOMS])(
    'hit scene size scales as screenPx/zoom at canvas zoom %s',
    (zoom) => {
      const layout = seCornerHitLayout(BOX.w, BOX.h, zoom);
      const resizeScene = layout.resizeHit.right - layout.resizeHit.left;
      expect(resizeScene * zoom).toBeCloseTo(layout.resizeHitScreen, 5);
      if (zoom >= 2) {
        expect(resizeScene).toBeLessThan(CHROME_HANDLE_HIT_PX);
      }
    }
  );

  it.each([...ZOOMS])(
    'box-mode SE resize hit does not overlap BR radius at zoom %s when interactive',
    (zoom) => {
      const layout = seCornerHitLayout(BOX.w, BOX.h, zoom, 0);
      if (!layout.radiusInteractive) {
        expect(layout.radiusInteractive).toBe(false);
        return;
      }
      expect(layout.overlap).toBe(false);
      expect(pointInAabb(layout.resizeCx, layout.resizeCy, layout.resizeHit)).toBe(true);
      expect(pointInAabb(layout.radiusCx, layout.radiusCy, layout.resizeHit)).toBe(false);
      expect(pointInAabb(layout.resizeCx, layout.resizeCy, layout.radiusHit)).toBe(false);
      const fullPark =
        Math.abs(layout.parkScene * layout.z - radiusHandleParkScreenPx()) < 0.05;
      if (fullPark) {
        expect(layout.axisClearanceScreen).toBeGreaterThanOrEqual(
          CHROME_RADIUS_PARK_GAP_PX - 0.05
        );
      } else {
        expect(layout.axisClearanceScreen).toBeGreaterThanOrEqual(-0.05);
      }
    }
  );

  it.each([...ZOOMS])(
    'path-mode bisector seat clears SE resize hit at zoom %s when interactive',
    (zoom) => {
      const layout = sePathHitLayout(BOX.w, BOX.h, zoom, 0);
      if (!layout.radiusInteractive) {
        expect(layout.radiusInteractive).toBe(false);
        return;
      }
      expect(layout.overlap).toBe(false);
      expect(layout.axisClearanceScreen).toBeGreaterThanOrEqual(-0.05);
      expect(pointInAabb(layout.radiusCx, layout.radiusCy, layout.resizeHit)).toBe(false);
    }
  );

  it('at 9000% (90×), 1 scene px of park is enough on screen', () => {
    const zoom = 90;
    const layout = seCornerHitLayout(BOX.w, BOX.h, zoom, 0);
    expect(layout.radiusInteractive).toBe(true);
    expect(layout.overlap).toBe(false);
    expect(layout.parkScene).toBeLessThan(1);
    expect(layout.parkScene * zoom).toBeCloseTo(radiusHandleParkScreenPx(), 5);
    expect(layout.axisClearanceScreen).toBeGreaterThanOrEqual(CHROME_RADIUS_PARK_GAP_PX - 0.05);
  });

  it('at 100%, fat hits still clear via park gap', () => {
    const layout = seCornerHitLayout(BOX.w, BOX.h, 1, 0);
    expect(layout.overlap).toBe(false);
    expect(layout.resizeHitScreen).toBe(CHROME_HANDLE_HIT_PX);
    expect(layout.radiusHitScreen).toBe(CHROME_RADIUS_HIT_PX);
  });

  it('at 8019% on 4×4 box, corner icon is resize territory; radius center is free of resize', () => {
    const layout = seCornerHitLayout(4, 4, 80.19, 0);
    expect(layout.radiusInteractive).toBe(true);
    expect(layout.overlap).toBe(false);
    expect(pointInAabb(layout.resizeCx, layout.resizeCy, layout.radiusHit)).toBe(false);
    expect(pointInAabb(layout.resizeCx, layout.resizeCy, layout.resizeHit)).toBe(true);
    expect(pointInAabb(layout.radiusCx, layout.radiusCy, layout.resizeHit)).toBe(false);
    expect(layout.axisClearanceScreen).toBeGreaterThanOrEqual(CHROME_RADIUS_PARK_GAP_PX - 0.05);
  });

  it('park scene distance is stable across box sizes at fixed zoom (no resize jump)', () => {
    const zoom = 1;
    const parkPx = radiusHandleParkScreenPx();
    // Min side must clear park clamp (half * 0.45 >= parkPx).
    const minSide = Math.ceil((parkPx / 0.45) * 2) + 2;
    const a = radiusParkSceneForBox(minSide, minSide, zoom, parkPx);
    const b = radiusParkSceneForBox(400, 300, zoom, parkPx);
    const c = radiusParkSceneForBox(1200, 900, zoom, parkPx);
    expect(a).toBeCloseTo(parkPx / zoom, 5);
    expect(b).toBeCloseTo(a, 5);
    expect(c).toBeCloseTo(a, 5);
  });

  it('bisector park matches axis park on 45° corners', () => {
    const park = 13;
    const along = radiusParkAlongBisector(park, -Math.SQRT1_2, -Math.SQRT1_2);
    expect(along * Math.SQRT1_2).toBeCloseTo(park, 10);
  });

  it('path seat along does not amplify for skinny bisectors', () => {
    const park = radiusParkSceneForBox(400, 300, 1);
    const seat = pathRadiusSeatAlong(0, park);
    expect(seat).toBeCloseTo(park, 5);
    // Old bug: park / min(|ix|,|iy|) with iy≈0.05 → ~20× blow-up.
    expect(seat).toBeLessThan(park * 1.01);
  });

  it('box-mode seats move toward center on both axes as R grows', () => {
    const park = radiusParkSceneForBox(400, 300, 1);
    const r = 80;
    const tl = boxRadiusSeatLocal({ cx: 0, cy: 0 }, r, 400, 300, park);
    const br = boxRadiusSeatLocal({ cx: 1, cy: 1 }, r, 400, 300, park);
    const tr = boxRadiusSeatLocal({ cx: 1, cy: 0 }, r, 400, 300, park);
    // Diagonal inset — not edge-locked (old: TL only +x, BR only -y).
    expect(tl.lx).toBeCloseTo(r, 6);
    expect(tl.ly).toBeCloseTo(r, 6);
    expect(br.lx).toBeCloseTo(400 - r, 6);
    expect(br.ly).toBeCloseTo(300 - r, 6);
    expect(tr.lx).toBeCloseTo(400 - r, 6);
    expect(tr.ly).toBeCloseTo(r, 6);
  });
});
