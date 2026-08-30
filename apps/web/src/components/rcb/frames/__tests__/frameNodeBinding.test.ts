import { describe, expect, it, afterEach } from 'vitest';
import {
  bindUnownedNodesToFrames,
  canBindNodeToArtboardFrame,
  frameForNodeIntersectPlacement,
  shouldBindUnownedNodeToFrame,
  shouldCoMoveNodeWithFrames,
  acceptCreateFrameId,
} from '../frameNodeBinding';
import { setAnimationWorkbenchTimelineFocus } from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';
import type { SceneDocument } from '@/components/rcb/sceneNode';

afterEach(() => {
  setAnimationWorkbenchTimelineFocus(null);
});

const docWithFrames = (): SceneDocument =>
  ({
    frames: [
      { id: 'a', x: 0, y: 0, width: 200, height: 200, backgroundColor: '#fff', clipContent: true },
      { id: 'b', x: 210, y: 0, width: 200, height: 200, backgroundColor: '#fff', clipContent: true },
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

  it('does not co-move free ink with an animation workbench plate', () => {
    const moved = new Set(['lot']);
    const free = { attrs: {} };
    const rect = { left: 20, top: 20, width: 40, height: 40 };
    const plate = { left: 0, top: 0, width: 200, height: 200 };
    expect(shouldCoMoveNodeWithFrames(free, rect, moved, plate, 'animation')).toBe(false);
  });

  it('still co-moves workbench-bound children with the plate', () => {
    const moved = new Set(['lot']);
    const child = { attrs: { frameId: 'lot' } };
    const rect = { left: 20, top: 20, width: 40, height: 40 };
    const plate = { left: 0, top: 0, width: 200, height: 200 };
    expect(shouldCoMoveNodeWithFrames(child, rect, moved, plate, 'animation')).toBe(true);
  });

  it('acceptCreateFrameId rejects preview workbench until timeline opens', () => {
    const doc = {
      frames: [
        {
          id: 'lot',
          kind: 'animation',
          x: 0,
          y: 0,
          width: 200,
          height: 200,
          backgroundColor: '#fff',
        },
      ],
      deltaSetLike: {},
    } as any as SceneDocument;
    expect(acceptCreateFrameId(doc, 'lot', { key: 'shape' })).toBeNull();
    setAnimationWorkbenchTimelineFocus('lot');
    expect(acceptCreateFrameId(doc, 'lot', { key: 'shape' })).toBe('lot');
    expect(acceptCreateFrameId(doc, 'lot', { key: 'video' })).toBeNull();
  });

  it('bindUnownedNodesToFrames assigns frameId so clip can apply', () => {
    const doc = {
      frames: [
        {
          id: 'plate',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          backgroundColor: '#fff',
          clipContent: true,
        },
      ],
      deltaSetLike: {
        ROOT: { id: 'ROOT', children: ['shape-1'] },
        'shape-1': {
          id: 'shape-1',
          key: 'shape',
          x: 20,
          y: 20,
          width: 120,
          height: 40,
          attrs: {},
        },
      },
    } as any as SceneDocument;

    const next = bindUnownedNodesToFrames(doc, ['plate']);
    expect(next.deltaSetLike['shape-1'].attrs?.frameId).toBe('plate');
    expect(Number(next.deltaSetLike['shape-1'].attrs?.frameOrder)).toBe(0);
  });

  it('bindUnownedNodesToFrames skips already-owned nodes', () => {
    const doc = {
      frames: [
        { id: 'plate', x: 0, y: 0, width: 100, height: 100, backgroundColor: '#fff' },
      ],
      deltaSetLike: {
        'shape-1': {
          id: 'shape-1',
          key: 'shape',
          x: 20,
          y: 20,
          width: 40,
          height: 40,
          attrs: { frameId: 'other' },
        },
      },
    } as any as SceneDocument;

    const next = bindUnownedNodesToFrames(doc, ['plate']);
    expect(next.deltaSetLike['shape-1'].attrs?.frameId).toBe('other');
  });

  it('rejects video/audio on 动画工作台; preview blocks new binds until timeline open', () => {
    const lottie = {
      id: 'lot',
      kind: 'lottie',
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      backgroundColor: '#fff',
      clipContent: true,
    } as const;
    const video = { key: 'video', x: 20, y: 20, width: 40, height: 40, attrs: {} };
    const audio = { key: 'audio', x: 20, y: 20, width: 40, height: 40, attrs: {} };
    const shape = { key: 'shape', x: 20, y: 20, width: 40, height: 40, attrs: {} };
    expect(canBindNodeToArtboardFrame(lottie as any, video)).toBe(false);
    expect(canBindNodeToArtboardFrame(lottie as any, audio)).toBe(false);
    expect(canBindNodeToArtboardFrame(lottie as any, shape)).toBe(true);
    // Free Lottie plates bind into 动画工作台 → sync as lot_* precomp tabs.
    expect(
      canBindNodeToArtboardFrame(lottie as any, {
        key: 'lottie',
        attrs: { animationData: '{}' },
      })
    ).toBe(true);
    expect(
      canBindNodeToArtboardFrame(lottie as any, {
        key: 'lottie',
        attrs: { animationFrameHost: true },
      })
    ).toBe(true);
    // Timeline closed = preview — no auto-bind into workbench.
    expect(shouldBindUnownedNodeToFrame(video, lottie as any)).toBe(false);
    expect(shouldBindUnownedNodeToFrame(shape, lottie as any)).toBe(false);

    const doc = {
      frames: [lottie],
      deltaSetLike: {
        ROOT: { id: 'ROOT', children: ['v1', 's1'] },
        v1: { id: 'v1', ...video },
        s1: { id: 's1', ...shape },
      },
    } as any as SceneDocument;
    const next = bindUnownedNodesToFrames(doc, ['lot']);
    expect(next.deltaSetLike.v1.attrs?.frameId).toBeUndefined();
    expect(next.deltaSetLike.s1.attrs?.frameId).toBeUndefined();
    expect(
      frameForNodeIntersectPlacement(
        doc,
        { left: 20, top: 20, width: 40, height: 40 },
        video
      )
    ).toBeNull();
    expect(
      frameForNodeIntersectPlacement(
        doc,
        { left: 20, top: 20, width: 40, height: 40 },
        shape
      )
    ).toBeNull();

    setAnimationWorkbenchTimelineFocus('lot');
    // Timeline open: move/overlap can join; create still uses acceptCreateFrameId.
    expect(shouldBindUnownedNodeToFrame(shape, lottie as any)).toBe(true);
    expect(shouldBindUnownedNodeToFrame(video, lottie as any)).toBe(false);
    expect(
      frameForNodeIntersectPlacement(
        doc,
        { left: 20, top: 20, width: 40, height: 40 },
        shape
      )
    ).toBe('lot');
    expect(acceptCreateFrameId(doc, 'lot', shape)).toBe('lot');
    const bound = bindUnownedNodesToFrames(doc, ['lot']);
    expect(bound.deltaSetLike.s1.attrs?.frameId).toBe('lot');
    expect(bound.deltaSetLike.v1.attrs?.frameId).toBeUndefined();
  });

  it('under timeline focus never binds to a non-focus 主画板', () => {
    setAnimationWorkbenchTimelineFocus('anim');
    const doc = {
      frames: [
        {
          id: 'main',
          kind: 'artboard',
          x: 0,
          y: 0,
          width: 400,
          height: 400,
          backgroundColor: '#fff',
          clipContent: true,
        },
        {
          id: 'anim',
          kind: 'animation',
          x: 500,
          y: 0,
          width: 200,
          height: 200,
          backgroundColor: '#fff',
          clipContent: true,
        },
      ],
      deltaSetLike: {},
    } as any as SceneDocument;
    expect(
      frameForNodeIntersectPlacement(doc, { left: 40, top: 40, width: 40, height: 40 }, {
        key: 'shape',
      })
    ).toBeNull();
    expect(
      frameForNodeIntersectPlacement(doc, { left: 40, top: 40, width: 40, height: 40 }, {
        key: 'text',
      })
    ).toBeNull();
    expect(
      frameForNodeIntersectPlacement(doc, { left: 520, top: 40, width: 40, height: 40 }, {
        key: 'shape',
      })
    ).toBe('anim');
    expect(acceptCreateFrameId(doc, 'anim', { key: 'shape' })).toBe('anim');
  });
});
