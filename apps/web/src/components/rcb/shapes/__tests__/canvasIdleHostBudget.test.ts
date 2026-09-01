import { describe, expect, it } from 'vitest';
import { canIdlePaintOnCanvas, canvasIdleIsStrokeOnly, pickFullAndCanvasIds } from '../RcbShapesLayer';
import { HEAVY_PATH_D_CHARS } from '@/components/rcb/scene/document/sceneShapes';
import type { SceneDocument } from '@/components/rcb/sceneNode';

function makeDoc(nodes: Record<string, any>): SceneDocument {
  const children = Object.keys(nodes);
  return {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    deltaSetLike: {
      ROOT: { id: 'ROOT', key: 'entry', x: 0, y: 0, width: 0, height: 0, attrs: {}, children },
      ...nodes,
    },
  } as SceneDocument;
}

function rect(id: string, w = 40, h = 40) {
  return {
    id,
    key: 'shape',
    x: 0,
    y: 0,
    width: w,
    height: h,
    attrs: { shapeType: 'rect', 'fill-color': '#abc', 'stroke-enabled': false },
  };
}

function textNode(id: string) {
  return {
    id,
    key: 'text',
    x: 0,
    y: 0,
    width: 80,
    height: 24,
    attrs: {
      fontSize: 14,
      ORIGIN_DATA: JSON.stringify([{ children: [{ text: 'Hi' }] }]),
    },
  };
}

function imageNode(id: string) {
  return {
    id,
    key: 'image',
    x: 0,
    y: 0,
    width: 80,
    height: 60,
    attrs: { src: 'https://example.com/a.png' },
  };
}

function lightPen(id: string) {
  return {
    id,
    key: 'shape',
    x: 0,
    y: 0,
    width: 50,
    height: 20,
    attrs: { shapeType: 'pen', path: 'M0 10 L50 10', 'border-color': '#000', 'border-width': 2 },
  };
}

function heavy(id: string) {
  return {
    id,
    x: 0,
    y: 0,
    width: 40,
    height: 40,
    attrs: {
      shapeType: 'path',
      path: 'M0 0 ' + 'L1 1 '.repeat(HEAVY_PATH_D_CHARS),
    },
  };
}

describe('pickFullAndCanvasIds (single ink path)', () => {
  it('puts basic rects on canvas ink, not DOM hosts', () => {
    const nodes: Record<string, any> = {};
    for (let i = 0; i < 20; i += 1) nodes[`n${i}`] = rect(`n${i}`);
    const doc = makeDoc(nodes);
    const ids = Object.keys(nodes);
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ids,
      zoom: 1,
    });
    expect(fullIds).toHaveLength(0);
    expect(canvasIds).toHaveLength(20);
  });

  it('keeps media process hosts; static image/text and light pen on canvas ink', () => {
    const doc = makeDoc({
      t0: textNode('t0'),
      p0: lightPen('p0'),
      i0: imageNode('i0'),
    });
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ['t0', 'p0', 'i0'],
      zoom: 1,
    });
    expect(fullIds).toEqual([]);
    expect(canvasIds.sort()).toEqual(['i0', 'p0', 't0']);
  });

  it('forceFullSet keeps a canvas-ink node as a DOM host', () => {
    const nodes: Record<string, any> = {};
    for (let i = 0; i < 40; i += 1) nodes[`n${i}`] = rect(`n${i}`);
    const doc = makeDoc(nodes);
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: Object.keys(nodes),
      forceFullSet: new Set(['n0']),
      zoom: 0.15,
    });
    expect(fullIds).toEqual(['n0']);
    expect(canvasIds).not.toContain('n0');
    expect(canvasIds.length).toBe(39);
  });

  it('holdHostIds keeps demote-candidate as DOM host', () => {
    const doc = makeDoc({ n0: rect('n0'), n1: rect('n1') });
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ['n0', 'n1'],
      zoom: 1,
      holdHostIds: new Set(['n0']),
    });
    expect(fullIds).toContain('n0');
    expect(canvasIds).toContain('n1');
    expect(canvasIds).not.toContain('n0');
  });

  it('caps canvas ink count when maxCanvasInk is set', () => {
    const nodes: Record<string, any> = {};
    for (let i = 0; i < 5000; i += 1) nodes[`n${i}`] = rect(`n${i}`);
    const doc = makeDoc(nodes);
    const ids = Object.keys(nodes);
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ids,
      zoom: 1,
      maxCanvasInk: 128,
    });
    expect(fullIds.length).toBe(0);
    expect(canvasIds.length).toBeLessThanOrEqual(128);
  });

  it('canvas-ink basic/poly/stroke/grad/text/image; DOM only when forceFull', () => {
    const doc = makeDoc({
      basic: rect('basic'),
      stroke: {
        id: 'stroke',
        key: 'shape',
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        attrs: {
          shapeType: 'rect',
          'fill-color': '#abc',
          'stroke-enabled': true,
          'border-color': '#000',
          'border-width': 2,
          strokeAlign: 'center',
        },
      },
      grad: {
        id: 'grad',
        key: 'shape',
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        attrs: {
          shapeType: 'rect',
          'fill-type': 'linear',
          'fill-gradient': '{}',
          'stroke-enabled': false,
        },
      },
      poly: {
        id: 'poly',
        key: 'shape',
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        attrs: { shapeType: 'polygon', sides: 5, 'fill-color': '#abc', 'stroke-enabled': false },
      },
      t0: textNode('t0'),
      i0: imageNode('i0'),
    });
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ['basic', 'stroke', 'grad', 'poly', 't0', 'i0'],
      zoom: 1,
    });
    expect(canvasIds.sort()).toEqual(['basic', 'grad', 'i0', 'poly', 'stroke', 't0']);
    expect(fullIds).toEqual([]);
  });

  it('forceFull selected video stays DOM host; idle video on canvas poster', () => {
    const video = {
      id: 'v0',
      key: 'video',
      x: 0,
      y: 0,
      width: 160,
      height: 90,
      attrs: { src: 'https://example.com/a.mp4', poster: 'https://example.com/p.png' },
    };
    const doc = makeDoc({ v0: video, n0: rect('n0') });
    const idle = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ['v0', 'n0'],
      zoom: 1,
    });
    expect(idle.fullIds).toEqual([]);
    expect(idle.canvasIds.sort()).toEqual(['n0', 'v0']);
    const selected = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ['v0', 'n0'],
      forceFullSet: new Set(['v0']),
      zoom: 1,
    });
    expect(selected.fullIds).toEqual(['v0']);
    expect(selected.canvasIds).toEqual(['n0']);
  });

  it('multi-select videos: only the active decoder is a DOM host', () => {
    const mkVideo = (id: string) => ({
      id,
      key: 'video',
      x: 0,
      y: 0,
      width: 160,
      height: 90,
      attrs: { src: `https://example.com/${id}.mp4` },
    });
    const doc = makeDoc({ v0: mkVideo('v0'), v1: mkVideo('v1'), n0: rect('n0') });
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ['v0', 'v1', 'n0'],
      forceFullSet: new Set(['v1']),
      zoom: 1,
    });
    expect(fullIds).toEqual(['v1']);
    expect(canvasIds.sort()).toEqual(['n0', 'v0']);
  });

  it('heavy paths stay DOM hosts; idle images paint on canvas', () => {
    const nodes: Record<string, any> = {
      heavy: heavy('heavy'),
      big: rect('big', 400, 400),
    };
    for (let i = 0; i < 10; i += 1) nodes[`img${i}`] = imageNode(`img${i}`);
    const doc = makeDoc(nodes);
    const ids = Object.keys(nodes);
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ids,
      zoom: 1,
    });
    expect(fullIds).toContain('heavy');
    expect(fullIds).not.toContain('img0');
    expect(canvasIds).toContain('big');
    expect(canvasIds).toContain('img0');
  });
});

describe('canIdlePaintOnCanvas', () => {
  it('accepts solid rects and static text; rejects lottie', () => {
    expect(canIdlePaintOnCanvas(rect('n0'))).toBe(true);
    expect(canIdlePaintOnCanvas(textNode('t0'))).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        id: 'l0',
        key: 'lottie',
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        attrs: {},
      } as never)
    ).toBe(false);
  });

  it('canvasIdleIsStrokeOnly for stroke-only pens', () => {
    expect(canvasIdleIsStrokeOnly(lightPen('p0'))).toBe(true);
    expect(canvasIdleIsStrokeOnly(rect('n0'))).toBe(false);
  });

  it('evenodd paths and donut ellipses idle on canvas', () => {
    expect(
      canIdlePaintOnCanvas({
        id: 'bool',
        key: 'shape',
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        attrs: {
          shapeType: 'path',
          path: 'M0 0 H100 V80 H0 Z M20 20 H80 V60 H20 Z',
          closed: 'true',
          'fill-rule': 'evenodd',
          'fill-color': '#ffffff',
        },
      } as never)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        id: 'donut',
        key: 'shape',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        attrs: { shapeType: 'ellipse', ellipseInnerRatio: 0.5, 'fill-color': '#ccc' },
      } as never)
    ).toBe(true);
  });

  it('outside/inside strokeAlign paint on canvas (no ShapeHost)', () => {
    expect(
      canIdlePaintOnCanvas({
        id: 'out',
        key: 'shape',
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        attrs: {
          shapeType: 'rect',
          'fill-color': '#fff',
          'stroke-enabled': true,
          'border-width': 4,
          'border-color': '#000',
          strokeAlign: 'outside',
        },
      } as never)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        id: 'in',
        key: 'shape',
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        attrs: {
          shapeType: 'rect',
          'fill-color': '#fff',
          'stroke-enabled': true,
          'border-width': 4,
          'border-color': '#000',
          strokeAlign: 'inside',
        },
      } as never)
    ).toBe(true);
  });

  it('object blur / inner-shadow / multiply blend idle on canvas; backdrop-blur stays DOM', () => {
    expect(
      canIdlePaintOnCanvas({
        id: 'blur',
        key: 'shape',
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        attrs: { shapeType: 'rect', 'fill-color': '#fff', 'blur-enabled': true, 'blur-amount': 8 },
      } as never)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        id: 'inner',
        key: 'shape',
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        attrs: {
          shapeType: 'rect',
          'fill-color': '#fff',
          'inner-shadow-enabled': true,
          'inner-shadow-visible': true,
          'inner-shadow-blur': 4,
          'inner-shadow-y': 2,
        },
      } as never)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        id: 'mul',
        key: 'shape',
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        attrs: { shapeType: 'rect', 'fill-color': '#f00', blendMode: 'multiply' },
      } as never)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        id: 'bd',
        key: 'shape',
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        attrs: {
          shapeType: 'rect',
          'fill-color': '#fff',
          'backdrop-blur-enabled': true,
          'backdrop-blur-amount': 12,
        },
      } as never)
    ).toBe(false);
  });
});
