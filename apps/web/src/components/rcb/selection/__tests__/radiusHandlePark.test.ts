import { describe, expect, it } from 'vitest';
import {
  CHROME_HANDLE_HIT_PX,
  CHROME_RADIUS_HIT_PX,
  CHROME_RADIUS_PARK_GAP_PX,
  radiusHandleParkScreenPx,
} from '../SelectionChrome';
import { radiusSeatInset } from '../chrome/CornerRadiusHandlesOverlay';

describe('radiusHandleParkScreenPx', () => {
  it('parks past half-resize + half-radius when both hits are icon-centered', () => {
    const park = radiusHandleParkScreenPx();
    const resizeHalf = CHROME_HANDLE_HIT_PX / 2;
    const radiusHalf = CHROME_RADIUS_HIT_PX / 2;
    expect(park).toBe(resizeHalf + radiusHalf + CHROME_RADIUS_PARK_GAP_PX);
    expect(park - radiusHalf - resizeHalf).toBe(CHROME_RADIUS_PARK_GAP_PX);
  });

  it.each([0.5, 1, 2.247, 10, 80, 90])(
    'keeps non-overlapping hits at canvas zoom %s',
    (zoom) => {
      const parkScene = radiusHandleParkScreenPx() / zoom;
      const resizeHalf = CHROME_HANDLE_HIT_PX / 2 / zoom;
      const radiusHalf = CHROME_RADIUS_HIT_PX / 2 / zoom;
      expect((parkScene - radiusHalf - resizeHalf) * zoom).toBeCloseTo(
        CHROME_RADIUS_PARK_GAP_PX,
        5
      );
    }
  );
});

describe('radiusSeatInset', () => {
  it('parks at park when R≈0 and tracks R once past park', () => {
    const park = radiusHandleParkScreenPx();
    expect(radiusSeatInset(0, 100, park)).toBe(park);
    expect(radiusSeatInset(10, 100, park)).toBe(park);
    expect(radiusSeatInset(park + 8, 100, park)).toBe(park + 8);
  });

  it('clamps park on tiny boxes so the seat stays inside', () => {
    const half = 20;
    const seat = radiusSeatInset(0, half, 40);
    expect(seat).toBeLessThanOrEqual(half * 0.45);
    expect(seat).toBeGreaterThan(0);
  });
});
