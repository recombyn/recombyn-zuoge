import { describe, expect, it } from 'vitest';
import { enrichTimelineScenesWithPuppet } from '../puppetTimeline';
import type { LottieTimelineScene } from '@/components/editor/nodes/AnimationNode/animationTimelineModel';
import type { SceneDocument } from '@/components/rcb/sceneNode';

describe('enrichTimelineScenesWithPuppet', () => {
  it('injects a puppet prop row from attrs.puppetTrack', () => {
    const scenes: LottieTimelineScene[] = [
      {
        id: 'main',
        label: 'Main',
        kind: 'main',
        fr: 30,
        ip: 0,
        op: 60,
        durationSec: 2,
        layers: [
          {
            id: 'layer-1-img',
            ind: 1,
            name: 'Photo',
            sceneNodeId: 'img1',
            clipKind: 'image',
            inSec: 0,
            outSec: 2,
            props: [{ id: '1:p', key: 'p', label: 'Position', times: [] }],
          },
        ],
      },
    ];
    const document = {
      deltaSetLike: {
        img1: {
          id: 'img1',
          key: 'image',
          attrs: {
            puppetEnabled: true,
            puppetTrack: [
              { f: 0, pins: [{ id: 'a', u: 0.2, v: 0.2, dx: 0, dy: 0 }] },
              { f: 30, pins: [{ id: 'a', u: 0.2, v: 0.2, dx: 0.1, dy: 0 }] },
            ],
          },
        },
      },
    } as unknown as SceneDocument;

    const next = enrichTimelineScenesWithPuppet(scenes, document);
    const props = next[0]!.layers[0]!.props;
    const puppet = props.find((p) => p.key === 'puppet');
    expect(puppet).toBeTruthy();
    expect(puppet!.times).toEqual([0, 1]);
  });

  it('skips non-image layers', () => {
    const scenes: LottieTimelineScene[] = [
      {
        id: 'main',
        label: 'Main',
        kind: 'main',
        fr: 30,
        ip: 0,
        op: 30,
        durationSec: 1,
        layers: [
          {
            id: 'layer-2-shape',
            ind: 2,
            name: 'Rect',
            sceneNodeId: 'sh1',
            clipKind: 'element',
            inSec: 0,
            outSec: 1,
            props: [],
          },
        ],
      },
    ];
    const document = {
      deltaSetLike: {
        sh1: { id: 'sh1', key: 'shape', attrs: { puppetEnabled: true } },
      },
    } as unknown as SceneDocument;
    const next = enrichTimelineScenesWithPuppet(scenes, document);
    expect(next[0]!.layers[0]!.props.some((p) => p.key === 'puppet')).toBe(false);
  });
});
