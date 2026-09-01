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
});
