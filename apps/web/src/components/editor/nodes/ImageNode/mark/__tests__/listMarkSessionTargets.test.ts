import { describe, expect, it } from 'vitest';
import { listMarkSessionTargets } from '@/components/editor/nodes/ImageNode/mark/markGeometry';

function docWith(nodes: Record<string, any>) {
  return {
    version: 1,
    activeFrameId: null,
    frames: [],
    deltaSetLike: {
      ROOT: {
        id: 'ROOT',
        key: 'group',
        children: Object.keys(nodes),
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        attrs: {},
      },
      ...nodes,
    },
  } as any;
}

describe('listMarkSessionTargets', () => {
  it('allows ready images and blocks video / audio / lottie / vectors', () => {
    const targets = listMarkSessionTargets(
      docWith({
        img1: {
          id: 'img1',
          key: 'image',
          width: 100,
          height: 80,
          x: 0,
          y: 0,
          attrs: { src: 'https://example.com/a.png' },
        },
        vid1: {
          id: 'vid1',
          key: 'video',
          width: 120,
          height: 90,
          x: 0,
          y: 0,
          attrs: { src: 'https://example.com/a.mp4' },
        },
        aud1: {
          id: 'aud1',
          key: 'audio',
          width: 200,
          height: 60,
          x: 0,
          y: 0,
          attrs: { src: 'https://example.com/a.mp3' },
        },
        lot1: {
          id: 'lot1',
          key: 'lottie',
          width: 100,
          height: 100,
          x: 0,
          y: 0,
          attrs: { src: 'https://example.com/a.json' },
        },
        shape1: {
          id: 'shape1',
          key: 'shape',
          width: 80,
          height: 80,
          x: 10,
          y: 10,
          attrs: { shapeType: 'circle' },
        },
        path1: {
          id: 'path1',
          key: 'path',
          width: 60,
          height: 40,
          x: 20,
          y: 20,
          attrs: { path: 'M0 0L10 0L10 10Z', closed: 'true' },
        },
      })
    );

    const byId = Object.fromEntries(targets.map((t) => [t.nodeId, t]));
    expect(byId.img1?.blocked).toBe(false);
    expect(byId.vid1?.blocked).toBe(true);
    expect(byId.aud1?.blocked).toBe(true);
    expect(byId.lot1?.blocked).toBe(true);
    expect(byId.shape1?.blocked).toBe(true);
    expect(byId.path1?.blocked).toBe(true);
  });

  it('keeps image generators without src blocked', () => {
    const targets = listMarkSessionTargets(
      docWith({
        gen1: {
          id: 'gen1',
          key: 'image',
          width: 100,
          height: 100,
          x: 0,
          y: 0,
          attrs: { imageGenerator: true },
        },
      })
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]!.blocked).toBe(true);
  });
});
