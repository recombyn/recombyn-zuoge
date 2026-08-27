import { describe, expect, it } from 'vitest';
import { frameForFullBleedPlate } from '../attachPick';
import type { SceneDocument } from '@/components/rcb/sceneNode';

function docWithFrameAndNode(opts: {
  shapeType?: string;
  key?: string;
  closed?: string;
  w?: number;
  h?: number;
}): SceneDocument {
  const fw = 200;
  const fh = 300;
  return {
    frames: [{ id: 'f1', name: 'Frame', x: 0, y: 0, width: fw, height: fh }],
    deltaSetLike: {
      ROOT: { id: 'ROOT', children: ['n1'] },
      n1: {
        id: 'n1',
        key: opts.key || 'shape',
        width: opts.w ?? fw,
        height: opts.h ?? fh,
        attrs: {
          shapeType: opts.shapeType || 'rect',
          frameId: 'f1',
          ...(opts.closed != null ? { closed: opts.closed } : null),
          x: 0,
          y: 0,
        },
      },
    },
  } as unknown as SceneDocument;
}

describe('frameForFullBleedPlate', () => {
  it('promotes a full-bleed rect to its artboard', () => {
    expect(frameForFullBleedPlate(docWithFrameAndNode({ shapeType: 'rect' }), 'n1')?.id).toBe('f1');
  });

  it('promotes a full-bleed closed path (vector plate) to its artboard', () => {
    expect(
      frameForFullBleedPlate(docWithFrameAndNode({ shapeType: 'path', closed: 'true' }), 'n1')?.id
    ).toBe('f1');
  });

  it('does not promote an open pen stroke', () => {
    expect(
      frameForFullBleedPlate(docWithFrameAndNode({ shapeType: 'pen', closed: 'false' }), 'n1')
    ).toBeNull();
  });

  it('promotes a full-bleed image plate', () => {
    expect(frameForFullBleedPlate(docWithFrameAndNode({ key: 'image' }), 'n1')?.id).toBe('f1');
  });

  it('ignores a small shape that does not cover the artboard', () => {
    expect(
      frameForFullBleedPlate(docWithFrameAndNode({ shapeType: 'circle', w: 40, h: 40 }), 'n1')
    ).toBeNull();
  });
});
