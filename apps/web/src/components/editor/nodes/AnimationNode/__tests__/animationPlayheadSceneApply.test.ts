import { describe, expect, it } from 'vitest';
import { createEmptyDocument, addNodeToDocument } from '@/components/rcb/scene/document/sceneDocument';
import { serializeLottieAnimationData } from '@/components/rcb/scene/document/nodeFactories';
import {
  collectPrecompSessionDocumentPatches,
  resolvePrecompSessionShapePose,
} from '../animationPlayheadSceneApply';
import { PRECOMP_EDIT_SESSION_ATTR } from '../animationPrecompSession';

describe('collectPrecompSessionDocumentPatches', () => {
  it('writes playhead-sampled pose into document for keyed session shapes', () => {
    const assetId = 'lot_child';
    const anim = {
      fr: 30,
      w: 240,
      h: 240,
      layers: [],
      assets: [
        {
          id: assetId,
          w: 240,
          h: 240,
          layers: [
            {
              ind: 2,
              ty: 4,
              nm: 'Blue Square',
              ln: 'shape1',
              w: 80,
              h: 80,
              ip: 0,
              op: 60,
              shapes: [{ ty: 'rc', s: { a: 0, k: [80, 80] } }],
              ks: {
                p: {
                  a: 1,
                  k: [
                    { t: 0, s: [120, 120, 0] },
                    { t: 30, s: [120, 60, 0] },
                  ],
                },
                s: { a: 0, k: [100, 100, 100] },
                r: { a: 0, k: 0 },
                o: { a: 0, k: 100 },
              },
            },
          ],
        },
      ],
    };
    let doc = createEmptyDocument({ emptyWorld: true });
    (doc as any).frames = [
      { id: 'af1', kind: 'animation', x: 100, y: 80, width: 240, height: 240 },
    ];
    doc = addNodeToDocument(doc, 'host1', {
      id: 'host1',
      key: 'lottie',
      x: 100,
      y: 80,
      width: 240,
      height: 240,
      attrs: {
        frameId: 'af1',
        animationFrameHost: true,
        animationData: serializeLottieAnimationData(anim),
      },
      children: [],
    } as any);
    doc = addNodeToDocument(doc, 'shape1', {
      id: 'shape1',
      key: 'shape',
      x: 140,
      y: 140,
      width: 80,
      height: 80,
      attrs: {
        frameId: 'af1',
        lottieLayerInd: 2,
        [PRECOMP_EDIT_SESSION_ATTR]: assetId,
        angle: 0,
      },
      children: [],
    } as any);

    const patches = collectPrecompSessionDocumentPatches({
      document: doc,
      hostNodeId: 'host1',
      playheadSec: 0.5,
    });
    expect(patches).toHaveLength(1);
    expect(patches[0]!.nodeId).toBe('shape1');
    expect(patches[0]!.patch.y).toBeLessThan(140);

    const pose = resolvePrecompSessionShapePose({
      anim,
      sceneKind: 'precomp',
      assetId,
      layerInd: 2,
      frameN: 15,
      plate: { left: 100, top: 80, width: 240, height: 240 },
      localAnimW: 240,
      localAnimH: 240,
      raw: (anim.assets as any[])[0].layers[0],
      node: doc.deltaSetLike!.shape1,
    });
    expect(pose?.top).toBeCloseTo(patches[0]!.patch.y, 1);
  });
});
