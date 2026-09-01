import { describe, expect, it } from 'vitest';
import { shouldRevealShapeOverflow } from '../RcbShapesLayer';
import {
  findClippingFrameForNode,
  frameClipRevealsOverflow,
  hasFrameClipRevealOverflow,
  setFrameClipRevealOverflowIds,
} from '@/components/rcb/frames/frameContentClip';

describe('shouldRevealShapeOverflow', () => {
  it('reveals overflow for selected hosts outside any plate', () => {
    expect(
      shouldRevealShapeOverflow(true, {
        id: 'n1',
        key: 'image',
        attrs: {},
      })
    ).toBe(true);
  });

  it('keeps clip for SoftGlow / processing hosts even when forceFull', () => {
    expect(
      shouldRevealShapeOverflow(true, {
        id: 'load',
        key: 'image',
        attrs: {
          frameId: 'f1',
          processStatus: 'running',
          processKind: 'removeBg',
          processLabel: 'Removing background...',
        },
      })
    ).toBe(false);
  });

  it('reveals overflow for selected hosts bound to clipContent artboards', () => {
    expect(
      shouldRevealShapeOverflow(true, {
        id: 'n1',
        key: 'shape',
        attrs: { frameId: 'f1' },
      })
    ).toBe(true);
  });

  it('does not reveal when not keep/forceFull', () => {
    expect(
      shouldRevealShapeOverflow(false, {
        id: 'n1',
        key: 'image',
        attrs: {},
      })
    ).toBe(false);
  });
});

describe('findClippingFrameForNode still owns clip outside plate AABB', () => {
  it('returns the owning clipContent frame when the node is fully outside', () => {
    const doc = {
      frames: [{ id: 'f1', x: 0, y: 0, width: 100, height: 100, clipContent: true }],
    };
    const frame = findClippingFrameForNode(doc, {
      id: 'n1',
      x: 400,
      y: 400,
      width: 40,
      height: 40,
      attrs: { frameId: 'f1' },
    });
    expect(frame?.id).toBe('f1');
  });
});

describe('frameClip reveal-overflow registry', () => {
  it('marks selection ids so canvas ink can skip artboard clip', () => {
    setFrameClipRevealOverflowIds(['a', 'b']);
    expect(frameClipRevealsOverflow('a')).toBe(true);
    expect(frameClipRevealsOverflow('c')).toBe(false);
    setFrameClipRevealOverflowIds(null);
    expect(frameClipRevealsOverflow('a')).toBe(false);
  });

  it('hasFrameClipRevealOverflow tracks whether any selection reveal is active', () => {
    setFrameClipRevealOverflowIds(null);
    expect(hasFrameClipRevealOverflow()).toBe(false);
    setFrameClipRevealOverflowIds(['sel']);
    expect(hasFrameClipRevealOverflow()).toBe(true);
    setFrameClipRevealOverflowIds([]);
    expect(hasFrameClipRevealOverflow()).toBe(false);
  });
});
