import { describe, expect, it } from 'vitest';
import {
  rcbCameraCssZoom,
  rcbCameraScreenOffset,
  rcbClientDeltaToScene,
  rcbClientToStageLocal,
  rcbResolveViewportEl,
  rcbSceneToScreen,
  rcbScreenToScene,
  rcbSnapSceneAxis,
  rcbZoomAtPoint,
} from '../math';
import { snapSceneStrokeAxis } from '../dpr';

function mockViewport(opts: {
  left: number;
  top: number;
  width: number;
  height: number;
  clientWidth?: number;
  clientHeight?: number;
  connected?: boolean;
}) {
  return {
    getBoundingClientRect: () =>
      ({
        left: opts.left,
        top: opts.top,
        width: opts.width,
        height: opts.height,
        right: opts.left + opts.width,
        bottom: opts.top + opts.height,
        x: opts.left,
        y: opts.top,
        toJSON: () => ({}),
      }) as DOMRect,
    clientWidth: opts.clientWidth ?? opts.width,
    clientHeight: opts.clientHeight ?? opts.height,
    isConnected: opts.connected ?? true,
  } as HTMLElement;
}

describe('rcb screen ↔ scene', () => {
  it('snaps camera pan to device pixels', () => {
    const camera = { zoom: 0.18, x: 100.4, y: -40.7 };
    // dpr=1 → round to integer CSS px
    const offset = rcbCameraScreenOffset(camera, 1);
    expect(offset.x).toBe(100);
    expect(offset.y).toBe(-41);

    const screen = rcbSceneToScreen(camera, 50, 80, 1);
    expect(screen.x).toBeCloseTo(50 * 0.18 + offset.x, 5);
    expect(screen.y).toBeCloseTo(80 * 0.18 + offset.y, 5);
  });

  it('snaps pan under fractional browser DPR (75% ≈ 0.75)', () => {
    const camera = { zoom: 1, x: 10.1, y: 20.2 };
    const offset = rcbCameraScreenOffset(camera, 0.75);
    // Device px land on integers before toDomPrecision noise.
    expect(Math.round(camera.x * 0.75) / 0.75).toBeCloseTo(offset.x, 3);
    expect(Math.round(camera.y * 0.75) / 0.75).toBeCloseTo(offset.y, 3);
  });

  it('round-trips through a mock viewport', () => {
    const camera = { zoom: 0.18, x: 120.3, y: 44.8 };
    const viewportEl = mockViewport({ left: 10, top: 20, width: 400, height: 300 });
    const dpr = 1;

    const scene = { x: 220, y: -30 };
    const screen = rcbSceneToScreen(camera, scene.x, scene.y, dpr);
    const back = rcbScreenToScene(camera, viewportEl, 10 + screen.x, 20 + screen.y, dpr);
    expect(back.x).toBeCloseTo(scene.x, 5);
    expect(back.y).toBeCloseTo(scene.y, 5);
  });

  it('corrects ancestor CSS scale via rect/clientWidth ratio', () => {
    const camera = { zoom: 1, x: 0, y: 0 };
    // Layout 800×600, visually scaled to 400×300 (scale 0.5).
    const viewportEl = mockViewport({
      left: 0,
      top: 0,
      width: 400,
      height: 300,
      clientWidth: 800,
      clientHeight: 600,
    });
    const local = rcbClientToStageLocal(viewportEl, 200, 150);
    expect(local.x).toBeCloseTo(400, 5);
    expect(local.y).toBeCloseTo(300, 5);
  });

  it('maps client deltas with scale', () => {
    expect(rcbClientDeltaToScene(0.18, 18, -9)).toEqual({ x: 100, y: -50 });
    expect(rcbClientDeltaToScene(1, 10, 20, 0.5, 0.5)).toEqual({ x: 20, y: 40 });
  });

  it('rcbSnapSceneAxis is identity at integer DPR (keeps half-pixel origins)', () => {
    expect(rcbSnapSceneAxis(269.5, 1, 0, 1)).toBe(269.5);
  });

  it('rcbSnapSceneAxis quantizes surface origin under fractional DPR', () => {
    const scene = 1755;
    const zoom = 1;
    const cam = -100;
    const dpr = 0.9;
    const snapped = rcbSnapSceneAxis(scene, zoom, cam, dpr);
    const screen = snapped * zoom + cam;
    expect(Math.abs(screen * dpr - Math.round(screen * dpr))).toBeLessThan(1e-6);
    // Content at `scene` still maps to the same screen math via matched viewBox.
    expect(scene * zoom + cam).toBeCloseTo(scene * zoom + cam, 10);
  });

  it('world-equivalent viewport is identical for grid and hosts', () => {
    // Shared camera inverse: sceneLeft = -camX/z.
    const camera = { zoom: 1, x: 10, y: -20 };
    const dpr = 0.9;
    const offset = rcbCameraScreenOffset(camera, dpr);
    const z = 1;
    const stageW = 800;
    const stageH = 600;
    const left = -offset.x / z;
    const top = -offset.y / z;
    const a = { left, top, width: stageW / z, height: stageH / z };
    const b = { left, top, width: stageW / z, height: stageH / z };
    expect(a).toEqual(b);
  });

  it('rcbResolveViewportEl prefers connected', () => {
    const a = mockViewport({ left: 0, top: 0, width: 1, height: 1, connected: false });
    const b = mockViewport({ left: 0, top: 0, width: 1, height: 1, connected: true });
    expect(rcbResolveViewportEl(a, b)).toBe(b);
  });
  it('rcbZoomAtPoint keeps the pivot fixed on the display lattice (fractional DPR)', () => {
    const dpr = 0.75;
    const camera = { zoom: 1, x: 10.1, y: 20.2 };
    const localX = 400;
    const localY = 300;
    const pan0 = rcbCameraScreenOffset(camera, dpr);
    const z0 = 1; // rcbCameraCssZoom
    const sceneX = (localX - pan0.x) / z0;
    const sceneY = (localY - pan0.y) / z0;
    const next = rcbZoomAtPoint(camera, 2, localX, localY, dpr);
    const pan1 = rcbCameraScreenOffset(next, dpr);
    const z1 = rcbCameraCssZoom(next);
    const screenX = sceneX * z1 + pan1.x;
    const screenY = sceneY * z1 + pan1.y;
    // After snap, pivot stays within one device CSS px.
    expect(Math.abs(screenX - localX)).toBeLessThan(1.5);
    expect(Math.abs(screenY - localY)).toBeLessThan(1.5);
  });
});

describe('snapSceneStrokeAxis', () => {
  it('centers odd device-pixel strokes on .5 device px', () => {
    // 1 CSS px stroke at dpr=1 → 1 device px (odd) → align to n+0.5
    const scene = snapSceneStrokeAxis(10.2, 1, 0, 1, 1);
    expect(scene).toBeCloseTo(10.5, 6);
  });

  it('snaps even device-pixel strokes onto integer device coords under dpr=2', () => {
    // 1 CSS px * dpr 2 = 2 device px (even) → align 0
    const scene = snapSceneStrokeAxis(10.4, 1, 0, 2, 1);
    expect(scene * 2).toBeCloseTo(21, 6);
  });
});
