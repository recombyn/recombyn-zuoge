import { describe, expect, it } from 'vitest';
import {
  liveSceneValueForTransformProp,
  sampleLayerTransformAtFrame,
  upsertTransformKeyframe,
} from '../animationTimelineMutate';

describe('sampleLayerTransformAtFrame', () => {
  it('lerps rotation between keyframes for scrub preview', () => {
    let anim: Record<string, unknown> = {
      v: '5.7.4',
      fr: 30,
      ip: 0,
      op: 60,
      w: 200,
      h: 200,
      layers: [
        {
          ind: 1,
          ty: 4,
          nm: 'shape',
          ln: 'node1',
          w: 100,
          h: 100,
          ks: {
            p: { a: 0, k: [100, 100, 0] },
            a: { a: 0, k: [0, 0, 0] },
            s: { a: 0, k: [100, 100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
          ip: 0,
          op: 60,
        },
      ],
    };
    anim = upsertTransformKeyframe({
      animationData: anim,
      sceneKind: 'main',
      layerInd: 1,
      propKey: 'r',
      frame: 0,
      value: 0,
    })!;
    anim = upsertTransformKeyframe({
      animationData: anim,
      sceneKind: 'main',
      layerInd: 1,
      propKey: 'r',
      frame: 30,
      value: -60,
    })!;
    const mid = sampleLayerTransformAtFrame({
      animationData: anim,
      sceneKind: 'main',
      layerInd: 1,
      frame: 15,
    });
    expect(mid?.rotation).toBeCloseTo(-30, 5);
    expect(mid?.cx).toBe(100);
  });

  it('uses live canvas angle when adding a second rotation keyframe', () => {
    // Simulate: first KF samples static r=0; user rotates canvas to 25°;
    // second KF must capture attrs.angle or both keys stay 0 → no play motion.
    let anim: Record<string, unknown> = {
      v: '5.7.4',
      fr: 30,
      ip: 0,
      op: 60,
      w: 200,
      h: 200,
      layers: [
        {
          ind: 1,
          ty: 4,
          nm: 'shape',
          ln: 'node1',
          ks: {
            p: { a: 0, k: [100, 100, 0] },
            a: { a: 0, k: [0, 0, 0] },
            s: { a: 0, k: [100, 100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
          ip: 0,
          op: 60,
        },
      ],
    };
    anim = upsertTransformKeyframe({
      animationData: anim,
      sceneKind: 'main',
      layerInd: 1,
      propKey: 'r',
      frame: 0,
    })!;
    const live = liveSceneValueForTransformProp({ attrs: { angle: 25 } }, 'r');
    expect(live).toBe(25);
    anim = upsertTransformKeyframe({
      animationData: anim,
      sceneKind: 'main',
      layerInd: 1,
      propKey: 'r',
      frame: 12,
      value: live,
    })!;

    const mid = sampleLayerTransformAtFrame({
      animationData: anim,
      sceneKind: 'main',
      layerInd: 1,
      frame: 6,
    });
    expect(mid?.rotation).toBeCloseTo(12.5, 5);
  });
});
