import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyDocument, addNodeToDocument } from '@/components/rcb/scene/document/sceneDocument';
import { clearNodeTransformPreviews, setNodeTransformPreviews } from '@/components/rcb/core/transformPreview';
import {
  createSceneRenderBuffer,
  syncSceneRenderBufferFromDocument,
  hitTestSoaSlot,
  hitSoaRoundedRectLocal,
  hitSoaPolylineFill,
  SOA_FLAG_CANVAS_IDLE,
} from '../sceneRenderBuffer';

afterEach(() => {
  clearNodeTransformPreviews();
});

describe('SoA hit / paint parity', () => {
  it('rounded rect rejects outside corner circles (not AABB)', () => {
    expect(hitSoaRoundedRectLocal(1, 1, 100, 80, 20, 20, 20, 20)).toBe(false);
    expect(hitSoaRoundedRectLocal(20, 20, 100, 80, 20, 20, 20, 20)).toBe(true);
    expect(hitSoaRoundedRectLocal(50, 40, 100, 80, 20, 20, 20, 20)).toBe(true);
  });

  it('hitTestSoaSlot uses radii for rounded idle rects', () => {
    let doc = createEmptyDocument({ width: 400, height: 400, emptyWorld: true });
    doc = addNodeToDocument(doc, 'r', {
      id: 'r',
      key: 'shape',
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      attrs: {
        shapeType: 'rect',
        fill: '#fff',
        'fill-color': '#fff',
        'stroke-enabled': false,
        cornerRadius: 20,
        radiusLinked: true,
      },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    buf.flags[0] = (buf.flags[0] | SOA_FLAG_CANVAS_IDLE) >>> 0;
    // Outside rounded TL corner — AABB would hit, paint misses.
    expect(hitTestSoaSlot(buf, 0, 1, 1)).toBe(false);
    expect(hitTestSoaSlot(buf, 0, 50, 40)).toBe(true);
  });

  it('TransformPreview angle rotates SoA hit with paint', () => {
    let doc = createEmptyDocument({ width: 400, height: 400, emptyWorld: true });
    doc = addNodeToDocument(doc, 'r', {
      id: 'r',
      key: 'shape',
      x: 40,
      y: 40,
      width: 20,
      height: 20,
      attrs: {
        shapeType: 'rect',
        fill: '#fff',
        'fill-color': '#fff',
        'stroke-enabled': false,
      },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    buf.flags[0] = (buf.flags[0] | SOA_FLAG_CANVAS_IDLE) >>> 0;
    // Unrotated: point to the right of the box is a miss.
    expect(hitTestSoaSlot(buf, 0, 70, 50)).toBe(false);
    setNodeTransformPreviews([
      { nodeId: 'r', left: 40, top: 40, width: 20, height: 20, angle: 45 },
    ]);
    // After 45° rotate about center, a point near the diamond tip is inside.
    expect(hitTestSoaSlot(buf, 0, 50 + 12, 50)).toBe(true);
    // Far outside still misses.
    expect(hitTestSoaSlot(buf, 0, 90, 50)).toBe(false);
  });

  it('closed path fill uses polyline interior, not AABB', () => {
    // Triangle pointing up: tip at top-center; AABB corners are outside the fill.
    const xy = new Float32Array([50, 10, 90, 90, 10, 90]);
    expect(hitSoaPolylineFill(xy, 0, 3, 0, 0, 50, 50)).toBe(true);
    expect(hitSoaPolylineFill(xy, 0, 3, 0, 0, 12, 12)).toBe(false);
    expect(hitSoaPolylineFill(xy, 0, 3, 0, 0, 88, 12)).toBe(false);
  });

  it('hitTestSoaSlot closed pen fill matches polyline, not AABB', () => {
    let doc = createEmptyDocument({ width: 400, height: 400, emptyWorld: true });
    doc = addNodeToDocument(doc, 'pen', {
      id: 'pen',
      key: 'shape',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      attrs: {
        shapeType: 'pen',
        path: 'M 50 10 L 90 90 L 10 90 Z',
        closed: 'true',
        fill: '#8b1a1a',
        'fill-color': '#8b1a1a',
        'stroke-enabled': false,
      },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    buf.flags[0] = (buf.flags[0] | SOA_FLAG_CANVAS_IDLE) >>> 0;
    expect(buf.pathClosed[0]).toBe(1);
    expect(hitTestSoaSlot(buf, 0, 50, 50)).toBe(true);
    // Near AABB corner, outside the triangle.
    expect(hitTestSoaSlot(buf, 0, 5, 5)).toBe(false);
  });
});
