import { nodeIdsBoundToFrames } from '@/components/rcb/scene/document/sceneClipboard';
import { isAnimationArtboardKind } from '@/components/rcb/frames/types';
import { getAnimationWorkbenchTimelineFocus, canEditAnimationWorkbenchPlate } from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';

function isFlaggedAnimationHost(node: any): boolean {
  return (
    node?.key === 'lottie' &&
    (node?.attrs?.animationFrameHost === true ||
      node?.attrs?.animationFrameHost === 'true' ||
      node?.attrs?.lottieFrameHost === true ||
      node?.attrs?.lottieFrameHost === 'true')
  );
}

/** Resolve parent 动画工作台 frame id for a scene node, if any. */
export function resolveAnimationFrameId(document: any, node: any): string | null {
  const fid = String(node?.attrs?.frameId || '').trim();
  if (!fid || !document) return null;
  const frames = Array.isArray(document.frames) ? document.frames : [];
  const fr = frames.find((f: any) => String(f?.id) === fid);
  return isAnimationArtboardKind(fr?.kind) ? fid : null;
}

/** Document-space hit test for a 动画工作台 under a point (topmost wins). */
export function findAnimationFrameAtDocPoint(
  document: any,
  x: number,
  y: number
): string | null {
  if (!document || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const frames = Array.isArray(document.frames) ? document.frames : [];
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const f = frames[i];
    if (!f || !isAnimationArtboardKind(f.kind)) continue;
    const fx = Number(f.x) || 0;
    const fy = Number(f.y) || 0;
    const fw = Math.max(1, Number(f.width) || 1);
    const fh = Math.max(1, Number(f.height) || 1);
    if (x >= fx && x <= fx + fw && y >= fy && y <= fy + fh) return String(f.id);
  }
  return null;
}

/**
 * Frame id to nest an uploaded Lottie onto (selectable lot layer + precomp tab).
 * Prefer open workbench timeline; else hit-test drop point while that plate is in edit.
 */
export function resolveLottieNestFrameId(
  document: any,
  opts?: {
    timelineHostId?: string | null;
    x?: number | null;
    y?: number | null;
  }
): string | null {
  if (!document) return null;
  const hostId = String(opts?.timelineHostId || '').trim();
  if (hostId) {
    const host = document.deltaSetLike?.[hostId];
    const fromTimeline = resolveAnimationFrameId(document, host);
    if (fromTimeline && canEditAnimationWorkbenchPlate(fromTimeline)) return fromTimeline;
  }
  const focus = String(getAnimationWorkbenchTimelineFocus() || '').trim();
  if (focus && canEditAnimationWorkbenchPlate(focus)) {
    const frames = Array.isArray(document.frames) ? document.frames : [];
    const fr = frames.find((f: any) => String(f?.id) === focus);
    if (fr && isAnimationArtboardKind(fr.kind)) return focus;
  }
  const x = Number(opts?.x);
  const y = Number(opts?.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    const hit = findAnimationFrameAtDocPoint(document, x, y);
    if (hit && canEditAnimationWorkbenchPlate(hit)) return hit;
  }
  return null;
}

/** Active / selected 动画工作台, if any. Prefer open timeline focus. */
export function resolveActiveAnimationFrameId(document: any, selectedFrameIds?: string[]): string | null {
  if (!document) return null;
  const frames = Array.isArray(document.frames) ? document.frames : [];
  const focusId = String(getAnimationWorkbenchTimelineFocus() || '').trim();
  const candidates = [
    focusId,
    ...(Array.isArray(selectedFrameIds) ? selectedFrameIds : []),
    String(document.activeFrameId || '').trim(),
  ].filter(Boolean);
  for (const fid of candidates) {
    const fr = frames.find((f: any) => String(f?.id) === String(fid));
    if (fr && isAnimationArtboardKind(fr.kind)) return String(fr.id);
  }
  return null;
}

/** True when every selected scene node lives on a 动画工作台 (no canvas-root mix). */
export function isAnimationWorkbenchSelection(
  document: any,
  nodeIds: string[],
  frameIds: string[] = []
): boolean {
  if (!document || !nodeIds.length) return false;
  const frames = Array.isArray(document.frames) ? document.frames : [];
  for (const fid of frameIds) {
    const fr = frames.find((f: any) => String(f?.id) === String(fid));
    if (!fr || !isAnimationArtboardKind(fr.kind)) return false;
  }
  for (const id of nodeIds) {
    const node = document.deltaSetLike?.[id];
    if (!node || !resolveAnimationFrameId(document, node)) return false;
  }
  return true;
}

/** Playback/timeline host for a 动画工作台 — prefer flagged host over stray Lottie plates. */
export function findFrameAnimationMediaId(document: any, frameId: string): string | null {
  if (!document || !frameId) return null;
  const bound = nodeIdsBoundToFrames(document, [frameId]);
  let fallback: string | null = null;
  for (const id of bound) {
    const n = document.deltaSetLike?.[id];
    if (n?.key !== 'lottie') continue;
    if (isFlaggedAnimationHost(n)) return id;
    if (!fallback) fallback = id;
  }
  return fallback;
}

/**
 * Frame ownership for a boolean result.
 * Never use timeline focus alone — shapes outside the 动画工作台 plate must not
 * join the track or get playhead-driven transforms.
 */
export function resolveBooleanResultFrameId(
  document: any,
  operandFrameIds: string[],
  centerX: number,
  centerY: number
): string {
  const ids = (operandFrameIds || []).map((id) => String(id || '').trim()).filter(Boolean);
  const frames = Array.isArray(document?.frames) ? document.frames : [];
  const shared = ids.find((id) => ids.every((x) => x === id)) || ids[0] || '';
  const hitAnim = findAnimationFrameAtDocPoint(document, centerX, centerY);

  if (shared) {
    const fr = frames.find((f: any) => String(f?.id) === shared);
    if (!fr) return hitAnim || '';
    if (isAnimationArtboardKind(fr.kind)) {
      // Only keep 动画工作台 binding when the result center is still inside the plate.
      return hitAnim === shared ? shared : '';
    }
    // Regular artboard: keep operand ownership.
    return shared;
  }

  return hitAnim || '';
}
