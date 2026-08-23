/**
 * Single camera transform API for RCB (ADR 0027).
 *
 * Hot paths must use these pure functions — not DOM measurements or per-surface
 * viewBox mirrors — to map world ↔ stage-local screen space.
 *
 * Thin wrappers over `rcb/core/math.ts` so call sites share one vocabulary:
 * `worldToScreen` / `screenToWorld` / `screenDeltaToWorldDelta`.
 */
import {
  rcbCameraCssZoom,
  rcbCameraScreenOffset,
  rcbClientDeltaToScene,
  rcbClientToStageLocal,
  rcbSceneToScreen,
  rcbScreenToScene,
} from '@/components/rcb/core/math';
import type { RcbBox, RcbCamera, RcbVec } from '@/components/rcb/core/types';

export type CameraTransform = {
  camera: RcbCamera;
  /** Device pixel ratio used for pan snap (browser zoom). */
  dpr: number;
};

export function createCameraTransform(
  camera: RcbCamera,
  dpr = 1
): CameraTransform {
  return { camera, dpr: dpr > 0 ? dpr : 1 };
}

/** Effective CSS zoom written on the world layer. */
export function cameraZoom(t: CameraTransform): number {
  return rcbCameraCssZoom(t.camera);
}

/** Snapped pan offset written as CSS translate on the world layer. */
export function cameraPan(t: CameraTransform): RcbVec {
  return rcbCameraScreenOffset(t.camera, t.dpr);
}

/** SVG transform attribute for a scene root painted directly in screen space. */
export function cameraSvgTransform(t: CameraTransform): string {
  const pan = cameraPan(t);
  return `translate(${pan.x} ${pan.y}) scale(${cameraZoom(t)})`;
}

/** World (scene) → stage-local screen px. */
export function worldToScreen(
  t: CameraTransform,
  worldX: number,
  worldY: number
): RcbVec {
  return rcbSceneToScreen(t.camera, worldX, worldY, t.dpr);
}

/** Stage-local screen px → world (when the stage origin is known). */
export function stageLocalToWorld(
  t: CameraTransform,
  localX: number,
  localY: number
): RcbVec {
  const z = cameraZoom(t);
  const { x: camX, y: camY } = cameraPan(t);
  return {
    x: (localX - camX) / z,
    y: (localY - camY) / z,
  };
}

/**
 * Client (viewport) → world.
 * `viewportEl` is the unscaled stage root (`[data-rcb-canvas]`).
 */
export function screenToWorld(
  t: CameraTransform,
  viewportEl: HTMLElement,
  clientX: number,
  clientY: number
): RcbVec {
  return rcbScreenToScene(t.camera, viewportEl, clientX, clientY, t.dpr);
}

/** Client gesture delta → world delta (pass viewport scale from gesture start). */
export function screenDeltaToWorldDelta(
  t: CameraTransform,
  clientDx: number,
  clientDy: number,
  scaleX = 1,
  scaleY = 1
): RcbVec {
  return rcbClientDeltaToScene(cameraZoom(t), clientDx, clientDy, scaleX, scaleY);
}

/** Client → stage-local (pre-camera), including layout/visual scale. */
export function clientToStageLocal(
  viewportEl: HTMLElement,
  clientX: number,
  clientY: number
): RcbVec {
  const local = rcbClientToStageLocal(viewportEl, clientX, clientY);
  return { x: local.x, y: local.y };
}

/** Axis-aligned world box → stage-local screen box (ignores node rotation). */
export function worldBoxToScreen(
  t: CameraTransform,
  box: { left: number; top: number; width: number; height: number }
): RcbBox {
  const tl = worldToScreen(t, box.left, box.top);
  const z = cameraZoom(t);
  return {
    x: tl.x,
    y: tl.y,
    width: Math.max(0, box.width) * z,
    height: Math.max(0, box.height) * z,
  };
}

/**
 * Screen-space control size: keep N screen px (no `1/zoom` under an overlay
 * that is outside the world CSS scale).
 */
export function screenConstantPx(px: number): number {
  return Math.max(0, Number(px) || 0);
}

/**
 * World units that equal `screenPx` under the current zoom.
 * Only for ink still painted under the world CSS scale layer.
 */
export function screenPxToWorld(t: CameraTransform, screenPx: number): number {
  return screenPx / Math.max(0.05, cameraZoom(t));
}

/**
 * Round-trip error in screen px for a world point (regression helper).
 * Uses stage-local math only — no DOM.
 */
export function worldScreenRoundTripErrorPx(
  t: CameraTransform,
  worldX: number,
  worldY: number
): number {
  const screen = worldToScreen(t, worldX, worldY);
  const back = stageLocalToWorld(t, screen.x, screen.y);
  const again = worldToScreen(t, back.x, back.y);
  return Math.hypot(again.x - screen.x, again.y - screen.y);
}
