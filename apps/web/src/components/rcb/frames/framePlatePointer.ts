import { frameForFullBleedPlate } from '@/components/rcb/selection/selectionLogic';
import { nodeIdsBoundToFrames } from '@/components/rcb/scene/document/sceneClipboard';
import {
  isAnimationFrameHostNode,
  isNodeHiddenInDocument,
} from '@/components/rcb/scene/document/nodeCapabilities';
import { isAnimationWorkbenchPreviewChild } from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';
import { getLiveArtboardFrameGeometry } from '@/components/rcb/frames/HtmlArtboardFrame';
import type { SceneDocument } from '@/components/rcb/sceneNode';

export type FrameSceneBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** All scene node ids (page children, else ROOT children). */
export function listContentNodeIds(doc: SceneDocument | null | undefined): string[] {
  if (!doc) return [];
  const page = doc.pages?.find((p) => p.id === doc.activePageId) || doc.pages?.[0];
  const fromPage = page?.children;
  if (Array.isArray(fromPage) && fromPage.length) {
    return fromPage.filter((id): id is string => Boolean(id));
  }
  const rootKids = doc.deltaSetLike?.ROOT?.children;
  return Array.isArray(rootKids) ? rootKids.filter((id): id is string => Boolean(id)) : [];
}

export function getFrameBox(
  doc: SceneDocument | null | undefined,
  frameId: string
): FrameSceneBox | null {
  const frame = (doc?.frames || []).find((f) => String(f?.id) === String(frameId));
  if (!frame) return null;
  const live = getLiveArtboardFrameGeometry(String(frameId));
  return {
    left: Number(live?.x ?? frame.x) || 0,
    top: Number(live?.y ?? frame.y) || 0,
    width: Math.max(1, Number(live?.width ?? frame.width) || 1),
    height: Math.max(1, Number(live?.height ?? frame.height) || 1),
  };
}

/**
 * True when this artboard has no real bound content.
 * Ownership is `attrs.frameId` only — geometric overlap from neighbors must not
 * steal empty-plate selection (full chrome / frame_move).
 */
export function frameIsEmpty(doc: SceneDocument, frameId: string): boolean {
  return !nodeIdsBoundToFrames(doc, [frameId]).some((id) => {
    const node = doc.deltaSetLike?.[id];
    if (!node || isNodeHiddenInDocument(doc, node)) return false;
    // Full-bleed background plate / Lottie host are chrome, not content.
    if (frameForFullBleedPlate(doc, id) === frameId) return false;
    if (isAnimationFrameHostNode(node, doc)) return false;
    return true;
  });
}

/** Scene-space edge band (~8 CSS px) for border picks → full frame chrome. */
export function framePlateEdgeBandScene(zoom: number): number {
  return 8 / Math.max(0.05, Number(zoom) || 1);
}

/** True when the point lies on the artboard border band (not deep interior). */
export function isPointOnFrameEdge(
  p: { x: number; y: number },
  box: FrameSceneBox,
  zoom: number
): boolean {
  const band = framePlateEdgeBandScene(zoom);
  if (
    p.x < box.left ||
    p.x > box.left + box.width ||
    p.y < box.top ||
    p.y > box.top + box.height
  ) {
    return false;
  }
  const innerLeft = box.left + band;
  const innerTop = box.top + band;
  const innerRight = box.left + box.width - band;
  const innerBottom = box.top + box.height - band;
  if (innerRight <= innerLeft || innerBottom <= innerTop) return true;
  return (
    p.x < innerLeft || p.x > innerRight || p.y < innerTop || p.y > innerBottom
  );
}

export type FramePlateDragMode = 'frame_move' | 'pointing_canvas';

/**
 * Empty plate → drag the artboard (full chrome).
 * Occupied plate → soft select / marquee only (no frame drag from interior).
 */
export function resolveFramePlateDragMode(
  doc: SceneDocument,
  frameId: string,
  opts: { readOnly?: boolean; canMove?: boolean }
): FramePlateDragMode {
  if (opts.readOnly || !opts.canMove) return 'pointing_canvas';
  if (frameIsEmpty(doc, frameId)) return 'frame_move';
  return 'pointing_canvas';
}

/**
 * Frame plate pick: pointer inside artboard, no real shape ink under cursor.
 * Full-bleed background rects count as plate, not content.
 * Preview-mode workbench children also count as plate (select workbench, not child).
 */
export function resolveFramePlateTarget(
  doc: SceneDocument,
  p: { x: number; y: number },
  hitId: string | null,
  hitTestFrame?: (x: number, y: number) => string | null
): string | null {
  const frameId = hitTestFrame?.(p.x, p.y) ?? null;
  if (!frameId) return null;
  if (!hitId) return frameId;
  if (frameForFullBleedPlate(doc, hitId) === frameId) return frameId;
  const hitNode = doc.deltaSetLike?.[hitId];
  if (
    hitNode &&
    String(hitNode.attrs?.frameId || '').trim() === frameId &&
    isAnimationWorkbenchPreviewChild(doc, hitNode)
  ) {
    return frameId;
  }
  return null;
}
