import { frameForFullBleedPlate } from '@/components/rcb/selection/selectionLogic';
import { nodeLeftTop } from '@/components/rcb/scene/paint/sceneToSvg';
import { isNodeHidden } from '@/components/rcb/scene/document/nodeCapabilities';
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
  return {
    left: Number(frame.x) || 0,
    top: Number(frame.y) || 0,
    width: Math.max(1, Number(frame.width) || 1),
    height: Math.max(1, Number(frame.height) || 1),
  };
}

function nodeOverlapsFrame(
  doc: SceneDocument,
  nodeId: string,
  frame: FrameSceneBox,
  minAreaRatio = 0.2
): boolean {
  const node = doc.deltaSetLike?.[nodeId];
  if (!node) return false;
  const { left, top } = nodeLeftTop(doc, node);
  const nw = Math.max(1, Number(node.width) || 1);
  const nh = Math.max(1, Number(node.height) || 1);
  const ow = Math.max(0, Math.min(left + nw, frame.left + frame.width) - Math.max(left, frame.left));
  const oh = Math.max(0, Math.min(top + nh, frame.top + frame.height) - Math.max(top, frame.top));
  return ow * oh >= nw * nh * minAreaRatio;
}

/** True when no node meaningfully overlaps the artboard interior. */
export function frameIsEmpty(doc: SceneDocument, frameId: string): boolean {
  const box = getFrameBox(doc, frameId);
  if (!box) return true;
  return !listContentNodeIds(doc).some((id) => {
    const node = doc.deltaSetLike?.[id];
    if (!node || isNodeHidden(node)) return false;
    if (frameForFullBleedPlate(doc, id) === frameId) return false;
    return nodeOverlapsFrame(doc, id, box);
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
  return null;
}
