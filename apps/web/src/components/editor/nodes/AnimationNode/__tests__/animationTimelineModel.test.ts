import { describe, expect, it } from 'vitest';
import { buildLottieTimelineScenes } from '../animationTimelineModel';
import {
  moveTransformKeyframe,
  readTransformKeyframe,
  removeTransformKeyframe,
  setCompWorkArea,
  setLayerTimeRange,
  setTransformKeyframeEasing,
  setTransformKeyframeValue,
  upsertTransformKeyframe,
} from '../animationTimelineMutate';

describe('animationTimelineModel', () => {
  it('builds Main Scene and precomp tabs with keyframe marks', () => {
    const anim = {
      fr: 30,
      ip: 0,
      op: 60,
      w: 100,
      h: 100,
      nm: 'Root',
      layers: [
        {
          ind: 1,
          nm: 'Square',
          ip: 0,
          op: 60,
          ks: {
            p: {
              a: 1,
              k: [
                { t: 0, s: [0, 0, 0] },
                { t: 30, s: [50, 50, 0] },
              ],
            },
            o: { a: 0, k: 100 },
          },
        },
      ],
      assets: [
        {
          id: 'comp_1',
          nm: 'Blue Square Bounce',
          layers: [
            {
              ind: 1,
              nm: 'Inner',
              ip: 0,
              op: 30,
              ks: {
                s: {
                  a: 1,
                  k: [
                    { t: 0, s: [100, 100, 100] },
                    { t: 15, s: [120, 120, 100] },
                  ],
                },
              },
            },
          ],
        },
        { id: 'img_1', w: 10, h: 10, p: 'a.png', u: '' },
      ],
    };

    const scenes = buildLottieTimelineScenes(anim, 'Plate');
    expect(scenes[0].id).toBe('main');
    expect(scenes[0].label).toBe('Main Scene');
    expect(scenes[0].durationSec).toBe(2);
    expect(scenes[0].layers[0].name).toBe('Square');
    expect(scenes[0].layers[0].props[0].label).toBe('Position');
    expect(scenes[0].layers[0].props[0].times).toEqual([0, 1]);

    expect(scenes).toHaveLength(2);
    expect(scenes[1].label).toBe('Blue Square Bounce');
    expect(scenes[1].layers[0].props[0].label).toBe('Scale');
  });

  it('can include empty transform tracks when expanding', () => {
    const anim = {
      fr: 30,
      ip: 0,
      op: 30,
      layers: [
        {
          ind: 2,
          nm: 'Box',
          ip: 0,
          op: 30,
          ks: { o: { a: 0, k: 100 } },
        },
      ],
      assets: [],
    };
    const scenes = buildLottieTimelineScenes(anim, undefined, { includeEmptyProps: true });
    expect(scenes[0].layers[0].props.map((p) => p.key)).toEqual([
      'p',
      's',
      'r',
      'o',
      'a',
      'sk',
      'sa',
    ]);
  });
});

describe('animationTimelineMutate', () => {
  const base = {
    fr: 30,
    ip: 0,
    op: 60,
    layers: [
      {
        ind: 1,
        nm: 'Square',
        ip: 0,
        op: 60,
        ks: {
          o: { a: 0, k: 100 },
        },
      },
    ],
    assets: [],
  };

  it('upserts / moves / removes opacity keyframes', () => {
    const added = upsertTransformKeyframe({
      animationData: base,
      sceneKind: 'main',
      layerInd: 1,
      propKey: 'o',
      frame: 15,
    });
    expect(added).toBeTruthy();
    const o = (added!.layers as any[])[0].ks.o;
    expect(o.a).toBe(1);
    expect(o.k.some((k: any) => k.t === 15)).toBe(true);

    const moved = moveTransformKeyframe({
      animationData: added!,
      sceneKind: 'main',
      layerInd: 1,
      propKey: 'o',
      fromFrame: 15,
      toFrame: 30,
    });
    const o2 = (moved!.layers as any[])[0].ks.o;
    expect(o2.k.some((k: any) => k.t === 30)).toBe(true);
    expect(o2.k.some((k: any) => k.t === 15)).toBe(false);

    const removed = removeTransformKeyframe({
      animationData: moved!,
      sceneKind: 'main',
      layerInd: 1,
      propKey: 'o',
      frame: 30,
    });
    const o3 = (removed!.layers as any[])[0].ks.o;
    expect(o3.k?.some?.((k: any) => k.t === 30)).toBeFalsy();
  });

  it('updates layer in/out range', () => {
    const next = setLayerTimeRange({
      animationData: {
        fr: 30,
        ip: 0,
        op: 90,
        layers: [{ ind: 1, nm: 'A', ip: 0, op: 60, st: 0, ks: {} }],
        assets: [],
      },
      sceneKind: 'main',
      layerInd: 1,
      inFrame: 10,
      outFrame: 40,
    });
    expect((next!.layers as any[])[0].ip).toBe(10);
    expect((next!.layers as any[])[0].op).toBe(40);
    expect((next!.layers as any[])[0].st).toBe(10);
  });

  it('updates composition work area ip/op', () => {
    const next = setCompWorkArea({
      animationData: { fr: 30, ip: 0, op: 150, layers: [], assets: [] },
      sceneKind: 'main',
      inFrame: 6,
      outFrame: 120,
    });
    expect(next!.ip).toBe(6);
    expect(next!.op).toBe(120);
  });

  it('applies easing presets between keyframes', () => {
    const anim = {
      fr: 30,
      ip: 0,
      op: 60,
      layers: [
        {
          ind: 1,
          nm: 'A',
          ip: 0,
          op: 60,
          ks: {
            o: {
              a: 1,
              k: [
                { t: 0, s: [0] },
                { t: 30, s: [100] },
              ],
            },
          },
        },
      ],
      assets: [],
    };
    const eased = setTransformKeyframeEasing({
      animationData: anim,
      sceneKind: 'main',
      layerInd: 1,
      propKey: 'o',
      frame: 0,
      preset: 'easeOut',
    });
    const k = (eased!.layers as any[])[0].ks.o.k;
    expect(k[0].o.x[0]).toBe(0);
    expect(k[1].i.y[0]).toBe(1);

    const held = setTransformKeyframeEasing({
      animationData: eased!,
      sceneKind: 'main',
      layerInd: 1,
      propKey: 'o',
      frame: 0,
      preset: 'hold',
    });
    expect((held!.layers as any[])[0].ks.o.k[0].h).toBe(1);
  });

  it('samples mid-span values when inserting keyframes', () => {
    const anim = {
      fr: 30,
      ip: 0,
      op: 60,
      layers: [
        {
          ind: 1,
          nm: 'A',
          ip: 0,
          op: 60,
          ks: {
            o: {
              a: 1,
              k: [
                { t: 0, s: [0] },
                { t: 30, s: [100] },
              ],
            },
          },
        },
      ],
      assets: [],
    };
    const mid = upsertTransformKeyframe({
      animationData: anim,
      sceneKind: 'main',
      layerInd: 1,
      propKey: 'o',
      frame: 15,
    });
    const row = (mid!.layers as any[])[0].ks.o.k.find((k: any) => k.t === 15);
    expect(row.s[0]).toBe(50);
  });

  it('reads and writes keyframe values', () => {
    const anim = {
      fr: 30,
      ip: 0,
      op: 60,
      layers: [
        {
          ind: 1,
          nm: 'A',
          ip: 0,
          op: 60,
          ks: {
            p: {
              a: 1,
              k: [
                { t: 0, s: [0, 0, 0] },
                { t: 30, s: [100, 50, 0] },
              ],
            },
          },
        },
      ],
      assets: [],
    };
    const read = readTransformKeyframe({
      animationData: anim,
      sceneKind: 'main',
      layerInd: 1,
      propKey: 'p',
      frame: 30,
    });
    expect(read?.value).toEqual([100, 50, 0]);

    const written = setTransformKeyframeValue({
      animationData: anim,
      sceneKind: 'main',
      layerInd: 1,
      propKey: 'p',
      frame: 30,
      value: [10, 20, 0],
    });
    const again = readTransformKeyframe({
      animationData: written!,
      sceneKind: 'main',
      layerInd: 1,
      propKey: 'p',
      frame: 30,
    });
    expect(again?.value).toEqual([10, 20, 0]);
  });
});
