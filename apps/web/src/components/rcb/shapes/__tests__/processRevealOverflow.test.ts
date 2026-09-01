import { describe, expect, it } from 'vitest';
import { shouldRevealShapeOverflow } from '../RcbShapesLayer';
import { findClippingFrameForNode } from '@/components/rcb/frames/frameContentClip';
import type { SceneDocument } from '@/components/rcb/sceneNode';

describe('shouldRevealShapeOverflow', () => {
  const clipDoc = {
    frames: [{ id: 'f1', x: 0, y: 0, width: 100, height: 100, clipContent: true }],
  } as unknown as SceneDocument;

  it('reveals overflow for selected hosts outside any plate', () => {
    expect(
      shouldRevealShapeOverflow(
        true,
        {
          id: 'n1',
          key: 'image',
          attrs: {},
        },
        clipDoc
      )
    ).toBe(true);
  });

  it('keeps clip for SoftGlow / processing hosts even when forceFull', () => {
    expect(
      shouldRevealShapeOverflow(
        true,
        {
          id: 'load',
          key: 'image',
          attrs: {
            frameId: 'f1',
            processStatus: 'running',
            processKind: 'removeBg',
            processLabel: 'Removing background...',
          },
        },
        clipDoc
      )
    ).toBe(false);
  });

  it('keeps clip for selected hosts bound to clipContent artboards', () => {
    expect(
      shouldRevealShapeOverflow(
        true,
        {
          id: 'n1',
          key: 'shape',
          attrs: { frameId: 'f1' },
        },
        clipDoc
      )
    ).toBe(false);
  });

  it('does not reveal when not forceFull', () => {
    expect(
      shouldRevealShapeOverflow(
        false,
        {
          id: 'n1',
          key: 'image',
          attrs: {},
        },
        clipDoc
      )
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
