import { describe, expect, it } from 'vitest';
import { createEmptyDocument, addNodeToDocument } from '@/components/rcb/scene/document/sceneDocument';
import {
  createSceneRenderBuffer,
  syncSceneRenderBufferFromDocument,
  SOA_FLAG_CANVAS_IDLE,
} from '../sceneRenderBuffer';
import {
  collectSoaWebglInstances,
  soaPathPrefersAtlasStamp,
} from '../webglSceneRenderer';
import { SOA_ATLAS_SEG_THRESHOLD } from '../webglInstanceAtlas';

describe('collectSoaWebglInstances', () => {
  it('packs rect and ellipse in view', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'r', {
      id: 'r',
      key: 'shape',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      attrs: { shapeType: 'rect', fill: '#ff0000' },
      children: [],
    });
    doc = addNodeToDocument(doc, 'e', {
      id: 'e',
      key: 'shape',
      x: 20,
      y: 0,
      width: 10,
      height: 10,
      attrs: { shapeType: 'ellipse', fill: '#00ff00' },
      children: [],
    });
    doc = addNodeToDocument(doc, 'far', {
      id: 'far',
      key: 'shape',
      x: 9000,
      y: 9000,
      width: 10,
      height: 10,
      attrs: { shapeType: 'rect', fill: '#0000ff' },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    for (let i = 0; i < buf.count; i += 1) {
      buf.flags[i] = (buf.flags[i] | SOA_FLAG_CANVAS_IDLE) >>> 0;
    }
    const rects: number[] = [];
    const colors: number[] = [];
    const kinds: number[] = [];
    const angles: number[] = [];
    collectSoaWebglInstances(buf, { x: 0, y: 0, width: 100, height: 100 }, rects, colors, kinds, angles);
    expect(kinds.length).toBe(2);
    expect(kinds).toContain(0);
    expect(kinds).toContain(1);
    expect(angles.every((a) => a === 0)).toBe(true);
  });

  it('packs line as oriented thin quad', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'ln', {
      id: 'ln',
      key: 'shape',
      x: 0,
      y: 0,
      width: 30,
      height: 40,
      attrs: { shapeType: 'line', stroke: '#111111' },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    buf.flags[0] = (buf.flags[0] | SOA_FLAG_CANVAS_IDLE) >>> 0;
    const rects: number[] = [];
    const colors: number[] = [];
    const kinds: number[] = [];
    const angles: number[] = [];
    collectSoaWebglInstances(buf, { x: 0, y: 0, width: 100, height: 100 }, rects, colors, kinds, angles);
    expect(kinds).toEqual([2]);
    expect(rects[0]).toBe(0);
    expect(rects[1]).toBe(0);
    expect(rects[2]).toBeCloseTo(50, 5); // hypot(30,40)
    // resolveStroke defaults missing border-width to 1
    expect(rects[3]).toBe(1);
    expect(angles[0]).toBeCloseTo(Math.atan2(40, 30), 5);
  });

  it('uses document border-width for line thickness', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'ln', {
      id: 'ln',
      key: 'shape',
      x: 0,
      y: 0,
      width: 40,
      height: 0,
      attrs: { shapeType: 'line', stroke: '#111111', 'border-width': 6 },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    buf.flags[0] = (buf.flags[0] | SOA_FLAG_CANVAS_IDLE) >>> 0;
    expect(buf.strokeWidths[0]).toBe(6);
    const rects: number[] = [];
    const colors: number[] = [];
    const kinds: number[] = [];
    const angles: number[] = [];
    collectSoaWebglInstances(buf, { x: 0, y: 0, width: 100, height: 100 }, rects, colors, kinds, angles);
    expect(kinds).toEqual([2]);
    expect(rects[3]).toBe(6);
  });

  it('packs path samples as segment batch', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'p', {
      id: 'p',
      key: 'shape',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      attrs: { shapeType: 'pen', path: 'M 0 0 L 10 0 L 10 10', stroke: '#000' },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    buf.flags[0] = (buf.flags[0] | SOA_FLAG_CANVAS_IDLE) >>> 0;
    const rects: number[] = [];
    const colors: number[] = [];
    const kinds: number[] = [];
    const angles: number[] = [];
    collectSoaWebglInstances(buf, { x: 0, y: 0, width: 200, height: 200 }, rects, colors, kinds, angles);
    expect(kinds.length).toBe(2);
    expect(kinds.every((k) => k === 2)).toBe(true);
  });

  it('prefers atlas stamp for closed pens even below segment threshold', () => {
    // Regression: sparse closed fills used stroke-only instances → fill vanished when deselected.
    expect(soaPathPrefersAtlasStamp(true, 3)).toBe(true);
    expect(soaPathPrefersAtlasStamp(false, 3)).toBe(false);
    expect(soaPathPrefersAtlasStamp(false, SOA_ATLAS_SEG_THRESHOLD)).toBe(true);
  });

  it('skips stroke-only segment fallback for closed pens without atlas', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'pen', {
      id: 'pen',
      key: 'shape',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      attrs: {
        shapeType: 'pen',
        path: 'M 10 10 L 90 10 L 50 90 Z',
        closed: 'true',
        fill: '#8b1a1a',
        'fill-color': '#8b1a1a',
      },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    buf.flags[0] = (buf.flags[0] | SOA_FLAG_CANVAS_IDLE) >>> 0;
    expect(buf.pathClosed[0]).toBe(1);
    const kinds: number[] = [];
    collectSoaWebglInstances(
      buf,
      { x: 0, y: 0, width: 200, height: 200 },
      [],
      [],
      kinds,
      [],
      []
    );
    // Prefer invisible idle over border-only ghost when atlas is unavailable.
    expect(kinds).toEqual([]);
  });
});
