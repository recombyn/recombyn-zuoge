import { describe, expect, it } from 'vitest';
import {
  animationHostHasUnlinkedInk,
  animationHasPlayableContent,
  syncArtboardChildrenIntoAnimation,
} from '../animationFrameSync';
import { buildLottieTimelineScenes } from '../animationTimelineModel';
import { parseLottieAnimationData } from '@/components/rcb/scene/document/nodeFactories';
import type { SceneDocument } from '@/components/rcb/sceneNode';

describe('animationHasPlayableContent', () => {
  it('is false for missing or empty-layer animation', () => {
    expect(animationHasPlayableContent(null)).toBe(false);
    expect(
      animationHasPlayableContent({
        v: '5.7.0',
        fr: 30,
        ip: 0,
        op: 30,
        w: 100,
        h: 100,
        layers: [],
      })
    ).toBe(false);
  });

  it('is true when at least one layer exists', () => {
    expect(
      animationHasPlayableContent({
        v: '5.7.0',
        fr: 30,
        ip: 0,
        op: 30,
        w: 100,
        h: 100,
        layers: [{ ind: 1, ty: 4, ip: 0, op: 30 }],
      })
    ).toBe(true);
  });
});

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
        name: '动画工作台',
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

  it('bakes nested Lottie plates into precomp timeline layers', () => {
    const doc = makeDoc();
    const plateId = 'nested_lottie';
    (doc.deltaSetLike as any)[plateId] = {
      id: plateId,
      key: 'lottie',
      x: 140,
      y: 140,
      width: 120,
      height: 120,
      attrs: {
        frameId: 'frame_lottie',
        name: '五角星生成LOTTIE-edited',
        animationData: JSON.stringify({
          v: '5.7.4',
          fr: 30,
          ip: 0,
          op: 60,
          w: 120,
          h: 120,
          layers: [{ ind: 1, ty: 4, nm: 'star', ip: 0, op: 60, st: 0, ks: {} }],
          assets: [],
        }),
      },
      children: [],
    };

    const synced = syncArtboardChildrenIntoAnimation(doc, 'frame_lottie', 'host_lottie');
    expect(synced).toBeTruthy();
    const anim = parseLottieAnimationData(synced!.animationJson);
    const layers = (anim!.layers as any[]) || [];
    expect(
      layers.some(
        (l) => l.ty === 0 && l.nm === '五角星生成LOTTIE-edited' && String(l.ln) === plateId
      )
    ).toBe(true);
    expect(synced!.childAttrPatches.some((p) => p.nodeId === plateId)).toBe(true);
  });

  it('keeps empty/unlinked tracks above linked artboard children', () => {
    const doc = makeDoc();
    const host = doc.deltaSetLike!.host_lottie as any;
    host.attrs.animationData = JSON.stringify({
      v: '5.7.4',
      fr: 30,
      ip: 0,
      op: 150,
      w: 400,
      h: 400,
      layers: [
        {
          ddd: 0,
          ind: 99,
          ty: 3,
          nm: 'Layer 1',
          sr: 1,
          ks: {},
          ao: 0,
          ip: 0,
          op: 60,
          st: 0,
          bm: 0,
        },
      ],
      assets: [],
    });

    const synced = syncArtboardChildrenIntoAnimation(doc, 'frame_lottie', 'host_lottie');
    expect(synced).toBeTruthy();
    const layers = (parseLottieAnimationData(synced!.animationJson)!.layers as any[]) || [];
    expect(layers[0]?.ty).toBe(3);
    expect(layers[0]?.nm).toBe('Layer 1');
    expect(String(layers[0]?.ln || '')).toBe('');
    expect(layers.some((l) => String(l.ln || '') === 'shape_rect')).toBe(true);
    expect(layers.some((l) => String(l.ln || '') === 'img_can')).toBe(true);
  });

  it('drops linked layers whose scene node was deleted (canvas Delete sync)', () => {
    const doc = makeDoc();
    const host = doc.deltaSetLike!.host_lottie as any;
    host.attrs.animationData = JSON.stringify({
      v: '5.7.4',
      fr: 30,
      ip: 0,
      op: 150,
      w: 400,
      h: 400,
      layers: [
        {
          ind: 1,
          ty: 4,
          nm: 'gone',
          ln: 'shape_rect',
          ip: 0,
          op: 60,
          st: 0,
          ks: {},
        },
        {
          ind: 2,
          ty: 4,
          nm: 'keep',
          ln: 'img_can',
          ip: 0,
          op: 60,
          st: 0,
          ks: {},
        },
      ],
      assets: [],
    });
    // Simulate canvas Delete of the shape — node gone, animation JSON still has ln.
    delete doc.deltaSetLike!.shape_rect;

    const synced = syncArtboardChildrenIntoAnimation(doc, 'frame_lottie', 'host_lottie');
    expect(synced).toBeTruthy();
    const layers = (parseLottieAnimationData(synced!.animationJson)!.layers as any[]) || [];
    expect(layers.some((l) => String(l.ln || '') === 'shape_rect')).toBe(false);
    expect(layers.some((l) => String(l.ln || '') === 'img_can')).toBe(true);
  });
});

describe('animationHostHasUnlinkedInk', () => {
  it('is true for imported layers without ln (need host paint)', () => {
    expect(
      animationHostHasUnlinkedInk({
        v: '5.7.4',
        fr: 30,
        ip: 0,
        op: 60,
        w: 240,
        h: 240,
        layers: [{ ty: 4, ind: 1, nm: 'Blue Square', shapes: [] }],
        assets: [],
      })
    ).toBe(true);
  });

  it('is false when every layer is linked to a scene child', () => {
    expect(
      animationHostHasUnlinkedInk({
        v: '5.7.4',
        fr: 30,
        ip: 0,
        op: 60,
        w: 240,
        h: 240,
        layers: [{ ty: 4, ind: 1, nm: 'Rect', ln: 'shape_1', shapes: [] }],
        assets: [],
      })
    ).toBe(false);
  });

  it('is false for blank composition with no layers', () => {
    expect(
      animationHostHasUnlinkedInk({
        v: '5.7.4',
        fr: 30,
        ip: 0,
        op: 60,
        w: 240,
        h: 240,
        layers: [],
        assets: [],
      })
    ).toBe(false);
  });
});
