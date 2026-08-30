import { describe, expect, it } from 'vitest';
import {
  frameIsEmpty,
  framePlateEdgeBandScene,
  getFrameBox,
  isPointOnFrameEdge,
  listContentNodeIds,
  resolveFramePlateDragMode,
  resolveFramePlateTarget,
} from '../framePlatePointer';
import type { SceneDocument } from '@/components/rcb/sceneNode';

describe('framePlatePointer', () => {
  it('lists page children before ROOT children', () => {
    const doc = {
      pages: [{ id: 'p1', children: ['a', 'b'] }],
      deltaSetLike: { ROOT: { children: ['z'] } },
      activePageId: 'p1',
    } as unknown as SceneDocument;
    expect(listContentNodeIds(doc)).toEqual(['a', 'b']);
  });

  it('resolveFramePlateTarget accepts empty interior hits', () => {
    const doc = {
      frames: [{ id: 'f1', x: 0, y: 0, width: 300, height: 300 }],
      deltaSetLike: { ROOT: { children: [] } },
    } as unknown as SceneDocument;
    const hitTestFrame = (x: number, y: number) =>
      x >= 0 && x <= 300 && y >= 0 && y <= 300 ? 'f1' : null;
    expect(resolveFramePlateTarget(doc, { x: 100, y: 100 }, null, hitTestFrame)).toBe('f1');
  });

  it('resolveFramePlateTarget accepts full-bleed plate hits', () => {
    const doc = {
      frames: [{ id: 'f1', x: 0, y: 0, width: 300, height: 300 }],
      deltaSetLike: {
        ROOT: { children: ['bg'] },
        bg: {
          id: 'bg',
          key: 'shape',
          x: 0,
          y: 0,
          width: 300,
          height: 300,
          attrs: { shapeType: 'rect' },
        },
      },
    } as unknown as SceneDocument;
    const hitTestFrame = () => 'f1';
    expect(resolveFramePlateTarget(doc, { x: 50, y: 50 }, 'bg', hitTestFrame)).toBe('f1');
  });

  it('resolveFramePlateTarget rejects real shape hits', () => {
    const doc = {
      frames: [{ id: 'f1', x: 0, y: 0, width: 300, height: 300 }],
      deltaSetLike: {
        ROOT: { children: ['shape'] },
        shape: {
          id: 'shape',
          key: 'shape',
          x: 40,
          y: 40,
          width: 80,
          height: 80,
          attrs: { shapeType: 'rect' },
        },
      },
    } as unknown as SceneDocument;
    const hitTestFrame = () => 'f1';
    expect(resolveFramePlateTarget(doc, { x: 50, y: 50 }, 'shape', hitTestFrame)).toBeNull();
  });

  it('frameIsEmpty uses bound children (attrs.frameId), not geometry', () => {
    const doc = {
      pages: [{ id: 'p1', children: ['inner', 'neighbor'] }],
      activePageId: 'p1',
      frames: [
        { id: 'f1', x: 0, y: 0, width: 300, height: 300 },
        { id: 'f2', x: 400, y: 0, width: 300, height: 300 },
      ],
      deltaSetLike: {
        ROOT: { children: [] },
        inner: {
          id: 'inner',
          key: 'shape',
          x: 40,
          y: 40,
          width: 80,
          height: 80,
          attrs: { frameId: 'f1' },
        },
        // Sits inside f2 geometrically but belongs to f1 — must not occupy f2.
        neighbor: {
          id: 'neighbor',
          key: 'image',
          x: 420,
          y: 40,
          width: 200,
          height: 200,
          attrs: { frameId: 'f1' },
        },
      },
    } as unknown as SceneDocument;
    expect(frameIsEmpty(doc, 'f1')).toBe(false);
    expect(frameIsEmpty(doc, 'f2')).toBe(true);
    expect(getFrameBox(doc, 'f1')).toEqual({
      left: 0,
      top: 0,
      width: 300,
      height: 300,
    });
  });

  it('frameIsEmpty ignores unbound overlap from adjacent artboards', () => {
    const doc = {
      pages: [{ id: 'p1', children: ['spill'] }],
      activePageId: 'p1',
      frames: [
        { id: 'left', x: 0, y: 0, width: 200, height: 200 },
        { id: 'right', x: 220, y: 0, width: 200, height: 200 },
      ],
      deltaSetLike: {
        ROOT: { children: [] },
        spill: {
          id: 'spill',
          key: 'image',
          x: 100,
          y: 20,
          width: 200,
          height: 160,
          attrs: { frameId: 'left' },
        },
      },
    } as unknown as SceneDocument;
    expect(frameIsEmpty(doc, 'left')).toBe(false);
    expect(frameIsEmpty(doc, 'right')).toBe(true);
    expect(
      resolveFramePlateDragMode(doc, 'right', { readOnly: false, canMove: true })
    ).toBe('frame_move');
  });

  it('frameIsEmpty ignores hidden nodes and full-bleed plates', () => {
    const doc = {
      pages: [{ id: 'p1', children: ['hidden', 'bg'] }],
      activePageId: 'p1',
      frames: [{ id: 'f1', x: 0, y: 0, width: 300, height: 300 }],
      deltaSetLike: {
        ROOT: { children: [] },
        hidden: {
          id: 'hidden',
          key: 'shape',
          x: 40,
          y: 40,
          width: 80,
          height: 80,
          attrs: { hidden: true, frameId: 'f1' },
        },
        bg: {
          id: 'bg',
          key: 'shape',
          x: 0,
          y: 0,
          width: 300,
          height: 300,
          attrs: { shapeType: 'rect', frameId: 'f1' },
        },
      },
    } as unknown as SceneDocument;
    expect(frameIsEmpty(doc, 'f1')).toBe(true);
  });

  it('resolveFramePlateTarget treats Lottie frame host as plate', () => {
    const doc = {
      frames: [{ id: 'lot', x: 0, y: 0, width: 300, height: 300, kind: 'lottie' }],
      deltaSetLike: {
        ROOT: { children: ['host'] },
        host: {
          id: 'host',
          key: 'lottie',
          x: 0,
          y: 0,
          width: 300,
          height: 300,
          attrs: { frameId: 'lot', lottieFrameHost: true },
        },
      },
    } as unknown as SceneDocument;
    const hitTestFrame = () => 'lot';
    expect(resolveFramePlateTarget(doc, { x: 50, y: 50 }, 'host', hitTestFrame)).toBe('lot');
  });

  it('frameIsEmpty ignores Lottie frame host (host-only plate is empty)', () => {
    const doc = {
      frames: [{ id: 'lot', x: 0, y: 0, width: 300, height: 300, kind: 'lottie' }],
      deltaSetLike: {
        ROOT: { children: ['host'] },
        host: {
          id: 'host',
          key: 'lottie',
          x: 0,
          y: 0,
          width: 300,
          height: 300,
          attrs: { frameId: 'lot', lottieFrameHost: true },
        },
      },
    } as unknown as SceneDocument;
    expect(frameIsEmpty(doc, 'lot')).toBe(true);
  });

  it('isPointOnFrameEdge detects border band', () => {
    const box = { left: 0, top: 0, width: 300, height: 300 };
    const band = framePlateEdgeBandScene(1);
    expect(isPointOnFrameEdge({ x: band / 2, y: 150 }, box, 1)).toBe(true);
    expect(isPointOnFrameEdge({ x: 150, y: 150 }, box, 1)).toBe(false);
  });

  it('resolveFramePlateDragMode: empty → frame_move, occupied → pointing_canvas', () => {
    const emptyDoc = {
      frames: [{ id: 'f1', x: 0, y: 0, width: 300, height: 300 }],
      deltaSetLike: { ROOT: { children: [] } },
    } as unknown as SceneDocument;
    expect(
      resolveFramePlateDragMode(emptyDoc, 'f1', { readOnly: false, canMove: true })
    ).toBe('frame_move');
    expect(
      resolveFramePlateDragMode(emptyDoc, 'f1', { readOnly: true, canMove: true })
    ).toBe('pointing_canvas');

    const occupied = {
      pages: [{ id: 'p1', children: ['inner'] }],
      activePageId: 'p1',
      frames: [{ id: 'f1', x: 0, y: 0, width: 300, height: 300 }],
      deltaSetLike: {
        ROOT: { children: [] },
        inner: {
          id: 'inner',
          key: 'shape',
          x: 40,
          y: 40,
          width: 80,
          height: 80,
          attrs: { frameId: 'f1' },
        },
      },
    } as unknown as SceneDocument;
    expect(
      resolveFramePlateDragMode(occupied, 'f1', { readOnly: false, canMove: true })
    ).toBe('pointing_canvas');
  });
});
