import { describe, expect, it, afterEach } from 'vitest';
import { createEmptyDocument, addNodeToDocument } from '@/components/rcb/scene/document/sceneDocument';
import {
  clearNodeTransformPreviews,
  setNodeTransformPreviews,
} from '@/components/rcb/core/transformPreview';
import {
  createSceneRenderBuffer,
  markAllSoaDirty,
  syncSceneRenderBufferFromDocument,
  SOA_FLAG_DIRTY,
  SOA_FLAG_CANVAS_IDLE,
  SOA_FLAG_VISIBLE,
  SOA_KIND_LINE,
} from '../sceneRenderBuffer';
import {
  SOA_BAKE_COUNT_THRESHOLD,
  computeSoaIdleBounds,
  createSoaBakeCache,
  ensureSoaBake,
  ensureSoaBakeTile,
  invalidateSoaBakeTilesForDirty,
  shouldUseSoaBake,
  tileKey,
  tilesForView,
  unionSoaDirtyAabb,
} from '../soaBakeLayer';

afterEach(() => {
  clearNodeTransformPreviews();
});

describe('soa dirty + bake helpers', () => {
  it('unionSoaDirtyAabb tracks dirty slots only', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'a', {
      id: 'a',
      key: 'shape',
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      attrs: { shapeType: 'rect', fill: '#fff' },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    // sync marks dirty
    expect(buf.flags[0] & SOA_FLAG_DIRTY).toBeTruthy();
    const box = unionSoaDirtyAabb(buf);
    expect(box?.left).toBe(10);
    expect(box?.top).toBe(20);
    buf.flags[0] = (buf.flags[0] & ~SOA_FLAG_DIRTY) >>> 0;
    expect(unionSoaDirtyAabb(buf)).toBeNull();
    markAllSoaDirty(buf);
    expect(unionSoaDirtyAabb(buf)).not.toBeNull();
  });

  it('unionSoaDirtyAabb includes promoted (non-idle) dirty slots', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'a', {
      id: 'a',
      key: 'shape',
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      attrs: { shapeType: 'rect', fill: '#fff' },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    // Promote off Canvas but keep DIRTY so the hole is cleared.
    buf.flags[0] = (SOA_FLAG_VISIBLE | SOA_FLAG_DIRTY) >>> 0;
    const box = unionSoaDirtyAabb(buf);
    expect(box?.left).toBe(10);
    expect(box?.top).toBe(20);
  });

  it('unionSoaDirtyAabb unions document + TransformPreview trail', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'a', {
      id: 'a',
      key: 'shape',
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      attrs: { shapeType: 'rect', fill: '#fff' },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    setNodeTransformPreviews([{ nodeId: 'a', left: 100, top: 20, width: 30, height: 40 }]);
    const box = unionSoaDirtyAabb(buf);
    expect(box?.left).toBe(10);
    expect(box?.top).toBe(20);
    expect(box?.width).toBeGreaterThanOrEqual(120);
    expect(box?.height).toBeGreaterThanOrEqual(40);
  });

  it('shouldUseSoaBake respects threshold', () => {
    const buf = createSceneRenderBuffer(SOA_BAKE_COUNT_THRESHOLD);
    buf.count = SOA_BAKE_COUNT_THRESHOLD - 1;
    expect(shouldUseSoaBake(buf)).toBe(false);
    buf.count = SOA_BAKE_COUNT_THRESHOLD;
    expect(shouldUseSoaBake(buf)).toBe(true);
  });

  it('computeSoaIdleBounds returns null when empty', () => {
    const buf = createSceneRenderBuffer();
    expect(computeSoaIdleBounds(buf)).toBeNull();
  });

  it('tilesForView covers the viewport AABB', () => {
    const tiles = tilesForView({ x: 100, y: 100, width: 2100, height: 100 }, 2048);
    expect(tiles.length).toBeGreaterThanOrEqual(2);
    expect(tiles[0].bounds.width).toBe(2048);
    expect(tileKey(tiles[0].tx, tiles[0].ty)).toBe(`${tiles[0].tx},${tiles[0].ty}`);
  });

  it('ensureSoaBake marks tiled shell; ensureSoaBakeTile paints when 2d exists', () => {
    const buf = createSceneRenderBuffer(SOA_BAKE_COUNT_THRESHOLD);
    buf.count = SOA_BAKE_COUNT_THRESHOLD;
    buf.revision = 1;
    for (let i = 0; i < 4; i += 1) {
      const o = i * 4;
      buf.positions[o] = i * 10;
      buf.positions[o + 1] = 0;
      buf.positions[o + 2] = 8;
      buf.positions[o + 3] = 8;
      buf.kinds[i] = 0;
      buf.flags[i] = (SOA_FLAG_CANVAS_IDLE | SOA_FLAG_VISIBLE) >>> 0;
      buf.colors[i] = 0xffaabbcc;
    }
    expect(shouldUseSoaBake(buf)).toBe(true);
    const bake = ensureSoaBake(buf, null);
    expect(bake?.tiled).toBe(true);
    expect(bake?.valid).toBe(true);

    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    if (!probe.getContext('2d')) {
      // jsdom without node-canvas — shell APIs still covered above.
      return;
    }

    const cache = createSoaBakeCache();
    const tile = ensureSoaBakeTile(buf, cache, 0, 0, {
      left: 0,
      top: 0,
      width: 2048,
      height: 2048,
    });
    expect(tile).not.toBeNull();
    expect(tile!.canvas.width).toBeGreaterThan(0);
    expect(cache.tiles.has('0,0')).toBe(true);
  });

  it('computeSoaIdleBounds includes line endpoints', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'ln', {
      id: 'ln',
      key: 'shape',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      attrs: { shapeType: 'line', stroke: '#111' },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    buf.flags[0] = (buf.flags[0] | SOA_FLAG_CANVAS_IDLE) >>> 0;
    expect(buf.kinds[0]).toBe(SOA_KIND_LINE);
    const box = computeSoaIdleBounds(buf);
    expect(box?.width).toBeGreaterThanOrEqual(100);
    expect(box?.height).toBeGreaterThanOrEqual(50);
  });

  it('invalidateSoaBakeTilesForDirty drops overlapping tiles and clears dirty', () => {
    const buf = createSceneRenderBuffer(4);
    buf.count = 1;
    buf.revision = 1;
    buf.positions[0] = 10;
    buf.positions[1] = 10;
    buf.positions[2] = 20;
    buf.positions[3] = 20;
    buf.flags[0] = (SOA_FLAG_DIRTY | SOA_FLAG_CANVAS_IDLE | SOA_FLAG_VISIBLE) >>> 0;
    const cache = createSoaBakeCache();
    cache.bufferRevision = 1;
    cache.tiles.set('0,0', {
      key: '0,0',
      canvas: document.createElement('canvas'),
      bounds: { left: 0, top: 0, width: 2048, height: 2048 },
      bufferRevision: 1,
    });
    cache.lru.push('0,0');
    const dirty = unionSoaDirtyAabb(buf);
    expect(dirty).not.toBeNull();
    const dropped = invalidateSoaBakeTilesForDirty(buf, cache, dirty!);
    expect(dropped).toContain('0,0');
    expect(cache.tiles.has('0,0')).toBe(false);
    expect(buf.flags[0] & SOA_FLAG_DIRTY).toBeFalsy();
  });
});
