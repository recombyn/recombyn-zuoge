import type { ArtboardFrame } from '@/components/rcb/frames/types';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import { updateNodesInDocument } from '@/components/rcb/scene/document/sceneDocument';

export type BBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Video / audio plates (incl. generators) — not valid Lottie 合成台 children. */
export function isAvMediaSceneNode(node: { key?: unknown } | null | undefined): boolean {
  const key = String(node?.key || '');
  return key === 'video' || key === 'audio';
}

/**
 * Whether a node may be bound to a given artboard.
 * Lottie 合成台 rejects AV media; normal artboards accept everything.
 */
export function canBindNodeToArtboardFrame(
  frame: ArtboardFrame | null | undefined,
  node: { key?: unknown } | null | undefined
): boolean {
  if (!frame || !node) return true;
  if (frame.kind !== 'lottie') return true;
  return !isAvMediaSceneNode(node);
}

export function nodeBBox(node: {
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
}): BBox {
  return {
    left: Number(node.x) || 0,
    top: Number(node.y) || 0,
    width: Math.max(1, Number(node.width) || 1),
    height: Math.max(1, Number(node.height) || 1),
  };
}

export function frameBBox(frame: {
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
}): BBox {
  return {
    left: Number(frame.x) || 0,
    top: Number(frame.y) || 0,
    width: Math.max(1, Number(frame.width) || 1),
    height: Math.max(1, Number(frame.height) || 1),
  };
}

export function boxesIntersect(a: BBox, b: BBox): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

/**
 * Topmost artboard whose plate intersects the node bbox (explicit placement).
 * Optional `node` skips Lottie frames that reject that media kind.
 */
export function frameForNodeIntersectPlacement(
  doc: SceneDocument,
  rect: BBox,
  node?: { key?: unknown } | null
): string | null {
  const frames = Array.isArray(doc.frames) ? doc.frames : [];
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index];
    if (!frame || frame.hidden || !boxesIntersect(rect, frameBBox(frame))) continue;
    if (!canBindNodeToArtboardFrame(frame, node)) continue;
    return String(frame.id);
  }
  return null;
}

/**
 * Auto-bind after artboard drag: unowned nodes that overlap the target plate.
 * Nodes with attrs.frameId are never touched — ownership is explicit only.
 */
export function shouldBindUnownedNodeToFrame(
  node: {
    key?: unknown;
    x?: unknown;
    y?: unknown;
    width?: unknown;
    height?: unknown;
    attrs?: Record<string, unknown>;
  },
  frame: ArtboardFrame
): boolean {
  if (String(node.attrs?.frameId || '').trim()) return false;
  if (!canBindNodeToArtboardFrame(frame, node)) return false;
  return boxesIntersect(nodeBBox(node), frameBBox(frame));
}

/**
 * Bind unowned overlapping nodes to the given artboards.
 * Used on artboard draw-commit and after artboard drag — bind + default clipContent
 * are one ownership path (clipping requires attrs.frameId).
 */
export function bindUnownedNodesToFrames(
  doc: SceneDocument,
  frameIds: string[]
): SceneDocument {
  const idSet = new Set(frameIds.map((id) => String(id || '').trim()).filter(Boolean));
  const frames = (doc.frames || []).filter((frame) => idSet.has(String(frame.id)));
  if (!frames.length) return doc;
  const patches: Array<{ nodeId: string; patch: { attrs: Record<string, unknown> } }> = [];
  const nodes = Object.values(doc.deltaSetLike || {});
  for (const node of nodes) {
    if (!node?.id || node.id === 'ROOT') continue;
    const frame = frames.find((item) => shouldBindUnownedNodeToFrame(node, item));
    if (!frame) continue;
    const siblings = nodes
      .filter((item) => String(item?.attrs?.frameId || '').trim() === String(frame.id))
      .map((item) => Number(item?.attrs?.frameOrder))
      .filter(Number.isFinite);
    patches.push({
      nodeId: String(node.id),
      patch: {
        attrs: {
          ...(node.attrs || {}),
          frameId: String(frame.id),
          frameOrder: siblings.length ? Math.max(...siblings) + 1 : 0,
        },
      },
    });
  }
  return patches.length ? updateNodesInDocument(doc, patches) : doc;
}

/**
 * Co-move while dragging artboards: bound children follow their owner only;
 * free nodes co-move when they overlap the dragged plate.
 */
export function shouldCoMoveNodeWithFrames(
  node: { attrs?: Record<string, unknown> },
  nodeRect: BBox,
  movedFrameIds: Set<string>,
  frameRect: BBox
): boolean {
  const ownerId = String(node.attrs?.frameId || '').trim();
  if (ownerId) return movedFrameIds.has(ownerId);
  return boxesIntersect(nodeRect, frameRect);
}
