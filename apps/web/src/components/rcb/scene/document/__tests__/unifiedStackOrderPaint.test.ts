import { describe, expect, it } from 'vitest';
import {
  addNodeToDocument,
  createBareDocument,
  selectionPaintZIndex,
  stackZIndex,
  worldNodeStacksAboveAnyFrame,
} from '../sceneDocument';
import { pickFullAndCanvasIds, nodeNeedsDomShapeHost } from '@/components/rcb/shapes/RcbShapesLayer';
import { syncSharedMountPaintOrder } from '@/components/rcb/shapes/shapeHostRegistry';
import { isSoaBasicGeomSufficient } from '@/components/rcb/render/sceneRenderBuffer';
import { stackPaintZ, syncStackPaintOrder } from '../sceneStackPainter';

/**
 * Unified stackOrder contract: rect / boolean / image / video / artboard share
 * one paint-order field. Physical hosts + plates interleave by data-z.
 */
describe('unified stackOrder paint', () => {
  function layer(z: number, kind: 'shape' | 'frame', id: string) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute(kind === 'frame' ? 'data-rcb-frame-layer' : 'data-rcb-shape-layer', '1');
    g.setAttribute('data-z', String(z));
    g.setAttribute('data-id', id);
    return g;
  }

  it('interleaves artboard plate above boolean / image / video hosts by stackOrder', () => {
    const mount = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    // stackOrder: bool → image → video → board (board on top)
    mount.append(
      layer(400000, 'frame', 'board'),
      layer(100001, 'shape', 'bool'),
      layer(200001, 'shape', 'image'),
      layer(300001, 'shape', 'video')
    );
    syncStackPaintOrder(mount as SVGGElement);
    expect([...mount.children].map((el) => el.getAttribute('data-id'))).toEqual([
      'bool',
      'image',
      'video',
      'board',
    ]);
  });

  it('only stackOrder z decides plate vs host cover (same mount)', () => {
    let doc = createBareDocument();
    doc = addNodeToDocument(doc, 'bool', {
      id: 'bool',
      key: 'shape',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      attrs: {
        shapeType: 'path',
        path: 'M0 0 H100 V100 H0 Z M20 20 H80 V80 H20 Z',
        outlined: 'true',
        'fill-rule': 'evenodd',
      },
      children: [],
    });
    doc = addNodeToDocument(doc, 'img', {
      id: 'img',
      key: 'image',
      x: 10,
      y: 10,
      width: 80,
      height: 80,
      attrs: { src: 'https://example.com/a.png' },
      children: [],
    });
    doc.frames = [
      {
        id: 'board',
        name: '动画',
        backgroundColor: '#fff',
        x: 0,
        y: 0,
        width: 200,
        height: 200,
        kind: 'animation',
      },
    ];
    doc.stackOrder = ['node:bool', 'node:img', 'frame:board'];
    expect(stackZIndex(doc, 'node', 'bool')).toBeLessThan(stackZIndex(doc, 'frame', 'board'));
    expect(stackZIndex(doc, 'node', 'img')).toBeLessThan(stackZIndex(doc, 'frame', 'board'));
    expect(stackPaintZ(doc, 'frame', 'board')).toBe(stackZIndex(doc, 'frame', 'board'));
    expect(selectionPaintZIndex(doc, 'frame', 'board', true)).toBeGreaterThan(
      stackZIndex(doc, 'node', 'img')
    );
  });

  it('boolean evenodd is SoA-basic; still hosts when stacked above a plate', () => {
    let doc = createBareDocument();
    doc = addNodeToDocument(doc, 'bool', {
      id: 'bool',
      key: 'shape',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      attrs: {
        shapeType: 'path',
        path: 'M0 0 H100 V100 H0 Z M20 20 H80 V80 H20 Z',
        outlined: 'true',
        'fill-rule': 'evenodd',
        'fill-color': '#fff',
      },
      children: [],
    });
    expect(isSoaBasicGeomSufficient(doc.deltaSetLike.bool)).toBe(true);

    doc.frames = [
      {
        id: 'board',
        name: 'A',
        backgroundColor: '#fff',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
      },
    ];
    doc.stackOrder = ['frame:board', 'node:bool'];
    expect(worldNodeStacksAboveAnyFrame(doc, 'bool')).toBe(true);
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ['bool'],
      zoom: 1,
    });
    expect(fullIds).toEqual(['bool']);
    expect(canvasIds).toEqual([]);
  });

  it('frame-bound idle rects stay on ArtboardLayer ink (not DOM hosts)', () => {
    const node = {
      id: 'child',
      key: 'shape',
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      attrs: { shapeType: 'rect', frameId: 'board', 'fill-color': '#abc', 'stroke-enabled': false },
    };
    expect(nodeNeedsDomShapeHost(node as never)).toBe(false);
    let doc = createBareDocument();
    doc.frames = [
      { id: 'board', name: 'A', backgroundColor: '#fff', x: 0, y: 0, width: 100, height: 100 },
    ];
    doc.stackOrder = ['frame:board'];
    doc = addNodeToDocument(doc, 'child', { ...node, children: [] } as never);
    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ['child'],
      zoom: 1,
    });
    expect(fullIds).not.toContain('child');
    expect(canvasIds).toContain('child');
  });

  it('frame-bound lottie still takes a DOM host', () => {
    const node = {
      id: 'lot',
      key: 'lottie',
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      attrs: { frameId: 'board' },
    };
    expect(nodeNeedsDomShapeHost(node as never)).toBe(true);
  });

  it('static text idles on ink when below plates; hosts when stacked above', () => {
    let doc = createBareDocument();
    doc = addNodeToDocument(doc, 'txt', {
      id: 'txt',
      key: 'text',
      x: 0,
      y: 0,
      width: 120,
      height: 32,
      attrs: { fontSize: 16, markdown: 'Hello' },
      children: [],
    });
    doc.frames = [
      {
        id: 'board',
        name: 'A',
        backgroundColor: '#fff',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
      },
    ];
    doc.stackOrder = ['node:txt', 'frame:board'];
    let pick = pickFullAndCanvasIds({ document: doc, visibleIds: ['txt'], zoom: 1 });
    expect(pick.canvasIds).toContain('txt');
    expect(pick.fullIds).not.toContain('txt');

    doc.stackOrder = ['frame:board', 'node:txt'];
    pick = pickFullAndCanvasIds({ document: doc, visibleIds: ['txt'], zoom: 1 });
    expect(pick.fullIds).toContain('txt');
    expect(pick.canvasIds).not.toContain('txt');
  });

  it('static image idles on ink when below plates; hosts when stacked above', () => {
    let doc = createBareDocument();
    doc = addNodeToDocument(doc, 'img', {
      id: 'img',
      key: 'image',
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      attrs: { src: 'https://example.com/a.png' },
      children: [],
    });
    doc.frames = [
      {
        id: 'board',
        name: 'A',
        backgroundColor: '#fff',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
      },
    ];
    doc.stackOrder = ['node:img', 'frame:board'];
    let pick = pickFullAndCanvasIds({ document: doc, visibleIds: ['img'], zoom: 1 });
    expect(pick.canvasIds).toContain('img');
    expect(pick.fullIds).not.toContain('img');

    doc.stackOrder = ['frame:board', 'node:img'];
    pick = pickFullAndCanvasIds({ document: doc, visibleIds: ['img'], zoom: 1 });
    expect(pick.fullIds).toContain('img');
    expect(pick.canvasIds).not.toContain('img');
  });

  it('idle audio plate idles on ink when below plates; hosts when stacked above', () => {
    let doc = createBareDocument();
    doc = addNodeToDocument(doc, 'aud', {
      id: 'aud',
      key: 'audio',
      x: 0,
      y: 0,
      width: 160,
      height: 48,
      attrs: { src: 'https://example.com/a.mp3', audioGenerator: true },
      children: [],
    });
    doc.frames = [
      {
        id: 'board',
        name: 'A',
        backgroundColor: '#fff',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
      },
    ];
    doc.stackOrder = ['node:aud', 'frame:board'];
    let pick = pickFullAndCanvasIds({ document: doc, visibleIds: ['aud'], zoom: 1 });
    expect(pick.canvasIds).toContain('aud');
    expect(pick.fullIds).not.toContain('aud');

    doc.stackOrder = ['frame:board', 'node:aud'];
    pick = pickFullAndCanvasIds({ document: doc, visibleIds: ['aud'], zoom: 1 });
    expect(pick.fullIds).toContain('aud');
    expect(pick.canvasIds).not.toContain('aud');
  });

  it('gradient fill idles on ink when below plates; hosts when stacked above', () => {
    let doc = createBareDocument();
    doc = addNodeToDocument(doc, 'grad', {
      id: 'grad',
      key: 'shape',
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      attrs: {
        shapeType: 'rect',
        'fill-type': 'linear',
        'fill-gradient': '{"type":"linear","colorStops":[{"offset":0,"color":"#f00"},{"offset":1,"color":"#00f"}]}',
      },
      children: [],
    });
    doc.frames = [
      {
        id: 'board',
        name: 'A',
        backgroundColor: '#fff',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
      },
    ];
    doc.stackOrder = ['node:grad', 'frame:board'];
    let pick = pickFullAndCanvasIds({ document: doc, visibleIds: ['grad'], zoom: 1 });
    expect(pick.canvasIds).toContain('grad');
    expect(pick.fullIds).not.toContain('grad');

    doc.stackOrder = ['frame:board', 'node:grad'];
    pick = pickFullAndCanvasIds({ document: doc, visibleIds: ['grad'], zoom: 1 });
    expect(pick.fullIds).toContain('grad');
    expect(pick.canvasIds).not.toContain('grad');
  });

  it('star / donut ellipse idle below plates; host when stacked above', () => {
    let doc = createBareDocument();
    doc = addNodeToDocument(doc, 'star', {
      id: 'star',
      key: 'shape',
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      attrs: { shapeType: 'star', 'fill-color': '#fc0', sides: 5 },
      children: [],
    });
    doc = addNodeToDocument(doc, 'donut', {
      id: 'donut',
      key: 'shape',
      x: 100,
      y: 0,
      width: 80,
      height: 80,
      attrs: { shapeType: 'ellipse', 'fill-color': '#0cf', ellipseInnerRatio: 0.4 },
      children: [],
    });
    doc.frames = [
      {
        id: 'board',
        name: 'A',
        backgroundColor: '#fff',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
      },
    ];
    doc.stackOrder = ['node:star', 'node:donut', 'frame:board'];
    let pick = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ['star', 'donut'],
      zoom: 1,
    });
    expect(pick.canvasIds).toEqual(expect.arrayContaining(['star', 'donut']));
    expect(pick.fullIds).not.toContain('star');
    expect(pick.fullIds).not.toContain('donut');

    doc.stackOrder = ['frame:board', 'node:star', 'node:donut'];
    pick = pickFullAndCanvasIds({
      document: doc,
      visibleIds: ['star', 'donut'],
      zoom: 1,
    });
    expect(pick.fullIds).toEqual(expect.arrayContaining(['star', 'donut']));
    expect(pick.canvasIds).not.toContain('star');
    expect(pick.canvasIds).not.toContain('donut');
  });

  it('syncSharedMountPaintOrder matches syncStackPaintOrder', () => {
    const mount = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const a = layer(3, 'shape', 'a');
    const b = layer(1, 'frame', 'b');
    mount.append(a, b);
    syncSharedMountPaintOrder(mount as SVGGElement);
    expect([...mount.children].map((el) => el.getAttribute('data-id'))).toEqual(['b', 'a']);
  });
});
