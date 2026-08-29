import { describe, expect, it } from 'vitest';
import {
  linkedLotNodeIdFromAsset,
  parsePrecompEditableLayers,
  patchPrecompLayerGeometry,
  patchPrecompPositionKeyframe,
  samplePositionAtTime,
} from '../animationPrecompEditModel';

const hostAnim = {
  v: '5.7.4',
  fr: 30,
  ip: 0,
  op: 60,
  w: 200,
  h: 200,
  assets: [
    {
      id: 'lot_child1',
      nm: 'Blue Square Bounce_1',
      w: 240,
      h: 240,
      layers: [
        {
          ind: 1,
          ty: 4,
          nm: 'Rect',
          ks: {
            p: {
              a: 1,
              k: [
                { t: 0, s: [120, 80, 0] },
                { t: 30, s: [120, 160, 0] },
              ],
            },
            a: { a: 0, k: [0, 0, 0] },
            s: { a: 0, k: [100, 100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
          shapes: [
            {
              ty: 'rc',
              s: { a: 0, k: [100, 100] },
              p: { a: 0, k: [0, 0] },
              r: { a: 0, k: 12 },
            },
            {
              ty: 'fl',
              c: { a: 0, k: [0.2, 0.4, 1, 1] },
              o: { a: 0, k: 100 },
            },
          ],
          ip: 0,
          op: 60,
        },
      ],
    },
  ],
  layers: [],
};

describe('animationPrecompEditModel', () => {
  it('parses shape layers and position keyframes from a precomp asset', () => {
    const layers = parsePrecompEditableLayers(hostAnim, 'lot_child1');
    expect(layers).toHaveLength(1);
    expect(layers[0].ind).toBe(1);
    expect(layers[0].w).toBe(100);
    expect(layers[0].h).toBe(100);
    expect(layers[0].positionKfs).toHaveLength(2);
    expect(layers[0].positionKfs[1].y).toBe(160);
  });

  it('resolves linked lot node id from asset id', () => {
    expect(linkedLotNodeIdFromAsset('lot_abc')).toBe('abc');
    expect(linkedLotNodeIdFromAsset('comp_1')).toBeNull();
  });

  it('patches geometry and keyframe position', () => {
    const geom = patchPrecompLayerGeometry({
      hostAnimationData: hostAnim,
      assetId: 'lot_child1',
      layerInd: 1,
      cx: 100,
      cy: 100,
      w: 80,
      h: 60,
    });
    expect(geom).toBeTruthy();
    const next = parsePrecompEditableLayers(geom, 'lot_child1');
    expect(next[0].w).toBe(80);
    expect(next[0].h).toBe(60);

    const kf = patchPrecompPositionKeyframe({
      hostAnimationData: hostAnim,
      assetId: 'lot_child1',
      layerInd: 1,
      frame: 30,
      x: 50,
      y: 90,
    });
    expect(kf).toBeTruthy();
    const after = parsePrecompEditableLayers(kf, 'lot_child1');
    expect(after[0].positionKfs.find((k) => k.frame === 30)?.x).toBe(50);
  });

  it('samples position between keyframes at playhead time', () => {
    const layers = parsePrecompEditableLayers(hostAnim, 'lot_child1');
    const mid = samplePositionAtTime(layers[0].positionKfs, 0.5); // frame 15 @ 30fps
    expect(mid).toEqual({ x: 120, y: 120 });
    const hold = samplePositionAtTime(layers[0].positionKfs, 2);
    expect(hold).toEqual({ x: 120, y: 160 });
  });
});
