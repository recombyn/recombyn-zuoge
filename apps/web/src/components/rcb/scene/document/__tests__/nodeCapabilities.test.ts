import { describe, expect, it, afterEach } from 'vitest';
import {
  isNodeHidden,
  isNodeHiddenInDocument,
  isNodeMarqueeSkippable,
  isNodeOverlayHidden,
  isNodePickableInDocument,
  shouldSkipNodeInSvgPaint,
} from '../nodeCapabilities';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import {
  setAnimationWorkbenchPlayheadSec,
  setAnimationWorkbenchTimelineFocus,
} from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';

describe('nodeCapabilities visibility', () => {
  it('isNodeHiddenInDocument is true when owning artboard is hidden', () => {
    const doc = {
      frames: [{ id: 'f1', x: 0, y: 0, width: 100, height: 100, hidden: true }],
      deltaSetLike: {
        ROOT: { children: ['n1'] },
        n1: {
          id: 'n1',
          key: 'text',
          x: 10,
          y: 10,
          width: 40,
          height: 40,
          attrs: { frameId: 'f1' },
        },
      },
    } as unknown as SceneDocument;
    const node = doc.deltaSetLike!.n1;
    expect(isNodeHidden(node)).toBe(false);
    expect(isNodeHiddenInDocument(doc, node)).toBe(true);
    expect(isNodeMarqueeSkippable(doc, node)).toBe(true);
    expect(isNodeOverlayHidden(doc, node)).toBe(true);
    expect(shouldSkipNodeInSvgPaint(doc, node, false)).toBe(true);
  });

  it('isNodeHiddenInDocument stays false for pasteboard nodes when frame hidden elsewhere', () => {
    const doc = {
      frames: [{ id: 'f1', x: 0, y: 0, width: 100, height: 100, hidden: true }],
      deltaSetLike: {
        ROOT: { children: ['n1'] },
        n1: { id: 'n1', key: 'text', x: 0, y: 0, width: 20, height: 20, attrs: {} },
      },
    } as unknown as SceneDocument;
    expect(isNodeHiddenInDocument(doc, doc.deltaSetLike!.n1)).toBe(false);
  });

  it('isNodeOverlayHidden respects session hide without document hide', () => {
    const doc = {
      frames: [],
      deltaSetLike: {
        ROOT: { children: ['n1'] },
        n1: { id: 'n1', key: 'text', x: 0, y: 0, width: 20, height: 20, attrs: {} },
      },
    } as unknown as SceneDocument;
    const node = doc.deltaSetLike!.n1;
    expect(isNodeOverlayHidden(doc, node, true)).toBe(true);
    expect(isNodeOverlayHidden(doc, node, false)).toBe(false);
  });
});

describe('nodeCapabilities playhead hide', () => {
  afterEach(() => {
    setAnimationWorkbenchTimelineFocus(null);
    setAnimationWorkbenchPlayheadSec(0);
  });

  it('isNodeHiddenInDocument is true when playhead is before layer in-frame', () => {
    setAnimationWorkbenchTimelineFocus('af1');
    setAnimationWorkbenchPlayheadSec(0);
    const doc = {
      frames: [{ id: 'af1', kind: 'animation', x: 0, y: 0, width: 400, height: 300, fps: 30 }],
      deltaSetLike: {
        ROOT: { children: ['img'] },
        img: {
          id: 'img',
          key: 'image',
          x: 10,
          y: 10,
          width: 40,
          height: 40,
          attrs: { frameId: 'af1', lottieInFrame: 30, lottieOutFrame: 90 },
        },
      },
    } as unknown as SceneDocument;
    expect(isNodeHiddenInDocument(doc, doc.deltaSetLike!.img)).toBe(true);
    expect(shouldSkipNodeInSvgPaint(doc, doc.deltaSetLike!.img, false)).toBe(false);
    expect(isNodeHiddenInDocument(doc, doc.deltaSetLike!.img, 1.5)).toBe(false);
  });

  it('isNodeHiddenInDocument trims playhead without timeline focus', () => {
    setAnimationWorkbenchTimelineFocus(null);
    setAnimationWorkbenchPlayheadSec(0);
    const doc = {
      frames: [{ id: 'af1', kind: 'animation', x: 0, y: 0, width: 400, height: 300, fps: 30 }],
      deltaSetLike: {
        ROOT: { children: ['img'] },
        img: {
          id: 'img',
          key: 'image',
          x: 10,
          y: 10,
          width: 40,
          height: 40,
          attrs: { frameId: 'af1', lottieInFrame: 30, lottieOutFrame: 90 },
        },
      },
    } as unknown as SceneDocument;
    expect(isNodeHiddenInDocument(doc, doc.deltaSetLike!.img)).toBe(true);
    expect(isNodeHiddenInDocument(doc, doc.deltaSetLike!.img, 1.5)).toBe(false);
  });

  it('isNodeOverlayHidden ignores playhead trim (sync owns ink)', () => {
    setAnimationWorkbenchTimelineFocus('af1');
    setAnimationWorkbenchPlayheadSec(0);
    const doc = {
      frames: [{ id: 'af1', kind: 'animation', x: 0, y: 0, width: 400, height: 300, fps: 30 }],
      deltaSetLike: {
        ROOT: { children: ['img'] },
        img: {
          id: 'img',
          key: 'image',
          x: 10,
          y: 10,
          width: 40,
          height: 40,
          attrs: { frameId: 'af1', lottieInFrame: 30, lottieOutFrame: 90 },
        },
      },
    } as unknown as SceneDocument;
    expect(isNodeHiddenInDocument(doc, doc.deltaSetLike!.img)).toBe(true);
    expect(isNodeOverlayHidden(doc, doc.deltaSetLike!.img)).toBe(false);
  });
});

describe('isNodePickableInDocument', () => {
  afterEach(() => {
    setAnimationWorkbenchTimelineFocus(null);
    setAnimationWorkbenchPlayheadSec(0);
  });

  it('preview child of closed workbench is not pickable', () => {
    setAnimationWorkbenchTimelineFocus(null);
    const doc = {
      frames: [{ id: 'af1', kind: 'animation', x: 0, y: 0, width: 400, height: 300 }],
      deltaSetLike: {
        ROOT: { children: ['n1'] },
        n1: {
          id: 'n1',
          key: 'shape',
          x: 10,
          y: 10,
          width: 40,
          height: 40,
          attrs: { frameId: 'af1' },
        },
      },
    } as unknown as SceneDocument;
    expect(isNodeHiddenInDocument(doc, doc.deltaSetLike!.n1)).toBe(false);
    expect(isNodePickableInDocument(doc, doc.deltaSetLike!.n1)).toBe(false);
    expect(isNodeMarqueeSkippable(doc, doc.deltaSetLike!.n1)).toBe(true);
    setAnimationWorkbenchTimelineFocus('af1');
    expect(isNodePickableInDocument(doc, doc.deltaSetLike!.n1)).toBe(true);
  });

  it('playhead trim makes node not pickable via isNodeHiddenInDocument', () => {
    setAnimationWorkbenchTimelineFocus('af1');
    setAnimationWorkbenchPlayheadSec(0);
    const doc = {
      frames: [{ id: 'af1', kind: 'animation', x: 0, y: 0, width: 400, height: 300, fps: 30 }],
      deltaSetLike: {
        ROOT: { children: ['img'] },
        img: {
          id: 'img',
          key: 'image',
          x: 10,
          y: 10,
          width: 40,
          height: 40,
          attrs: { frameId: 'af1', lottieInFrame: 30, lottieOutFrame: 90 },
        },
      },
    } as unknown as SceneDocument;
    expect(isNodeHiddenInDocument(doc, doc.deltaSetLike!.img)).toBe(true);
    expect(isNodePickableInDocument(doc, doc.deltaSetLike!.img)).toBe(false);
    expect(isNodePickableInDocument(doc, doc.deltaSetLike!.img, 1.5)).toBe(true);
  });
});
