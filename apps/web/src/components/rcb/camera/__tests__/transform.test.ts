import { describe, expect, it } from 'vitest';
import {
  cameraPan,
  cameraSvgTransform,
  cameraZoom,
  createCameraTransform,
  screenDeltaToWorldDelta,
  screenPxToWorld,
  stageLocalToWorld,
  worldBoxToScreen,
  worldScreenRoundTripErrorPx,
  worldToScreen,
} from '../transform';
import { RCB_MAX_ZOOM, RCB_MIN_ZOOM } from '@/components/rcb/core/math';

const ZOOM_CASES = [RCB_MIN_ZOOM, 0.18, 1, 8, RCB_MAX_ZOOM] as const;

describe('CameraTransform', () => {
  it('worldToScreen matches pan snap + zoom', () => {
    const t = createCameraTransform({ x: 100.4, y: -40.7, zoom: 0.18 }, 1);
    const pan = cameraPan(t);
    const p = worldToScreen(t, 50, 80);
    expect(p.x).toBeCloseTo(50 * cameraZoom(t) + pan.x, 5);
    expect(p.y).toBeCloseTo(80 * cameraZoom(t) + pan.y, 5);
  });

  it('builds the shared SVG camera matrix from the canonical pan and zoom', () => {
    const t = createCameraTransform({ x: 100.4, y: -40.7, zoom: 0.18 }, 1);
    expect(cameraSvgTransform(t)).toBe('translate(100 -41) scale(0.18)');
  });

  it('stageLocalToWorld is the inverse of worldToScreen', () => {
    for (const zoom of ZOOM_CASES) {
      const t = createCameraTransform({ x: 120.3, y: 44.8, zoom }, 1);
      const world = { x: 220.5, y: -30.25 };
      const screen = worldToScreen(t, world.x, world.y);
      const back = stageLocalToWorld(t, screen.x, screen.y);
      expect(back.x).toBeCloseTo(world.x, 5);
      expect(back.y).toBeCloseTo(world.y, 5);
    }
  });

  it('round-trip error stays under 1 screen px across zoom range', () => {
    const samples = [
      { x: 0, y: 0 },
      { x: 1280, y: 720 },
      { x: -5000, y: 9000 },
      { x: 12.345, y: -0.678 },
    ];
    for (const zoom of ZOOM_CASES) {
      for (const dpr of [1, 2, 0.75] as const) {
        const t = createCameraTransform({ x: 80.2, y: 60.7, zoom }, dpr);
        for (const s of samples) {
          expect(worldScreenRoundTripErrorPx(t, s.x, s.y)).toBeLessThan(1);
        }
      }
    }
  });

  it('worldBoxToScreen scales size by zoom only (AABB, no rotation)', () => {
    const t = createCameraTransform({ x: 10, y: 20, zoom: 8 }, 1);
    const box = worldBoxToScreen(t, { left: 100, top: 50, width: 40, height: 20 });
    const tl = worldToScreen(t, 100, 50);
    expect(box.x).toBeCloseTo(tl.x, 5);
    expect(box.y).toBeCloseTo(tl.y, 5);
    expect(box.width).toBeCloseTo(40 * 8, 5);
    expect(box.height).toBeCloseTo(20 * 8, 5);
  });

  it('screenDeltaToWorldDelta divides by zoom (and viewport scale)', () => {
    const t = createCameraTransform({ x: 0, y: 0, zoom: 0.18 }, 1);
    expect(screenDeltaToWorldDelta(t, 18, -9)).toEqual({ x: 100, y: -50 });
    expect(screenDeltaToWorldDelta(t, 10, 20, 0.5, 0.5)).toEqual({
      x: 10 / 0.5 / 0.18,
      y: 20 / 0.5 / 0.18,
    });
  });

  it('screenPxToWorld matches 1/zoom (world-layer chrome only)', () => {
    const t = createCameraTransform({ x: 0, y: 0, zoom: 8 }, 1);
    expect(screenPxToWorld(t, 8)).toBeCloseTo(1, 5);
    expect(screenPxToWorld(t, 24)).toBeCloseTo(3, 5);
  });

  it('chrome handle stays constant in screen px when mapped at every zoom', () => {
    const HANDLE_PX = 8;
    for (const zoom of ZOOM_CASES) {
      const t = createCameraTransform({ x: 0, y: 0, zoom }, 1);
      // Overlay chrome: size is HANDLE_PX in screen space (not under CSS scale).
      const worldSize = screenPxToWorld(t, HANDLE_PX);
      const screenAgain = worldSize * cameraZoom(t);
      expect(screenAgain).toBeCloseTo(HANDLE_PX, 5);
    }
  });
});
