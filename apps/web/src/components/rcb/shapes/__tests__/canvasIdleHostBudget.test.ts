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

describe('pickFullAndCanvasIds', () => {
  it('keeps SVG hosts under budget (idle Canvas does not drop interactive hosts)', () => {
    const nodes: Record<string, any> = {};
    for (let i = 0; i < 20; i += 1) nodes[`n${i}`] = rect(`n${i}`);
    const doc = makeDoc(nodes);
    const ids = Object.keys(nodes);
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ids,
      keepSet: new Set(),
      zoom: 1,
      moving: false,
    });
    expect(fullIds).toHaveLength(20);
    expect(canvasIds).toHaveLength(0);
  });

  it('keeps text, media, and light pen as SVG hosts under budget', () => {
    const doc = makeDoc({
      t0: textNode('t0'),
      p0: lightPen('p0'),
      i0: imageNode('i0'),
    });
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ['t0', 'p0', 'i0'],
      keepSet: new Set(),
      zoom: 1,
      moving: false,
    });
    expect(fullIds.sort()).toEqual(['i0', 'p0', 't0']);
    expect(canvasIds).toEqual([]);
  });

  it('keeps media and idle rect as SVG hosts when few', () => {
    const nodes: Record<string, any> = {
      i0: imageNode('i0'),
      n0: rect('n0'),
    };
    const doc = makeDoc(nodes);
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ['i0', 'n0'],
      keepSet: new Set(),
      zoom: 1,
      moving: false,
    });
    expect(fullIds.sort()).toEqual(['i0', 'n0']);
    expect(canvasIds).toEqual([]);
  });

  it('forceFullSet keeps selected idle rect as SVG under dense motion overflow', () => {
    const nodes: Record<string, any> = {};
    for (let i = 0; i < 40; i += 1) nodes[`n${i}`] = rect(`n${i}`);
    const doc = makeDoc(nodes);
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: Object.keys(nodes),
      keepSet: new Set(['n0']),
      forceFullSet: new Set(['n0']),
      zoom: 0.15,
      moving: true,
    });
    expect(fullIds).toContain('n0');
    expect(canvasIds).not.toContain('n0');
  });

  it('far zoom alone keeps in-viewport hosts (cull is the off-screen path)', () => {
    const nodes: Record<string, any> = {};
    for (let i = 0; i < 40; i += 1) nodes[`n${i}`] = rect(`n${i}`);
    const doc = makeDoc(nodes);
    const ids = Object.keys(nodes);
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ids,
      keepSet: new Set(),
      zoom: 0.15,
      moving: false,
    });
    expect(fullIds).toHaveLength(40);
    expect(canvasIds).toHaveLength(0);
  });

  it('caps full hosts and proxies idle overflow when over budget', () => {
    const nodes: Record<string, any> = {};
    for (let i = 0; i < 120; i += 1) nodes[`n${i}`] = rect(`n${i}`);
    const doc = makeDoc(nodes);
    const ids = Object.keys(nodes);
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ids,
      keepSet: new Set(['n0']),
      zoom: 1,
      moving: false,
    });
    // Idle rects skip SVG when over host budget; keepSet does not force full SVG.
    expect(fullIds.length).toBe(0);
    expect(canvasIds.length).toBeGreaterThan(0);
    expect(fullIds.length + canvasIds.length).toBe(120);
  });

  it('caps proxy paint so dense overflow stays bounded', () => {
    const nodes: Record<string, any> = {};
    for (let i = 0; i < 5000; i += 1) nodes[`n${i}`] = rect(`n${i}`);
    const doc = makeDoc(nodes);
    const ids = Object.keys(nodes);
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ids,
      keepSet: new Set(['n0']),
      zoom: 1,
      moving: false,
      maxCanvasIdle: 128,
    });
    expect(fullIds.length).toBe(0);
    expect(canvasIds.length).toBeLessThanOrEqual(128);
    expect(fullIds.length + canvasIds.length).toBeLessThan(5000);
  });

  it('forceFullSet keeps editors as full SVG under overflow', () => {
    const nodes: Record<string, any> = {};
    for (let i = 0; i < 120; i += 1) nodes[`n${i}`] = rect(`n${i}`);
    const doc = makeDoc(nodes);
    const ids = Object.keys(nodes);
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ids,
      keepSet: new Set(),
      forceFullSet: new Set(['n0']),
      zoom: 1,
      moving: false,
    });
    expect(fullIds).toContain('n0');
    expect(canvasIds).not.toContain('n0');
  });

  it('forceFullSet keeps idle rect as SVG even under budget', () => {
    const doc = makeDoc({ n0: rect('n0') });
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ['n0'],
      keepSet: new Set(),
      forceFullSet: new Set(['n0']),
      zoom: 1,
      moving: false,
    });
    expect(fullIds).toEqual(['n0']);
    expect(canvasIds).toHaveLength(0);
  });

  it('prefer SVG budget for non-idle over canvas-idle media when over budget', () => {
    const nodes: Record<string, any> = {};
    for (let i = 0; i < 100; i += 1) nodes[`n${i}`] = rect(`n${i}`);
    nodes.i0 = imageNode('i0');
    nodes.poly = {
      id: 'poly',
      key: 'shape',
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      attrs: { shapeType: 'polygon', sides: 5, 'fill-color': '#abc' },
    };
    const doc = makeDoc(nodes);
    const ids = Object.keys(nodes);
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ids,
      keepSet: new Set(),
      zoom: 1,
      moving: false,
    });
    // Polygon is not canvas-idle → keeps SVG; image/rects demote to Canvas ink.
    expect(fullIds).toContain('poly');
    expect(canvasIds).toContain('i0');
    expect(canvasIds).toContain('n0');
  });

  it('demotes heavy paths during dense camera motion', () => {
    const nodes: Record<string, any> = {
      heavy: heavy('heavy'),
      big: rect('big', 400, 400),
    };
    for (let i = 0; i < 100; i += 1) nodes[`img${i}`] = imageNode(`img${i}`);
    const doc = makeDoc(nodes);
    const ids = Object.keys(nodes);
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ids,
      keepSet: new Set(),
      zoom: 1,
      moving: true,
    });
    // Images are canvas-idle → proxy; heavy path stays SVG (not idle-paintable).
    expect(canvasIds).toContain('img0');
    expect(fullIds).toContain('heavy');
  });
});

describe('canvasIdleIsStrokeOnly', () => {
  it('treats pencil/pen/line as stroke-only (no AABB fill)', () => {
    expect(canvasIdleIsStrokeOnly({ attrs: { shapeType: 'pencil' } } as any)).toBe(true);
    expect(canvasIdleIsStrokeOnly({ attrs: { shapeType: 'pen' } } as any)).toBe(true);
    expect(canvasIdleIsStrokeOnly({ attrs: { shapeType: 'line' } } as any)).toBe(true);
  });

  it('treats unfilled path as stroke-only; filled rect as fill proxy', () => {
    expect(
      canvasIdleIsStrokeOnly({
        attrs: { shapeType: 'path', path: 'M0 0 L10 10', 'fill-color': 'none' },
      } as any)
    ).toBe(true);
    expect(
      canvasIdleIsStrokeOnly({
        attrs: { shapeType: 'rect', 'fill-color': '#abc' },
      } as any)
    ).toBe(false);
  });
});

describe('canIdlePaintOnCanvas', () => {
  it('allows solid/gradient/image fills, media, drop shadow; rejects blur, non-center stroke, heavy path, poly', () => {
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: { shapeType: 'rect', 'fill-color': '#fff', 'stroke-enabled': false },
      } as any)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: {
          shapeType: 'rect',
          'fill-type': 'linear',
          'fill-gradient': '{}',
          'stroke-enabled': false,
        },
      } as any)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: {
          shapeType: 'rect',
          'fill-type': 'angular',
          'fill-gradient': '{}',
          'stroke-enabled': false,
        },
      } as any)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: {
          shapeType: 'rect',
          'fill-type': 'image',
          'fill-image-src': 'https://example.com/a.png',
          'stroke-enabled': false,
        },
      } as any)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'image',
        attrs: { src: 'https://example.com/a.png' },
      } as any)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'video',
        attrs: { poster: 'https://example.com/p.png' },
      } as any)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: { shapeType: 'circle', 'fill-color': '#fff', 'stroke-enabled': false },
      } as any)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: {
          shapeType: 'rect',
          'fill-color': '#fff',
          'stroke-enabled': false,
          'shadow-enabled': true,
        },
      } as any)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: {
          shapeType: 'rect',
          'fill-color': '#fff',
          'border-width': 2,
          strokeAlign: 'outside',
        },
      } as any)
    ).toBe(false);
    expect(
      canIdlePaintOnCanvas({
        key: 'text',
        attrs: { ORIGIN_DATA: JSON.stringify([{ children: [{ text: 'a' }] }]) },
      } as any)
    ).toBe(false);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: { shapeType: 'pen', path: 'M0 0 L10 0', 'stroke-enabled': true, 'border-width': 2 },
      } as any)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: {
          shapeType: 'circle',
          ellipseInnerRatio: 0.4,
          'fill-color': '#fff',
          'stroke-enabled': false,
        },
      } as any)
    ).toBe(false);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: {
          shapeType: 'circle',
          ellipseArcPercent: 55,
          'fill-color': '#fff',
          'stroke-enabled': false,
        },
      } as any)
    ).toBe(false);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: { shapeType: 'polygon', sides: 6, 'stroke-enabled': false },
      } as any)
    ).toBe(false);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: { shapeType: 'star', sides: 5, 'stroke-enabled': false },
      } as any)
    ).toBe(false);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: { shapeType: 'triangle', 'stroke-enabled': false },
      } as any)
    ).toBe(false);
    expect(canIdlePaintOnCanvas({ key: 'image', attrs: {} } as any)).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: {
          shapeType: 'rect',
          'fill-type': 'image',
          'fill-image-src': 'data:image/png;base64,xx',
          'stroke-enabled': false,
        },
      } as any)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: {
          shapeType: 'rect',
          'fill-type': 'diffuse',
          'fill-gradient': '{}',
          'stroke-enabled': false,
        },
      } as any)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: {
          shapeType: 'path',
          path: 'M0 0 ' + 'L1 1 '.repeat(HEAVY_PATH_D_CHARS),
          'stroke-enabled': false,
        },
      } as any)
    ).toBe(false);
  });
});
