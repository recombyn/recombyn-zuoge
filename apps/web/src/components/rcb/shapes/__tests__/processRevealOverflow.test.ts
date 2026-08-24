import { describe, expect, it } from 'vitest';
import { shouldRevealShapeOverflow } from '../RcbShapesLayer';
import { findClippingFrameForNode } from '@/components/rcb/frames/frameContentClip';

describe('shouldRevealShapeOverflow', () => {
  it('reveals overflow for selected non-processing hosts', () => {
    expect(
      shouldRevealShapeOverflow(true, {
        id: 'n1',
        key: 'image',
        attrs: { frameId: 'f1' },
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

  it('does not reveal when not forceFull', () => {
    expect(
      shouldRevealShapeOverflow(false, {
        id: 'n1',
        key: 'image',
        attrs: {},
      })
    ).toBe(false);
  });
});

describe('processing node clip ownership', () => {
  it('finds clip frame for a partially-overflowing SoftGlow plate with frameId', () => {
    const frame = {
      id: 'f1',
      name: 'Frame',
      x: 0,
      y: 0,
      width: 200,
      height: 400,
      clipContent: true,
      hidden: false,
      backgroundColor: '#fff',
    };
    const node = {
      x: 150,
      y: 40,
      width: 100,
      height: 100,
      attrs: {
        frameId: 'f1',
        processStatus: 'running',
        processKind: 'generate',
      },
    };
    expect(findClippingFrameForNode({ frames: [frame] }, node)?.id).toBe('f1');
  });
});
