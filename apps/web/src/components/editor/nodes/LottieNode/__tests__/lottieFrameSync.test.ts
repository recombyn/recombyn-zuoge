import { describe, expect, it } from 'vitest';
import { syncArtboardChildrenIntoAnimation } from '../lottieFrameSync';
import { buildLottieTimelineScenes } from '../lottieTimelineModel';
import { parseLottieAnimationData } from '@/components/rcb/scene/document/nodeFactories';
import type { SceneDocument } from '@/components/rcb/sceneNode';

function makeDoc(): SceneDocument {
  const frameId = 'frame_lottie';
  const hostId = 'host_lottie';
  const rectId = 'shape_rect';
  const imgId = 'img_can';
  return {
    id: 'doc',
    width: 1200,
    height: 800,
    activeFrameId: frameId,
    frames: [
      {
        id: frameId,
        x: 100,
        y: 100,
        width: 400,
        height: 400,
        kind: 'lottie',
        name: 'Lottie 合成台',
        durationSec: 5,
        fps: 30,
      } as any,
    ],
    deltaSetLike: {
      [hostId]: {
        id: hostId,
        key: 'lottie',
        x: 100,
        y: 100,
        width: 400,
        height: 400,
        attrs: {
          frameId,
          lottieFrameHost: true,
          animationData: JSON.stringify({
            v: '5.7.4',
            fr: 30,
            ip: 0,
            op: 150,
            w: 400,
            h: 400,
            layers: [],
            assets: [],
          }),
        },
      },
      [rectId]: {
        id: rectId,
        key: 'shape',
        x: 140,
        y: 160,
        width: 80,
        height: 60,
        attrs: {
          frameId,
          frameOrder: 1,
          name: '矩形',
          shapeType: 'rect',
          'fill-color': '#3B82F6',
        },
      },
      [imgId]: {
        id: imgId,
        key: 'image',
        x: 220,
        y: 200,
        width: 120,
        height: 120,
        attrs: {
          frameId,
          frameOrder: 2,
          name: 'Can',
          src: 'data:image/png;base64,aaaa',
        },
      },
    },
    stackOrder: [`node:${hostId}`, `node:${rectId}`, `node:${imgId}`, `frame:${frameId}`],
  } as any;
}

describe('syncArtboardChildrenIntoAnimation', () => {
  it('bakes shapes and images into host layers for the timeline', () => {
    const doc = makeDoc();
    const synced = syncArtboardChildrenIntoAnimation(doc, 'frame_lottie', 'host_lottie');
    expect(synced).toBeTruthy();
    const anim = parseLottieAnimationData(synced!.animationJson);
    expect(anim).toBeTruthy();
    const layers = anim!.layers as any[];
    expect(layers.length).toBeGreaterThanOrEqual(2);
    // New artboard children without trim attrs default to ~2s (not full composition).
    expect(layers.some((l) => l.ty === 4 && l.nm === '矩形' && Number(l.ip) === 0 && Number(l.op) === 60)).toBe(
      true
    );
    expect(layers.some((l) => l.ty === 2 && l.nm === 'Can' && Number(l.op) === 60)).toBe(true);
    expect(synced!.childAttrPatches.some((p) => p.lottieInFrame === 0 && p.lottieOutFrame === 60)).toBe(
      true
    );

    const scenes = buildLottieTimelineScenes(anim, 'test', { includeEmptyProps: true });
    expect(scenes[0].layers.length).toBeGreaterThanOrEqual(2);
    expect(scenes[0].layers.every((l) => l.props.length >= 5)).toBe(true);
  });
});
