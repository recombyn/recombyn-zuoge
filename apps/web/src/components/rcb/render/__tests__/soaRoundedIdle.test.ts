import { describe, expect, it } from 'vitest';
import { createEmptyDocument, addNodeToDocument } from '@/components/rcb/scene/document/sceneDocument';
import {
  createSceneRenderBuffer,
  isSoaBasicGeomSufficient,
  isSoaCanvasEligible,
  syncSceneRenderBufferFromDocument,
  SOA_FLAG_BASIC_GEOM,
  SOA_FLAG_CANVAS_IDLE,
} from '../sceneRenderBuffer';
import { canIdlePaintOnCanvas } from '../sceneRenderer';

describe('SoA basic geom vs rounded / poly', () => {
  it('marks sharp solid rect as BASIC_GEOM', () => {
    let doc = createEmptyDocument({ width: 400, height: 400, emptyWorld: true });
    doc = addNodeToDocument(doc, 'a', {
      id: 'a',
      key: 'shape',
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      attrs: {
        shapeType: 'rect',
        fill: '#ffffff',
        'fill-color': '#ffffff',
        'stroke-enabled': false,
      },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    expect(buf.flags[0] & SOA_FLAG_CANVAS_IDLE).toBeTruthy();
    expect(buf.flags[0] & SOA_FLAG_BASIC_GEOM).toBeTruthy();
    expect(isSoaBasicGeomSufficient(doc.deltaSetLike.a)).toBe(true);
  });

  it('rounded solid rect is BASIC_GEOM and stores radii', () => {
    let doc = createEmptyDocument({ width: 400, height: 400, emptyWorld: true });
    doc = addNodeToDocument(doc, 'r', {
      id: 'r',
      key: 'shape',
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      attrs: {
        shapeType: 'rect',
        fill: '#ffffff',
        'fill-color': '#ffffff',
        cornerRadius: 16,
        radiusLinked: true,
        'stroke-enabled': false,
      },
      children: [],
    });
    expect(canIdlePaintOnCanvas(doc.deltaSetLike.r)).toBe(true);
    expect(isSoaBasicGeomSufficient(doc.deltaSetLike.r)).toBe(true);
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    expect(buf.flags[0] & SOA_FLAG_CANVAS_IDLE).toBeTruthy();
    expect(buf.flags[0] & SOA_FLAG_BASIC_GEOM).toBeTruthy();
    expect(buf.radii[0]).toBeGreaterThan(0);
    expect(buf.radii[1]).toBeGreaterThan(0);
  });

  it('polygon can idle-paint but is never SoA-basic', () => {
    let doc = createEmptyDocument({ width: 400, height: 400, emptyWorld: true });
    doc = addNodeToDocument(doc, 'p', {
      id: 'p',
      key: 'shape',
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      attrs: { shapeType: 'polygon', sides: 6, fill: '#fff', 'fill-color': '#fff' },
      children: [],
    });
    expect(canIdlePaintOnCanvas(doc.deltaSetLike.p)).toBe(true);
    expect(isSoaBasicGeomSufficient(doc.deltaSetLike.p)).toBe(false);
  });

  it('flipped rect stays idle-capable but not SoA-basic', () => {
    let doc = createEmptyDocument({ width: 400, height: 400, emptyWorld: true });
    doc = addNodeToDocument(doc, 'f', {
      id: 'f',
      key: 'shape',
      x: 0,
      y: 0,
      width: 40,
      height: 80,
      attrs: {
        shapeType: 'rect',
        fill: '#ffffff',
        'fill-color': '#ffffff',
        'stroke-enabled': false,
        flipX: 'true',
        angle: 90,
      },
      children: [],
    });
    expect(canIdlePaintOnCanvas(doc.deltaSetLike.f)).toBe(true);
    expect(isSoaBasicGeomSufficient(doc.deltaSetLike.f)).toBe(false);
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    expect(buf.flags[0] & SOA_FLAG_BASIC_GEOM).toBeFalsy();
    expect(buf.flags[0] & SOA_FLAG_CANVAS_IDLE).toBeFalsy();
  });

  it('boolean evenodd / outlined paths stay off SoA basic (need Path2D fill-rule)', () => {
    let doc = createEmptyDocument({ width: 400, height: 400, emptyWorld: true });
    doc = addNodeToDocument(doc, 'b', {
      id: 'b',
      key: 'shape',
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      attrs: {
        shapeType: 'path',
        path: 'M0 0 H100 V80 H0 Z M20 20 H80 V60 H20 Z',
        closed: 'true',
        outlined: 'true',
        'fill-rule': 'evenodd',
        'fill-color': '#ffffff',
        'stroke-enabled': false,
      },
      children: [],
    });
    expect(canIdlePaintOnCanvas(doc.deltaSetLike.b)).toBe(true);
    expect(isSoaBasicGeomSufficient(doc.deltaSetLike.b)).toBe(false);
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    expect(buf.flags[0] & SOA_FLAG_BASIC_GEOM).toBeFalsy();
    expect(buf.flags[0] & SOA_FLAG_CANVAS_IDLE).toBeFalsy();
  });

  it('stroke / gradient / poly / text / media never enter SoA basic idle', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    const cases: Array<{ id: string; node: Parameters<typeof addNodeToDocument>[2] }> = [
      {
        id: 'stroke',
        node: {
          id: 'stroke',
          key: 'shape',
          x: 0,
          y: 0,
          width: 40,
          height: 40,
          attrs: {
            shapeType: 'rect',
            fill: '#fff',
            'fill-color': '#fff',
            'stroke-enabled': true,
            'border-width': 2,
            'border-color': '#000',
          },
          children: [],
        },
      },
      {
        id: 'grad',
        node: {
          id: 'grad',
          key: 'shape',
          x: 50,
          y: 0,
          width: 40,
          height: 40,
          attrs: {
            shapeType: 'rect',
            'fill-type': 'linear',
            'fill-gradient': '{}',
            'stroke-enabled': false,
          },
          children: [],
        },
      },
      {
        id: 'poly',
        node: {
          id: 'poly',
          key: 'shape',
          x: 100,
          y: 0,
          width: 40,
          height: 40,
          attrs: { shapeType: 'polygon', sides: 5, 'fill-color': '#abc', 'stroke-enabled': false },
          children: [],
        },
      },
      {
        id: 'txt',
        node: {
          id: 'txt',
          key: 'text',
          x: 150,
          y: 0,
          width: 80,
          height: 24,
          attrs: { fontSize: 14 },
          children: [],
        },
      },
      {
        id: 'img',
        node: {
          id: 'img',
          key: 'image',
          x: 240,
          y: 0,
          width: 64,
          height: 48,
          attrs: { src: 'https://example.com/a.png' },
          children: [],
        },
      },
    ];
    for (const c of cases) {
      doc = addNodeToDocument(doc, c.id, c.node);
    }
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    for (const c of cases) {
      const node = doc.deltaSetLike[c.id];
      expect(isSoaBasicGeomSufficient(node), c.id).toBe(false);
      const i = buf.indexById.get(c.id);
      expect(i).toBeDefined();
      expect(buf.flags[i!] & SOA_FLAG_BASIC_GEOM, c.id).toBeFalsy();
      expect(buf.flags[i!] & SOA_FLAG_CANVAS_IDLE, c.id).toBeFalsy();
    }
    // Rects with stroke/gradient + polys stay SoA-eligible but never BASIC_GEOM idle.
    expect(isSoaCanvasEligible(doc.deltaSetLike.stroke)).toBe(true);
    expect(isSoaCanvasEligible(doc.deltaSetLike.grad)).toBe(true);
    expect(isSoaCanvasEligible(doc.deltaSetLike.poly)).toBe(true);
    // Text / media are not SoA-eligible at all.
    expect(isSoaCanvasEligible(doc.deltaSetLike.txt)).toBe(false);
    expect(isSoaCanvasEligible(doc.deltaSetLike.img)).toBe(false);
    // Poly/stroke/grad can still rich-idle on Canvas overflow; text stays SVG-only.
    expect(canIdlePaintOnCanvas(doc.deltaSetLike.poly)).toBe(true);
    expect(canIdlePaintOnCanvas(doc.deltaSetLike.stroke)).toBe(true);
    expect(canIdlePaintOnCanvas(doc.deltaSetLike.grad)).toBe(true);
    expect(canIdlePaintOnCanvas(doc.deltaSetLike.txt)).toBe(false);
  });
});
