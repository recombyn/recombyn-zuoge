import { describe, expect, it } from 'vitest';
import {
  autoKeyAnimatedGeometry,
  autoKeyAnimatedProp,
} from '../animationAutoKey';
import {
  isTransformPropAnimated,
  liveSceneValueForTransformProp,
  sampleLayerTransformAtFrame,
} from '../animationTimelineMutate';

function makeDoc(opts: {
  frameId?: string;
  hostId?: string;
  nodeId?: string;
  anim: Record<string, unknown>;
  nodeAttrs?: Record<string, unknown>;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}) {
  const frameId = opts.frameId || 'frame1';
  const hostId = opts.hostId || 'host1';
  const nodeId = opts.nodeId || 'rect1';
  return {
    frames: [
      {
        id: frameId,
        kind: 'animation',
        x: 0,
        y: 0,
        width: 200,
        height: 200,
      },
    ],
    deltaSetLike: {
      ROOT: { id: 'ROOT', children: [hostId, nodeId] },
      [hostId]: {
        id: hostId,
        key: 'lottie',
        x: 0,
        y: 0,
        width: 200,
        height: 200,
        attrs: {
          frameId,
          animationFrameHost: true,
          animationData: JSON.stringify(opts.anim),
        },
      },
      [nodeId]: {
        id: nodeId,
        key: 'shape',
        x: opts.x ?? 50,
        y: opts.y ?? 50,
        width: opts.width ?? 40,
        height: opts.height ?? 40,
        attrs: {
          frameId,
          lottieLayerInd: 2,
          shapeType: 'rect',
          angle: 0,
          ...(opts.nodeAttrs || {}),
        },
      },
    },
    stackOrder: [`node:${hostId}`, `node:${nodeId}`, `frame:${frameId}`],
  };
}

describe('autoKeyAnimatedProp (rotation)', () => {
  it('writes playhead rotation when r is already animated', () => {
    const anim = {
      v: '5.7.4',
      fr: 30,
      ip: 0,
      op: 60,
      w: 200,
      h: 200,
      layers: [
        {
          ind: 2,
          ty: 4,
          nm: 'shape',
          ln: 'rect1',
          w: 40,
          h: 40,
          ks: {
            p: { a: 0, k: [70, 70, 0] },
            a: { a: 0, k: [0, 0, 0] },
            s: { a: 0, k: [100, 100, 100] },
            r: {
              a: 1,
              k: [
                { t: 0, s: [0] },
                { t: 30, s: [0] },
              ],
            },
            o: { a: 0, k: 100 },
          },
          ip: 0,
          op: 60,
        },
      ],
    };
    expect(
      isTransformPropAnimated({
        animationData: anim,
        sceneKind: 'main',
        layerInd: 2,
        propKey: 'r',
      })
    ).toBe(true);

    const document = makeDoc({ anim, nodeAttrs: { angle: 40 } });
    const keyed = autoKeyAnimatedProp({
      document,
      nodeId: 'rect1',
      propKey: 'r',
      playheadSec: 1,
      value: 40,
    });
    expect(keyed?.hostId).toBe('host1');
    const next = JSON.parse(keyed!.animationJson) as Record<string, unknown>;
    const mid = sampleLayerTransformAtFrame({
      animationData: next,
      sceneKind: 'main',
      layerInd: 2,
      frame: 15,
    });
    expect(mid?.rotation).toBeCloseTo(20, 5);
  });

  it('returns null when rotation is not animated', () => {
    const anim = {
      fr: 30,
      w: 200,
      h: 200,
      layers: [{ ind: 1, ks: { r: { a: 0, k: 0 } } }],
    };
    const document = makeDoc({
      anim,
      nodeAttrs: { lottieLayerInd: 1, angle: 10 },
    });
    // fix layer ind in node
    document.deltaSetLike.rect1.attrs.lottieLayerInd = 1;
    expect(
      autoKeyAnimatedProp({
        document,
        nodeId: 'rect1',
        propKey: 'r',
        playheadSec: 0,
        value: 10,
      })
    ).toBeNull();
  });
});

describe('autoKeyAnimatedProp / geometry', () => {
  it('auto-keys opacity from live attrs', () => {
    const anim = {
      fr: 30,
      w: 200,
      h: 200,
      layers: [
        {
          ind: 2,
          w: 40,
          h: 40,
          ks: {
            o: {
              a: 1,
              k: [
                { t: 0, s: [100] },
                { t: 30, s: [100] },
              ],
            },
            p: { a: 0, k: [70, 70, 0] },
            s: { a: 0, k: [100, 100, 100] },
            r: { a: 0, k: 0 },
            a: { a: 0, k: [0, 0, 0] },
          },
        },
      ],
    };
    const document = makeDoc({ anim, nodeAttrs: { opacity: 40 } });
    const keyed = autoKeyAnimatedProp({
      document,
      nodeId: 'rect1',
      propKey: 'o',
      playheadSec: 1,
    });
    expect(keyed).toBeTruthy();
    const next = JSON.parse(keyed!.animationJson) as Record<string, unknown>;
    const mid = sampleLayerTransformAtFrame({
      animationData: next,
      sceneKind: 'main',
      layerInd: 2,
      frame: 15,
    });
    expect(mid?.opacity).toBeCloseTo(70, 5);
  });

  it('auto-keys position on geometry move', () => {
    const anim = {
      fr: 30,
      w: 200,
      h: 200,
      layers: [
        {
          ind: 2,
          w: 40,
          h: 40,
          ln: 'rect1',
          ks: {
            p: {
              a: 1,
              k: [
                { t: 0, s: [70, 70, 0] },
                { t: 30, s: [70, 70, 0] },
              ],
            },
            s: { a: 0, k: [100, 100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
            a: { a: 0, k: [0, 0, 0] },
          },
        },
      ],
    };
    const document = makeDoc({ anim, x: 100, y: 80, width: 40, height: 40 });
    const liveP = liveSceneValueForTransformProp(
      document.deltaSetLike.rect1,
      'p',
      {
        plate: { left: 0, top: 0, width: 200, height: 200 },
        animW: 200,
        animH: 200,
        layerBaseW: 40,
        layerBaseH: 40,
      }
    );
    expect(Array.isArray(liveP)).toBe(true);
    expect((liveP as number[])[0]).toBeCloseTo(120, 5);
    expect((liveP as number[])[1]).toBeCloseTo(100, 5);

    const keyed = autoKeyAnimatedGeometry({
      document,
      nodeId: 'rect1',
      playheadSec: 1,
      moved: true,
      resized: false,
    });
    expect(keyed).toBeTruthy();
    const next = JSON.parse(keyed!.animationJson) as Record<string, unknown>;
    const end = sampleLayerTransformAtFrame({
      animationData: next,
      sceneKind: 'main',
      layerInd: 2,
      frame: 30,
    });
    expect(end?.cx).toBeCloseTo(120, 5);
    expect(end?.cy).toBeCloseTo(100, 5);
  });

  it('writes static precomp session geometry back into the asset', () => {
    const assetId = 'lot_nested';
    const anim = {
      fr: 30,
      w: 200,
      h: 200,
      layers: [],
      assets: [
        {
          id: assetId,
          w: 200,
          h: 200,
          layers: [
            {
              ind: 3,
              ty: 4,
              nm: 'shape',
              ln: 'shape1',
              w: 40,
              h: 40,
              shapes: [{ ty: 'rc', s: { a: 0, k: [40, 40] } }],
              ks: {
                p: { a: 0, k: [70, 70, 0] },
                a: { a: 0, k: [0, 0, 0] },
                s: { a: 0, k: [100, 100, 100] },
                r: { a: 0, k: 0 },
                o: { a: 0, k: 100 },
              },
            },
          ],
        },
      ],
    };
    const document = makeDoc({
      anim,
      nodeId: 'shape1',
      x: 120,
      y: 100,
      width: 40,
      height: 40,
      nodeAttrs: {
        lottieLayerInd: 3,
        precompEditSession: assetId,
      },
    });
    const keyed = autoKeyAnimatedGeometry({
      document,
      nodeId: 'shape1',
      playheadSec: 0,
      moved: true,
      resized: false,
    });
    expect(keyed).toBeTruthy();
    const next = JSON.parse(keyed!.animationJson) as Record<string, unknown>;
    const end = sampleLayerTransformAtFrame({
      animationData: next,
      sceneKind: 'precomp',
      assetId,
      layerInd: 3,
      frame: 0,
    });
    expect(end?.cx).toBeCloseTo(140, 5);
    expect(end?.cy).toBeCloseTo(120, 5);
  });

  it('frameLocal: precomp writeback ignores world frame origin', () => {
    // Bug dump: local (86,86) + frame (-101,234) → wrongly wrote (187,-148).
    const assetId = 'lot_nested';
    const anim = {
      fr: 30,
      w: 285,
      h: 285,
      layers: [],
      assets: [
        {
          id: assetId,
          w: 285,
          h: 285,
          layers: [
            {
              ind: 3,
              ty: 4,
              nm: 'Blue Square',
              ln: 'shape1',
              w: 113,
              h: 113,
              shapes: [{ ty: 'rc', s: { a: 0, k: [113, 113] } }],
              ks: {
                p: {
                  a: 1,
                  k: [
                    { t: 0, s: [142.5, 142.5, 0] },
                    { t: 30, s: [142.5, 142.5, 0] },
                  ],
                },
                a: { a: 0, k: [0, 0, 0] },
                s: { a: 0, k: [100, 100, 100] },
                r: { a: 0, k: 0 },
                o: { a: 0, k: 100 },
              },
            },
          ],
        },
      ],
    };
    const document = {
      ...makeDoc({
        anim,
        nodeId: 'shape1',
        x: 86.09,
        y: 86.09,
        width: 112.81,
        height: 112.81,
        nodeAttrs: {
          lottieLayerInd: 3,
          precompEditSession: assetId,
        },
      }),
      coordSpace: 'frameLocal',
      frames: [
        {
          id: 'frame1',
          kind: 'animation',
          x: -101,
          y: 234,
          width: 285,
          height: 285,
        },
      ],
    };
    const keyed = autoKeyAnimatedGeometry({
      document,
      nodeId: 'shape1',
      playheadSec: 0,
      moved: true,
      resized: false,
    });
    expect(keyed).toBeTruthy();
    const next = JSON.parse(keyed!.animationJson) as Record<string, unknown>;
    const at0 = sampleLayerTransformAtFrame({
      animationData: next,
      sceneKind: 'precomp',
      assetId,
      layerInd: 3,
      frame: 0,
    });
    expect(at0?.cx).toBeCloseTo(86.09 + 112.81 / 2, 1);
    expect(at0?.cy).toBeCloseTo(86.09 + 112.81 / 2, 1);
    // Must NOT be the double-subtracted world coords (187 / -148 centers).
    expect(at0?.cx).toBeLessThan(200);
    expect(at0?.cy).toBeGreaterThan(0);
  });

  it('captures scale percent relative to layer base', () => {
    const node = {
      key: 'shape',
      x: 0,
      y: 0,
      width: 80,
      height: 40,
      attrs: {},
    };
    const s = liveSceneValueForTransformProp(node, 's', {
      plate: { left: 0, top: 0, width: 200, height: 200 },
      animW: 200,
      animH: 200,
      layerBaseW: 40,
      layerBaseH: 40,
    });
    expect(s).toEqual([200, 100, 100]);
  });
});
