import { describe, expect, it } from 'vitest';
import {
  frameIsEmpty,
  getFrameBox,
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
    } as SceneDocument;
    expect(listContentNodeIds(doc)).toEqual(['a', 'b']);
  });

  it('resolveFramePlateTarget accepts empty interior hits', () => {
    const doc = {
      frames: [{ id: 'f1', x: 0, y: 0, width: 300, height: 300 }],
      deltaSetLike: { ROOT: { children: [] } },
    } as SceneDocument;
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
    } as SceneDocument;
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
    } as SceneDocument;
    const hitTestFrame = () => 'f1';
    expect(resolveFramePlateTarget(doc, { x: 50, y: 50 }, 'shape', hitTestFrame)).toBeNull();
  });

  it('frameIsEmpty uses page children', () => {
    const doc = {
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
        },
      },
    } as SceneDocument;
    expect(frameIsEmpty(doc, 'f1')).toBe(false);
    expect(getFrameBox(doc, 'f1')).toEqual({
      left: 0,
      top: 0,
      width: 300,
      height: 300,
    });
  });

  it('resolveFramePlateDragMode: empty → frame_move, occupied → pointing_canvas', () => {
    const emptyDoc = {
      frames: [{ id: 'f1', x: 0, y: 0, width: 300, height: 300 }],
      deltaSetLike: { ROOT: { children: [] } },
    } as SceneDocument;
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
        },
      },
    } as SceneDocument;
    expect(
      resolveFramePlateDragMode(occupied, 'f1', { readOnly: false, canMove: true })
    ).toBe('pointing_canvas');
  });
});
