import { describe, expect, it } from 'vitest';
import { hitTestSceneAtPoint, isNodePickableAtPoint } from '../sceneHitBridge';
import type { SceneDocument, SceneNode } from '@/components/rcb/sceneNode';
import {
  createSceneRenderBuffer,
  SOA_FLAG_CANVAS_IDLE,
  SOA_FLAG_VISIBLE,
  SOA_KIND_LINE,
  SOA_KIND_PATH,
  syncSceneRenderBufferFromDocument,
} from '@/components/rcb/render/sceneRenderBuffer';
import { createEmptyDocument, addNodeToDocument } from '@/components/rcb/scene/document/sceneDocument';

function rectDoc(): SceneDocument {
  return {
    deltaSetLike: {
      ROOT: { children: ['a', 'b'] },
      a: {
        id: 'a',
        key: 'shape',
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        attrs: { shapeType: 'rect', 'fill-color': '#fff', 'fill-enabled': 'true' },
      },
      b: {
        id: 'b',
        key: 'shape',
        x: 200,
        y: 0,
        width: 40,
        height: 40,
        attrs: { shapeType: 'rect', 'fill-color': '#fff', 'fill-enabled': 'true' },
      },
    },
  } as unknown as SceneDocument;
}

describe('hitTestSceneAtPoint', () => {
  it('hits topmost candidate first', () => {
    const doc = rectDoc();
    const getNodeBox = (id: string) => {
      const n = doc.deltaSetLike[id as 'a' | 'b'];
      return { left: n.x, top: n.y, width: n.width, height: n.height };
    };
    expect(
      hitTestSceneAtPoint({
        document: doc,
        order: ['b', 'a'],
        x: 10,
        y: 10,
        zoom: 1,
        getNodeBox,
      })
    ).toBe('a');
    expect(
      hitTestSceneAtPoint({
        document: doc,
        order: ['b', 'a'],
        x: 210,
        y: 10,
        zoom: 1,
        getNodeBox,
      })
    ).toBe('b');
    expect(
      hitTestSceneAtPoint({
        document: doc,
        order: ['b', 'a'],
        x: 500,
        y: 500,
        zoom: 1,
        getNodeBox,
      })
    ).toBeNull();
  });

  it('does not use nodeEls SVG DOM unless allowSvgDomHit is true', () => {
    const doc = {
      deltaSetLike: {
        ROOT: { children: ['p'] },
        p: {
          id: 'p',
          key: 'shape',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          // Empty path — Path2D miss; DOM would be the only way to hit if enabled.
          attrs: { shapeType: 'path', path: '', 'fill-enabled': 'false', 'border-width': 2 },
        },
      },
    } as unknown as SceneDocument;
    const getNodeBox = () => ({ left: 0, top: 0, width: 100, height: 100 });
    const fakeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const nodeEls = new Map<string, Element>([['p', fakeSvg]]);
    expect(
      hitTestSceneAtPoint({
        document: doc,
        order: ['p'],
        x: 10,
        y: 10,
        zoom: 1,
        screen: { clientX: 10, clientY: 10 },
        getNodeBox,
        nodeEls,
        allowSvgDomHit: false,
      })
    ).toBeNull();
  });

  it('L-path hole inside artboard does not steal frame-plate clicks', () => {
    // L silhouette: full in left+bottom bands; open top-right is empty plate.
    const lPath = 'M 0 0 L 40 0 L 40 40 L 100 40 L 100 100 L 0 100 Z';
    let doc = createEmptyDocument({ width: 400, height: 400, emptyWorld: true });
    doc = {
      ...doc,
      frames: [{ id: 'frame', x: 0, y: 0, width: 200, height: 200, clipContent: true }],
    };
    doc = addNodeToDocument(doc, 'ell', {
      id: 'ell',
      key: 'shape',
      x: 20,
      y: 20,
      width: 100,
      height: 100,
      attrs: {
        frameId: 'frame',
        shapeType: 'path',
        path: lPath,
        closed: true,
        'fill-color': '#fff',
        'fill-enabled': 'true',
        'border-width': 1,
      },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    const getNodeBox = () => ({ left: 20, top: 20, width: 100, height: 100 });
    // Ink on the L stem (SoA polyline fill — Path2D fill is flaky in jsdom).
    expect(
      hitTestSceneAtPoint({
        document: doc,
        order: ['ell'],
        x: 30,
        y: 30,
        zoom: 1,
        getNodeBox,
        soaBuf: buf,
      })
    ).toBe('ell');
    // Empty corner of the L bbox (artboard white) — must miss so frame plate wins.
    expect(
      hitTestSceneAtPoint({
        document: doc,
        order: ['ell'],
        x: 90,
        y: 30,
        zoom: 1,
        getNodeBox,
        soaBuf: buf,
      })
    ).toBeNull();
    // Without SoA, Path2D/AABB must still miss the hole (no solid-rect steal).
    expect(
      hitTestSceneAtPoint({
        document: doc,
        order: ['ell'],
        x: 90,
        y: 30,
        zoom: 1,
        getNodeBox,
      })
    ).toBeNull();
  });

  it('rect+path boolean silhouette does not AABB-fill the hole', () => {
    const lPath = 'M 0 0 L 40 0 L 40 40 L 100 40 L 100 100 L 0 100 Z';
    let doc = createEmptyDocument({ width: 400, height: 400, emptyWorld: true });
    doc = addNodeToDocument(doc, 'b', {
      id: 'b',
      key: 'shape',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      attrs: {
        shapeType: 'rect',
        path: lPath,
        closed: true,
        'fill-color': '#fff',
        'fill-enabled': 'true',
      },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    const getNodeBox = () => ({ left: 0, top: 0, width: 100, height: 100 });
    expect(
      hitTestSceneAtPoint({
        document: doc,
        order: ['b'],
        x: 20,
        y: 20,
        zoom: 1,
        getNodeBox,
        soaBuf: buf,
      })
    ).toBe('b');
    expect(
      hitTestSceneAtPoint({
        document: doc,
        order: ['b'],
        x: 70,
        y: 20,
        zoom: 1,
        getNodeBox,
        soaBuf: buf,
      })
    ).toBeNull();
    // Regression: old geo AABB fallback would return 'b' here.
    expect(
      hitTestSceneAtPoint({
        document: doc,
        order: ['b'],
        x: 70,
        y: 20,
        zoom: 1,
        getNodeBox,
      })
    ).toBeNull();
  });

  it('does not pick the clipped part of a node outside an artboard', () => {
    const doc = {
      frames: [{ id: 'frame', x: 0, y: 0, width: 100, height: 100, clipContent: true }],
      deltaSetLike: {
        ROOT: { children: ['p'] },
        p: {
          id: 'p',
          key: 'shape',
          x: 40,
          y: 40,
          width: 100,
          height: 40,
          attrs: { shapeType: 'rect', 'fill-color': '#fff', 'fill-enabled': 'true' },
        },
      },
    } as unknown as SceneDocument;
    const getNodeBox = () => ({ left: 40, top: 40, width: 100, height: 40 });
    expect(hitTestSceneAtPoint({ document: doc, order: ['p'], x: 120, y: 60, zoom: 1, getNodeBox })).toBeNull();
    expect(hitTestSceneAtPoint({ document: doc, order: ['p'], x: 80, y: 60, zoom: 1, getNodeBox })).toBe('p');
  });

  it('still picks world shapes over an overlapping animation workbench (incl. outside plate)', () => {
    const doc = {
      frames: [
        {
          id: 'anim',
          kind: 'animation',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          clipContent: true,
        },
      ],
      deltaSetLike: {
        ROOT: { children: ['p'] },
        p: {
          id: 'p',
          key: 'shape',
          x: 40,
          y: 40,
          width: 100,
          height: 40,
          attrs: { shapeType: 'rect', 'fill-color': '#fff', 'fill-enabled': 'true' },
        },
      },
    } as unknown as SceneDocument;
    const getNodeBox = () => ({ left: 40, top: 40, width: 100, height: 40 });
    // Outside the workbench — still pickable (not bound into it).
    expect(
      hitTestSceneAtPoint({ document: doc, order: ['p'], x: 120, y: 60, zoom: 1, getNodeBox })
    ).toBe('p');
    expect(
      hitTestSceneAtPoint({ document: doc, order: ['p'], x: 80, y: 60, zoom: 1, getNodeBox })
    ).toBe('p');
  });

  it('does not pick a bound node when clicking an adjacent artboard', () => {
    const doc = {
      frames: [
        { id: 'left', x: 0, y: 0, width: 200, height: 200, clipContent: true },
        { id: 'right', x: 300, y: 0, width: 200, height: 200, clipContent: true },
      ],
      deltaSetLike: {
        ROOT: { children: ['img'] },
        img: {
          id: 'img',
          key: 'image',
          x: 50,
          y: 50,
          width: 400,
          height: 400,
          attrs: { frameId: 'left', src: 'https://example.com/a.png' },
        },
      },
    } as unknown as SceneDocument;
    const getNodeBox = () => ({ left: 50, top: 50, width: 400, height: 400 });
    expect(
      hitTestSceneAtPoint({ document: doc, order: ['img'], x: 350, y: 100, zoom: 1, getNodeBox })
    ).toBeNull();
    expect(
      hitTestSceneAtPoint({ document: doc, order: ['img'], x: 100, y: 100, zoom: 1, getNodeBox })
    ).toBe('img');
  });

  it('allows free pen/line pick outside a grazed clipContent artboard', () => {
    const doc = {
      frames: [{ id: 'frame', x: 0, y: 0, width: 100, height: 100, clipContent: true }],
      deltaSetLike: {
        ROOT: { children: ['ink'] },
        ink: {
          id: 'ink',
          key: 'shape',
          x: 40,
          y: 40,
          width: 100,
          height: 40,
          attrs: {
            shapeType: 'pen',
            path: 'M 0 20 L 100 20',
            'fill-enabled': 'false',
            'border-width': 2,
          },
        },
      },
    } as unknown as SceneDocument;
    const ink = doc.deltaSetLike.ink as SceneNode;
    // Rect fill overhang stays clipped; open strokes stay pickable in world space.
    expect(isNodePickableAtPoint(doc, ink, 120, 60)).toBe(true);
    expect(isNodePickableAtPoint(doc, ink, 80, 60)).toBe(true);

    // SoA stroke samples (Path2D is unreliable in vitest) — still pick outside plate.
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    const i = buf.indexById.get('ink')!;
    expect(buf.kinds[i]).toBe(SOA_KIND_PATH);
    buf.flags[i] = (SOA_FLAG_CANVAS_IDLE | SOA_FLAG_VISIBLE) >>> 0;
    buf.pathXY = new Float32Array([40, 60, 140, 60]);
    buf.pathStart[i] = 0;
    buf.pathLen[i] = 2;
    buf.pathClosed[i] = 0;
    const getNodeBox = () => ({ left: 40, top: 40, width: 100, height: 40 });
    expect(
      hitTestSceneAtPoint({
        document: doc,
        order: ['ink'],
        x: 120,
        y: 60,
        zoom: 1,
        getNodeBox,
        soaBuf: buf,
      })
    ).toBe('ink');
  });

  it('unfilled higher rect still captures clicks over a lower filled sibling', () => {
    const doc = {
      deltaSetLike: {
        ROOT: { children: ['back', 'front'] },
        back: {
          id: 'back',
          key: 'shape',
          x: 40,
          y: 40,
          width: 80,
          height: 80,
          attrs: { shapeType: 'rect', 'fill-color': '#fff', 'fill-enabled': 'true' },
        },
        front: {
          id: 'front',
          key: 'shape',
          x: 0,
          y: 0,
          width: 200,
          height: 200,
          attrs: {
            shapeType: 'rect',
            'fill-color': 'transparent',
            'fill-enabled': 'false',
            'border-width': 2,
            'border-color': '#333',
          },
        },
      },
    } as unknown as SceneDocument;
    const getNodeBox = (id: string) => {
      const n = doc.deltaSetLike[id as 'back' | 'front'];
      return { left: n.x, top: n.y, width: n.width, height: n.height };
    };
    // Topmost first — empty/transparent front must still own the AABB hit.
    expect(
      hitTestSceneAtPoint({
        document: doc,
        order: ['front', 'back'],
        x: 70,
        y: 70,
        zoom: 1,
        getNodeBox,
      })
    ).toBe('front');
  });

  it('falls through SoA LINE miss to segment hit (same path as pen Path2D fallthrough)', () => {
    let doc = createEmptyDocument({ width: 400, height: 400, emptyWorld: true });
    doc = addNodeToDocument(doc, 'ln', {
      id: 'ln',
      key: 'shape',
      x: 0,
      y: 40,
      width: 100,
      height: 20,
      attrs: { shapeType: 'line', 'border-width': 2 },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    const i = buf.indexById.get('ln')!;
    expect(buf.kinds[i]).toBe(SOA_KIND_LINE);
    buf.flags[i] = (SOA_FLAG_CANVAS_IDLE | SOA_FLAG_VISIBLE) >>> 0;
    // Stale SoA box far from the document line → SoA miss; Path2D/segment fallthrough.
    buf.positions[i * 4] = 0;
    buf.positions[i * 4 + 1] = 0;
    buf.positions[i * 4 + 2] = 10;
    buf.positions[i * 4 + 3] = 10;
    const getNodeBox = () => ({ left: 0, top: 40, width: 100, height: 20 });
    expect(
      hitTestSceneAtPoint({
        document: doc,
        order: ['ln'],
        x: 50,
        y: 50,
        zoom: 1,
        getNodeBox,
        soaBuf: buf,
      })
    ).toBe('ln');
  });

  it('picks stroke after promote cleared CANVAS_IDLE (select→deselect cycle)', () => {
    let doc = createEmptyDocument({ width: 400, height: 400, emptyWorld: true });
    doc = addNodeToDocument(doc, 'pen', {
      id: 'pen',
      key: 'shape',
      x: 10,
      y: 10,
      width: 120,
      height: 80,
      attrs: {
        shapeType: 'pen',
        path: 'M 0 40 C 30 0 90 80 120 40',
        'border-width': 3,
        'border-color': '#2563eb',
      },
      children: [],
    });
    doc = addNodeToDocument(doc, 'arrow', {
      id: 'arrow',
      key: 'shape',
      x: 40,
      y: 100,
      width: 100,
      height: 1,
      attrs: { shapeType: 'arrow', angle: 35, 'border-width': 2 },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    const penI = buf.indexById.get('pen')!;
    const arrowI = buf.indexById.get('arrow')!;
    expect(buf.flags[penI] & SOA_FLAG_CANVAS_IDLE).toBeTruthy();
    expect(buf.flags[arrowI] & SOA_FLAG_CANVAS_IDLE).toBeTruthy();
    // Selection paint-raise / host promote clears idle ink.
    buf.flags[penI] = (buf.flags[penI] & ~SOA_FLAG_CANVAS_IDLE) >>> 0;
    buf.flags[arrowI] = (buf.flags[arrowI] & ~SOA_FLAG_CANVAS_IDLE) >>> 0;
    const getNodeBox = (id: string) => {
      const n = doc.deltaSetLike![id]!;
      return { left: n.x, top: n.y, width: n.width, height: n.height };
    };
    expect(
      hitTestSceneAtPoint({
        document: doc,
        order: ['arrow', 'pen'],
        x: 70,
        y: 50,
        zoom: 1,
        getNodeBox,
        soaBuf: buf,
      })
    ).toBe('pen');
    // Midpoint of angled arrow shaft (world).
    const cx = 40 + 50;
    const cy = 100 + 0.5;
    expect(
      hitTestSceneAtPoint({
        document: doc,
        order: ['arrow', 'pen'],
        x: cx,
        y: cy,
        zoom: 1,
        getNodeBox,
        soaBuf: buf,
      })
    ).toBe('arrow');
    // After demote, idle restored — still pickable.
    buf.flags[penI] = (buf.flags[penI] | SOA_FLAG_CANVAS_IDLE) >>> 0;
    buf.flags[arrowI] = (buf.flags[arrowI] | SOA_FLAG_CANVAS_IDLE) >>> 0;
    expect(
      hitTestSceneAtPoint({
        document: doc,
        order: ['arrow', 'pen'],
        x: cx,
        y: cy,
        zoom: 1,
        getNodeBox,
        soaBuf: buf,
      })
    ).toBe('arrow');
  });

  it('picks pencil silhouette interior even when fill-color is unset (colors=0)', () => {
    // Pencil ribbon path is a closed outline; ink uses stroke attrs so SoA colors=0.
    const silhouette = 'M 0 0 L 40 0 L 40 40 L 0 40 Z';
    let doc = createEmptyDocument({ width: 400, height: 400, emptyWorld: true });
    doc = addNodeToDocument(doc, 'brush', {
      id: 'brush',
      key: 'shape',
      x: 100,
      y: 100,
      width: 40,
      height: 40,
      attrs: {
        shapeType: 'pencil',
        path: silhouette,
        brushStyle: 'vector-ink',
        'border-width': 2,
        'border-color': '#111',
        'fill-enabled': 'false',
      },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    const i = buf.indexById.get('brush')!;
    expect(buf.kinds[i]).toBe(SOA_KIND_PATH);
    buf.flags[i] = (SOA_FLAG_CANVAS_IDLE | SOA_FLAG_VISIBLE) >>> 0;
    buf.colors[i] = 0;
    buf.pathXY = new Float32Array([100, 100, 140, 100, 140, 140, 100, 140]);
    buf.pathStart[i] = 0;
    buf.pathLen[i] = 4;
    buf.pathClosed[i] = 1;
    const getNodeBox = () => ({ left: 100, top: 100, width: 40, height: 40 });
    // Center of the brush body — not on the silhouette edge.
    expect(
      hitTestSceneAtPoint({
        document: doc,
        order: ['brush'],
        x: 120,
        y: 120,
        zoom: 1,
        getNodeBox,
        soaBuf: buf,
      })
    ).toBe('brush');
  });
});
