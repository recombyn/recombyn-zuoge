import { describe, expect, it } from 'vitest';
import { hitTestSceneAtPoint } from '../sceneHitBridge';
import type { SceneDocument } from '@/components/rcb/sceneNode';

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
});
