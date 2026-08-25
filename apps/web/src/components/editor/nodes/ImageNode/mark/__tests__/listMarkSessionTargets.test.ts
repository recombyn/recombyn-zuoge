import { describe, expect, it } from 'vitest';
import { listMarkSessionTargets } from '@/components/editor/nodes/ImageNode/mark/markGeometry';
import type { SceneDocument } from '@/components/rcb/sceneNode';

function docWith(nodes: Record<string, any>): SceneDocument {
  return {
    version: 1,
    activeFrameId: null,
    frames: [],
    deltaSetLike: {
      ROOT: { id: 'ROOT', key: 'group', children: Object.keys(nodes) },
      ...nodes,
    },
  } as SceneDocument;
}

describe('listMarkSessionTargets', () => {
  it('marks video / audio / lottie as blocked so Mark cannot interact with them', () => {
    const targets = listMarkSessionTargets(
      docWith({
        img1: {
          id: 'img1',
          key: 'image',
          width: 100,
          height: 80,
          attrs: { src: 'https://example.com/a.png' },
        },
        vid1: {
          id: 'vid1',
          key: 'video',
          width: 120,
          height: 90,
          attrs: { src: 'https://example.com/a.mp4' },
        },
        aud1: {
          id: 'aud1',
          key: 'audio',
          width: 200,
          height: 60,
          attrs: { src: 'https://example.com/a.mp3' },
        },
        lot1: {
          id: 'lot1',
          key: 'lottie',
          width: 100,
          height: 100,
          attrs: { src: 'https://example.com/a.json' },
        },
      })
    );

    const byId = Object.fromEntries(targets.map((t) => [t.nodeId, t]));
    expect(byId.img1?.blocked).toBe(false);
    expect(byId.vid1?.blocked).toBe(true);
    expect(byId.aud1?.blocked).toBe(true);
    expect(byId.lot1?.blocked).toBe(true);
  });

  it('keeps image generators without src blocked', () => {
    const targets = listMarkSessionTargets(
      docWith({
        gen1: {
          id: 'gen1',
          key: 'image',
          width: 100,
          height: 100,
          attrs: { imageGenerator: true },
        },
      })
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]!.blocked).toBe(true);
  });
});
