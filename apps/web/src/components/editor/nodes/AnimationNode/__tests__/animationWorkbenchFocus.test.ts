import { describe, expect, it, afterEach, vi } from 'vitest';
import {
  WORKBENCH_SURROUND_ATTR,
  CANVAS_MEDIA_FILE_ACCEPT,
  finalizeNodeForAnimationWorkbenchFocus,
  isAnimationWorkbenchPreviewChild,
  isAvBlockedByAnimationWorkbenchFocus,
  isHiddenByAnimationWorkbenchFocus,
  isInactiveAtAnimationPlayhead,
  isLottieJsonFile,
  mediaFileAcceptForWorkbenchTimeline,
  setAnimationWorkbenchPlayheadSec,
  setAnimationWorkbenchTimelineFocus,
  warnIfAvBlockedByAnimationWorkbenchFocus,
  WORKBENCH_IMAGE_JSON_FILE_ACCEPT,
} from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';

afterEach(() => {
  setAnimationWorkbenchTimelineFocus(null);
  setAnimationWorkbenchPlayheadSec(0);
});

function docWithPlateAndNode(opts: {
  frameId: string;
  fps?: number;
  node: Record<string, unknown>;
}) {
  return {
    width: 800,
    height: 600,
    frames: [
      {
        id: opts.frameId,
        kind: 'animation',
        x: 100,
        y: 100,
        width: 400,
        height: 300,
        fps: opts.fps ?? 30,
      },
    ],
    deltaSetLike: {
      ROOT: { id: 'ROOT', key: 'root' },
      [String(opts.node.id)]: opts.node,
    },
  };
}

describe('finalizeNodeForAnimationWorkbenchFocus', () => {
  it('binds intersecting image into focused plate (visible under focus)', () => {
    setAnimationWorkbenchTimelineFocus('af1');
    const raw = docWithPlateAndNode({
      frameId: 'af1',
      node: {
        id: 'img1',
        key: 'image',
        x: 120,
        y: 120,
        width: 80,
        height: 80,
        attrs: {},
      },
    });
    const next = finalizeNodeForAnimationWorkbenchFocus(raw, 'img1');
    const node = next.deltaSetLike.img1;
    expect(node.attrs.frameId).toBe('af1');
    expect(node.attrs[WORKBENCH_SURROUND_ATTR]).toBeUndefined();
    expect(isHiddenByAnimationWorkbenchFocus(node)).toBe(false);
  });

  it('tags surround when image is outside the plate (still visible under focus)', () => {
    setAnimationWorkbenchTimelineFocus('af1');
    const raw = docWithPlateAndNode({
      frameId: 'af1',
      node: {
        id: 'img2',
        key: 'image',
        x: 700,
        y: 700,
        width: 80,
        height: 80,
        attrs: {},
      },
    });
    const next = finalizeNodeForAnimationWorkbenchFocus(raw, 'img2');
    const node = next.deltaSetLike.img2;
    expect(node.attrs.frameId).toBeUndefined();
    expect(node.attrs[WORKBENCH_SURROUND_ATTR]).toBe('af1');
    expect(isHiddenByAnimationWorkbenchFocus(node)).toBe(false);
  });

  it('hides unowned nodes that were never finalized', () => {
    setAnimationWorkbenchTimelineFocus('af1');
    const node = {
      id: 'img3',
      key: 'image',
      x: 120,
      y: 120,
      width: 80,
      height: 80,
      attrs: {},
    };
    expect(isHiddenByAnimationWorkbenchFocus(node)).toBe(true);
  });

  it('tags surround for image generators (pasteboard, not timeline layer)', () => {
    setAnimationWorkbenchTimelineFocus('af1');
    const raw = docWithPlateAndNode({
      frameId: 'af1',
      node: {
        id: 'gen1',
        key: 'image',
        x: 120,
        y: 120,
        width: 80,
        height: 80,
        attrs: { imageGenerator: true },
      },
    });
    const next = finalizeNodeForAnimationWorkbenchFocus(raw, 'gen1');
    const node = next.deltaSetLike.gen1;
    expect(node.attrs.frameId).toBeUndefined();
    expect(node.attrs[WORKBENCH_SURROUND_ATTR]).toBe('af1');
    expect(isHiddenByAnimationWorkbenchFocus(node)).toBe(false);
  });

  it('tags surround for video plates (never bind into workbench plate)', () => {
    setAnimationWorkbenchTimelineFocus('af1');
    const raw = docWithPlateAndNode({
      frameId: 'af1',
      node: {
        id: 'vid1',
        key: 'video',
        x: 120,
        y: 120,
        width: 80,
        height: 80,
        attrs: {},
      },
    });
    const next = finalizeNodeForAnimationWorkbenchFocus(raw, 'vid1');
    const node = next.deltaSetLike.vid1;
    expect(node.attrs.frameId).toBeUndefined();
    expect(node.attrs[WORKBENCH_SURROUND_ATTR]).toBe('af1');
  });
});

describe('AV blocked under workbench focus', () => {
  it('isAvBlocked when focus is set', () => {
    expect(isAvBlockedByAnimationWorkbenchFocus()).toBe(false);
    setAnimationWorkbenchTimelineFocus('af1');
    expect(isAvBlockedByAnimationWorkbenchFocus()).toBe(true);
  });

  it('warnIfAvBlocked warns once and returns true under focus', () => {
    const warn = vi.fn();
    expect(warnIfAvBlockedByAnimationWorkbenchFocus(warn)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    setAnimationWorkbenchTimelineFocus('af1');
    expect(warnIfAvBlockedByAnimationWorkbenchFocus(warn)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('exposes image+JSON accept for timeline attach', () => {
    expect(WORKBENCH_IMAGE_JSON_FILE_ACCEPT).toContain('image/png');
    expect(WORKBENCH_IMAGE_JSON_FILE_ACCEPT).toContain('application/json');
    expect(WORKBENCH_IMAGE_JSON_FILE_ACCEPT).toContain('.lot');
    expect(WORKBENCH_IMAGE_JSON_FILE_ACCEPT).not.toContain('video/');
  });

  it('isLottieJsonFile accepts .json / .lot and rejects .lottie zip', () => {
    expect(isLottieJsonFile({ name: 'a.json', type: 'application/json' })).toBe(true);
    expect(isLottieJsonFile({ name: 'a.lot', type: '' })).toBe(true);
    expect(isLottieJsonFile({ name: 'a.lottie', type: 'application/zip' })).toBe(false);
  });

  it('mediaFileAcceptForWorkbenchTimeline switches canvas vs workbench accept', () => {
    expect(mediaFileAcceptForWorkbenchTimeline(false)).toBe(CANVAS_MEDIA_FILE_ACCEPT);
    expect(mediaFileAcceptForWorkbenchTimeline(true)).toBe(WORKBENCH_IMAGE_JSON_FILE_ACCEPT);
    expect(CANVAS_MEDIA_FILE_ACCEPT).toContain('video/*');
  });
});

describe('isAnimationWorkbenchPreviewChild', () => {
  it('true for bound children when timeline closed; false when focused', () => {
    const doc = docWithPlateAndNode({
      frameId: 'af1',
      node: {
        id: 'img1',
        key: 'image',
        x: 120,
        y: 120,
        width: 80,
        height: 80,
        attrs: { frameId: 'af1' },
      },
    });
    const node = doc.deltaSetLike.img1;
    expect(isAnimationWorkbenchPreviewChild(doc, node)).toBe(true);
    setAnimationWorkbenchTimelineFocus('af1');
    expect(isAnimationWorkbenchPreviewChild(doc, node)).toBe(false);
  });

  it('never treats host as preview child', () => {
    const doc = docWithPlateAndNode({
      frameId: 'af1',
      node: {
        id: 'host',
        key: 'lottie',
        x: 100,
        y: 100,
        width: 400,
        height: 300,
        attrs: { frameId: 'af1', animationFrameHost: true },
      },
    });
    expect(isAnimationWorkbenchPreviewChild(doc, doc.deltaSetLike.host)).toBe(false);
  });
});

describe('isInactiveAtAnimationPlayhead', () => {
  it('skips hit when playhead is before layer in-frame', () => {
    setAnimationWorkbenchTimelineFocus('af1');
    setAnimationWorkbenchPlayheadSec(0.2);
    const doc = docWithPlateAndNode({
      frameId: 'af1',
      fps: 30,
      node: {
        id: 'img',
        key: 'image',
        x: 120,
        y: 120,
        width: 80,
        height: 80,
        attrs: {
          frameId: 'af1',
          // 0.35s * 30fps ≈ 10.5 → 11
          lottieInFrame: 11,
          lottieOutFrame: 36,
        },
      },
    });
    expect(isInactiveAtAnimationPlayhead(doc, doc.deltaSetLike.img)).toBe(true);
  });

  it('allows hit when playhead is inside layer range', () => {
    setAnimationWorkbenchTimelineFocus('af1');
    setAnimationWorkbenchPlayheadSec(0.5);
    const doc = docWithPlateAndNode({
      frameId: 'af1',
      fps: 30,
      node: {
        id: 'img',
        key: 'image',
        x: 120,
        y: 120,
        width: 80,
        height: 80,
        attrs: {
          frameId: 'af1',
          lottieInFrame: 11,
          lottieOutFrame: 36,
        },
      },
    });
    expect(isInactiveAtAnimationPlayhead(doc, doc.deltaSetLike.img)).toBe(false);
  });

  it('trims animation-plate children when timeline focus is cleared', () => {
    setAnimationWorkbenchTimelineFocus(null);
    setAnimationWorkbenchPlayheadSec(0);
    const doc = docWithPlateAndNode({
      frameId: 'af1',
      fps: 30,
      node: {
        id: 'img',
        key: 'image',
        x: 120,
        y: 120,
        width: 80,
        height: 80,
        attrs: {
          frameId: 'af1',
          lottieInFrame: 11,
          lottieOutFrame: 36,
        },
      },
    });
    expect(isInactiveAtAnimationPlayhead(doc, doc.deltaSetLike.img)).toBe(true);
    expect(isInactiveAtAnimationPlayhead(doc, doc.deltaSetLike.img, 0.5)).toBe(false);
  });
});
