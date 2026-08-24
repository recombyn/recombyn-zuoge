import type { ArtboardFrame } from '@/components/rcb/frames/types';
import type { SceneDocument } from '@/components/rcb/sceneNode';

export type BBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

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
 */
export function frameForNodeIntersectPlacement(
  doc: SceneDocument,
  rect: BBox
): string | null {
  const frames = Array.isArray(doc.frames) ? doc.frames : [];
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index];
    if (!frame || frame.hidden || !boxesIntersect(rect, frameBBox(frame))) continue;
    return String(frame.id);
  }
  return null;
}

/**
 * Auto-bind after artboard drag: unowned nodes that overlap the target plate.
 * Nodes with attrs.frameId are never touched — ownership is explicit only.
 */
export function shouldBindUnownedNodeToFrame(
  node: { x?: unknown; y?: unknown; width?: unknown; height?: unknown; attrs?: Record<string, unknown> },
  frame: ArtboardFrame
): boolean {
  if (String(node.attrs?.frameId || '').trim()) return false;
  return boxesIntersect(nodeBBox(node), frameBBox(frame));
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
