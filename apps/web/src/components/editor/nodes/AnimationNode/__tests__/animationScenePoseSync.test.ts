import { describe, expect, it } from 'vitest';
import { buildScenePosePatchesFromAnimation } from '../animationScenePoseSync';
import { upsertTransformKeyframe } from '../animationTimelineMutate';

describe('buildScenePosePatchesFromAnimation', () => {
  it('maps edited position keyframes onto scene node xy', () => {
    let anim: Record<string, unknown> = {
      fr: 30,
      w: 400,
      h: 400,
      layers: [
        {
          ind: 1,
          ln: 'shape1',
          w: 80,
          h: 60,
          ks: {
            p: { a: 0, k: [100, 100, 0] },
            s: { a: 0, k: [100, 100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
            a: { a: 0, k: [0, 0, 0] },
          },
        },
      ],
    };
    anim = upsertTransformKeyframe({
      animationData: anim,
      sceneKind: 'main',
      layerInd: 1,
      propKey: 'p',
      frame: 0,
      value: [200, 150, 0],
    })!;

    const document = {
      deltaSetLike: {
        shape1: {
          id: 'shape1',
          key: 'shape',
          x: 60,
          y: 70,
          width: 80,
          height: 60,
          attrs: { opacity: 100 },
        },
      },
    };
    const patches = buildScenePosePatchesFromAnimation({
      document,
      animationData: anim,
      playheadSec: 0,
      layerInds: [1],
      plate: { left: 0, top: 0, width: 400, height: 400 },
    });
    expect(patches).toHaveLength(1);
    // Center 200,150 → top-left 160,120 for 80×60 box.
    expect(patches[0]!.x).toBeCloseTo(160, 5);
    expect(patches[0]!.y).toBeCloseTo(120, 5);
    expect(patches[0]!.width).toBeCloseTo(80, 5);
    expect(patches[0]!.height).toBeCloseTo(60, 5);
  });
});
