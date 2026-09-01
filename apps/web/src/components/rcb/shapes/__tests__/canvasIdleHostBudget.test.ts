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

  it('keeps text and media as DOM hosts; light pen on canvas ink', () => {
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
    expect(fullIds.sort()).toEqual(['i0', 't0']);
    expect(canvasIds).toEqual(['p0']);
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

  it('canvas-ink basic/poly/stroke/grad; DOM for text/media', () => {
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
    expect(canvasIds.sort()).toEqual(['basic', 'grad', 'poly', 'stroke']);
    expect(fullIds.sort()).toEqual(['i0', 't0']);
  });

  it('heavy paths stay DOM hosts; images stay DOM hosts', () => {
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
    expect(fullIds).toContain('img0');
    expect(canvasIds).toContain('big');
  });
});

describe('canIdlePaintOnCanvas', () => {
  it('accepts solid rects and rejects text', () => {
    expect(canIdlePaintOnCanvas(rect('n0'))).toBe(true);
    expect(canIdlePaintOnCanvas(textNode('t0'))).toBe(false);
  });

  it('canvasIdleIsStrokeOnly for stroke-only pens', () => {
    expect(canvasIdleIsStrokeOnly(lightPen('p0'))).toBe(true);
    expect(canvasIdleIsStrokeOnly(rect('n0'))).toBe(false);
  });

  it('evenodd boolean / donut paths stay DOM hosts (not canvas ink holes)', () => {
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
    ).toBe(false);
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
    ).toBe(false);
  });
});
