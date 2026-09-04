import { describe, expect, it } from 'vitest';
import { createEmptyDocument, addNodeToDocument } from '@/components/rcb/scene/document/sceneDocument';
import {
  createSceneRenderBuffer,
  rebuildSoaPathSamples,
  syncSceneRenderBufferFromDocument,
  SOA_FLAG_CANVAS_IDLE,
} from '../sceneRenderBuffer';
import {
  collectSoaWebglInstances,
  soaPathPrefersAtlasStamp,
  SOA_WEBGL_NO_CLIP,
} from '../webglSceneRenderer';
import { createSoaWebglAtlas, SOA_ATLAS_SEG_THRESHOLD } from '../webglInstanceAtlas';

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
    // Default shape stroke uses SDF rounded path (kind 4), not sharp instanced quad.
    expect(kinds).toContain(4);
    expect(kinds).toContain(1);
    expect(angles.every((a) => a === 0)).toBe(true);
  });

  it('packs stroke-disabled sharp rect as kind 0', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'r', {
      id: 'r',
      key: 'shape',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      attrs: {
        shapeType: 'rect',
        fill: '#ff0000',
        'stroke-enabled': false,
      },
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
    expect(kinds).toEqual([0]);
  });

  it('packs rounded rect as shader SDF kind 4 with radii in uvs', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'r', {
      id: 'r',
      key: 'shape',
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      attrs: {
        shapeType: 'rect',
        fill: '#ffffff',
        cornerRadius: 20,
        'stroke-enabled': false,
      },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    buf.flags[0] = (buf.flags[0] | SOA_FLAG_CANVAS_IDLE) >>> 0;
    const rects: number[] = [];
    const colors: number[] = [];
    const kinds: number[] = [];
    const angles: number[] = [];
    const uvs: number[] = [];
    const strokes: number[] = [];
    collectSoaWebglInstances(buf, { x: 0, y: 0, width: 200, height: 200 }, rects, colors, kinds, angles, uvs, {
      strokes,
    });
    expect(kinds).toEqual([4]);
    expect(uvs[0]).toBeGreaterThan(0);
    expect(strokes).toEqual([0, 0, 0, 0]);
  });

  it('packs line as oriented thin quad from world path polyline', () => {
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
    rebuildSoaPathSamples(buf, doc);
    buf.flags[0] = (buf.flags[0] | SOA_FLAG_CANVAS_IDLE) >>> 0;
    const rects: number[] = [];
    const colors: number[] = [];
    const kinds: number[] = [];
    const angles: number[] = [];
    collectSoaWebglInstances(buf, { x: 0, y: 0, width: 200, height: 200 }, rects, colors, kinds, angles);
    expect(kinds).toEqual([2]);
    expect(rects[2]).toBeGreaterThan(0);
    expect(rects[3]).toBe(1);
    expect(Number.isFinite(angles[0])).toBe(true);
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

  it('prefers atlas stamp only for closed pens (open stays crisp segments)', () => {
    // Closed fills need atlas; open strokes must not rasterize into a cell or
    // they look thicker/softer than the SVG draw preview after finish.
    expect(soaPathPrefersAtlasStamp(true, 3)).toBe(true);
    expect(soaPathPrefersAtlasStamp(false, 3)).toBe(false);
    expect(soaPathPrefersAtlasStamp(false, SOA_ATLAS_SEG_THRESHOLD)).toBe(false);
  });

  it('open pen segments use strokeColors when fill colors is 0', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'p', {
      id: 'p',
      key: 'shape',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      attrs: {
        shapeType: 'pen',
        path: 'M 0 0 L 40 0 L 40 40',
        stroke: '#112233',
        'border-color': '#112233',
        'border-width': 1,
        'fill-color': 'transparent',
        closed: 'false',
      },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    rebuildSoaPathSamples(buf, doc);
    buf.flags[0] = (buf.flags[0] | SOA_FLAG_CANVAS_IDLE) >>> 0;
    expect(buf.colors[0]).toBe(0);
    expect(buf.strokeColors[0]).toBeTruthy();
    const colors: number[] = [];
    const kinds: number[] = [];
    collectSoaWebglInstances(
      buf,
      { x: 0, y: 0, width: 200, height: 200 },
      [],
      colors,
      kinds,
      [],
      []
    );
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((k) => k === 2)).toBe(true);
    // First instance RGBA — opaque ink from strokeColors, not transparent fill.
    expect(colors[3]).toBeGreaterThan(0.9);
  });

  it('closed stroked path stamps fill atlas then emits crisp stroke segments', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'b', {
      id: 'b',
      key: 'shape',
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      attrs: {
        shapeType: 'path',
        path: 'M0 0 H100 V80 H0 Z',
        closed: 'true',
        'fill-color': '#ffffff',
        'fill-rule': 'evenodd',
        'stroke-enabled': true,
        'border-width': 4,
        'border-color': '#111111',
        stroke: '#111111',
      },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    rebuildSoaPathSamples(buf, doc);
    buf.flags[0] = (buf.flags[0] | SOA_FLAG_CANVAS_IDLE) >>> 0;
    const atlas = createSoaWebglAtlas(512, 128);
    if (!atlas) return;
    const kinds: number[] = [];
    collectSoaWebglInstances(
      buf,
      { x: 0, y: 0, width: 200, height: 200 },
      [],
      [],
      kinds,
      [],
      [],
      { atlas, document: doc }
    );
    expect(kinds.includes(3)).toBe(true);
    expect(kinds.some((k) => k === 2)).toBe(true);
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
    expect(buf.colors[0]).toBeTruthy();
    // Frame-local live offset used to block atlas → stroke-only ghost; still no segments.
    buf.positions[0] = 0;
    buf.positions[1] = 0;
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

  it('packs clipContent LTRB for frame-owned idle slots', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = {
      ...doc,
      frames: [{ id: 'f1', x: 100, y: 50, width: 200, height: 150, clipContent: true }],
    };
    doc = addNodeToDocument(doc, 'r', {
      id: 'r',
      key: 'shape',
      x: 10,
      y: 10,
      width: 40,
      height: 40,
      attrs: { shapeType: 'rect', fill: '#ff0000', frameId: 'f1' },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    buf.flags[0] = (buf.flags[0] | SOA_FLAG_CANVAS_IDLE) >>> 0;
    const clips: number[] = [];
    collectSoaWebglInstances(
      buf,
      { x: 0, y: 0, width: 800, height: 600 },
      [],
      [],
      [],
      [],
      [],
      { clips, document: doc }
    );
    expect(clips).toEqual([100, 50, 300, 200]);
  });

  it('uses open clip when clipContent is off', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = {
      ...doc,
      frames: [{ id: 'f1', x: 100, y: 50, width: 200, height: 150, clipContent: false }],
    };
    doc = addNodeToDocument(doc, 'r', {
      id: 'r',
      key: 'shape',
      x: 10,
      y: 10,
      width: 40,
      height: 40,
      attrs: { shapeType: 'rect', fill: '#ff0000', frameId: 'f1' },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    buf.flags[0] = (buf.flags[0] | SOA_FLAG_CANVAS_IDLE) >>> 0;
    const clips: number[] = [];
    collectSoaWebglInstances(
      buf,
      { x: 0, y: 0, width: 800, height: 600 },
      [],
      [],
      [],
      [],
      [],
      { clips, document: doc }
    );
    expect(clips).toEqual([
      SOA_WEBGL_NO_CLIP[0],
      SOA_WEBGL_NO_CLIP[1],
      SOA_WEBGL_NO_CLIP[2],
      SOA_WEBGL_NO_CLIP[3],
    ]);
  });

  it('floors kind-4 stroke width at low zoom so hairlines survive', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'r', {
      id: 'r',
      key: 'shape',
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      attrs: {
        shapeType: 'rect',
        fill: '#ff0000',
        'stroke-enabled': true,
        'border-width': 2,
        'border-color': '#000000',
      },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    buf.flags[0] = (buf.flags[0] | SOA_FLAG_CANVAS_IDLE) >>> 0;
    const strokes: number[] = [];
    collectSoaWebglInstances(
      buf,
      { x: 0, y: 0, width: 100, height: 100 },
      [],
      [],
      [],
      [],
      [],
      { strokes, zoom: 0.25 }
    );
    // aStroke.w = floored scene width (2 → 4 at 0.25 zoom for 1 CSS px floor).
    expect(strokes[3]).toBe(4);
  });
});
