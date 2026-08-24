import { describe, expect, it } from 'vitest';
import {
  frameForNodeIntersectPlacement,
  shouldBindUnownedNodeToFrame,
  shouldCoMoveNodeWithFrames,
} from '../frameNodeBinding';
import type { SceneDocument } from '@/components/rcb/sceneNode';

const docWithFrames = (): SceneDocument =>
  ({
    frames: [
      { id: 'a', x: 0, y: 0, width: 200, height: 200, backgroundColor: '#fff' },
      { id: 'b', x: 210, y: 0, width: 200, height: 200, backgroundColor: '#fff' },
    ],
    deltaSetLike: {},
  }) as SceneDocument;

describe('frameNodeBinding', () => {
  it('binds unowned nodes on bbox overlap', () => {
    const doc = docWithFrames();
    const edgeOverlap = { x: 180, y: 80, width: 40, height: 40, attrs: {} };
    expect(shouldBindUnownedNodeToFrame(edgeOverlap, doc.frames![1])).toBe(true);
  });

  it('never binds nodes that already have frameId', () => {
    const doc = docWithFrames();
    const owned = { x: 250, y: 80, width: 40, height: 40, attrs: { frameId: 'a' } };
    expect(shouldBindUnownedNodeToFrame(owned, doc.frames![1])).toBe(false);
  });

  it('frameForNodeIntersectPlacement picks topmost overlapping plate', () => {
    const doc = docWithFrames();
    expect(
      frameForNodeIntersectPlacement(doc, { left: 180, top: 80, width: 40, height: 40 })
    ).toBe('b');
    expect(
      frameForNodeIntersectPlacement(doc, { left: 50, top: 80, width: 40, height: 40 })
    ).toBe('a');
  });

  it('does not co-move children bound to another artboard', () => {
    const moved = new Set(['b']);
    const child = { attrs: { frameId: 'a' } };
    const rect = { left: 180, top: 80, width: 40, height: 40 };
    const frameB = { left: 210, top: 0, width: 200, height: 200 };
    expect(shouldCoMoveNodeWithFrames(child, rect, moved, frameB)).toBe(false);
  });

  it('co-moves unowned nodes that overlap the dragged plate', () => {
    const moved = new Set(['b']);
    const free = { attrs: {} };
    const rect = { left: 180, top: 80, width: 40, height: 40 };
    const frameB = { left: 210, top: 0, width: 200, height: 200 };
    expect(shouldCoMoveNodeWithFrames(free, rect, moved, frameB)).toBe(true);
  });
});
