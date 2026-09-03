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
  SOA_FLAG_BASIC_GEOM,
  SOA_FLAG_FREE,
  SOA_KIND_LINE,
} from '../sceneRenderBuffer';
import {
  SOA_BAKE_COUNT_THRESHOLD,
  accumulateSoaGestureDirtyFromBuffer,
  clearSoaGestureDirtyAccum,
  collectReadySoaBakeTilesForView,
  computeSoaIdleBounds,
  createSoaBakeCache,
  ensureSoaBake,
  ensureSoaBakeTile,
  invalidateSoaBakeTilesForDirty,
  peekSoaGestureDirtyAccum,
  shouldUseSoaBake,
  setSoaCameraGestureActive,
  isSoaBakePathAllowed,
  tileKey,
  tilesForView,
  unionSoaDirtyAabb,
} from '../soaBakeLayer';

afterEach(() => {
  clearNodeTransformPreviews();
  clearSoaGestureDirtyAccum();
  setSoaCameraGestureActive(false);
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

  it('gesture dirty accum keeps S-curve mid peaks across frames', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'a', {
      id: 'a',
      key: 'shape',
      x: 10,
      y: 200,
      width: 40,
      height: 30,
      attrs: { shapeType: 'rect', fill: '#fff' },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    // Peak above both endpoints — single-frame base↔current AABB misses it.
    setNodeTransformPreviews([{ nodeId: 'a', left: 100, top: 40, width: 40, height: 30 }]);
    markAllSoaDirty(buf);
    accumulateSoaGestureDirtyFromBuffer(buf);
    setNodeTransformPreviews([{ nodeId: 'a', left: 200, top: 200, width: 40, height: 30 }]);
    markAllSoaDirty(buf);
    accumulateSoaGestureDirtyFromBuffer(buf);
    const accum = peekSoaGestureDirtyAccum();
    expect(accum).not.toBeNull();
    expect(accum!.top).toBeLessThanOrEqual(40);
    expect(accum!.left + accum!.width).toBeGreaterThanOrEqual(240);
    // Single-frame union at the end alone would start near y=200 and miss y=40.
    const endOnly = unionSoaDirtyAabb(buf);
    expect(endOnly!.top).toBeGreaterThan(40);
  });

  it('shouldUseSoaBake respects threshold of idle basic slots', () => {
    const buf = createSceneRenderBuffer(SOA_BAKE_COUNT_THRESHOLD);
    buf.count = SOA_BAKE_COUNT_THRESHOLD - 1;
    for (let i = 0; i < buf.count; i += 1) {
      buf.flags[i] = (SOA_FLAG_CANVAS_IDLE | SOA_FLAG_VISIBLE | SOA_FLAG_BASIC_GEOM) >>> 0;
    }
    expect(shouldUseSoaBake(buf)).toBe(false);
    buf.count = SOA_BAKE_COUNT_THRESHOLD;
    for (let i = 0; i < buf.count; i += 1) {
      buf.flags[i] = (SOA_FLAG_CANVAS_IDLE | SOA_FLAG_VISIBLE | SOA_FLAG_BASIC_GEOM) >>> 0;
    }
    expect(shouldUseSoaBake(buf)).toBe(true);
    // High count of FREE holes must not engage bake.
    for (let i = 0; i < buf.count; i += 1) {
      buf.flags[i] = SOA_FLAG_FREE;
    }
    expect(shouldUseSoaBake(buf)).toBe(false);
  });

  it('collectReadySoaBakeTilesForView streams new tiles across frames', () => {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    if (!probe.getContext('2d')) return;

    const buf = createSceneRenderBuffer(SOA_BAKE_COUNT_THRESHOLD);
    buf.count = SOA_BAKE_COUNT_THRESHOLD;
    buf.revision = 1;
    const idle =
      (SOA_FLAG_CANVAS_IDLE | SOA_FLAG_VISIBLE | SOA_FLAG_BASIC_GEOM) >>> 0;
    for (let i = 0; i < buf.count; i += 1) {
      const o = i * 4;
      buf.positions[o] = (i % 4) * 2200;
      buf.positions[o + 1] = Math.floor(i / 4) * 2200;
      buf.positions[o + 2] = 40;
      buf.positions[o + 3] = 40;
      buf.kinds[i] = 0;
      buf.flags[i] = idle;
      buf.colors[i] = 0xffaabbcc;
    }
    const bake = ensureSoaBake(buf, null);
    expect(bake?.tiled).toBe(true);
    const view = { x: 0, y: 0, width: 5000, height: 5000 };
    // Vitest uses sync budget (2 tiles / frame).
    const first = collectReadySoaBakeTilesForView(buf, view);
    expect(first.pending).toBe(true);
    expect(first.tiles.length).toBeGreaterThan(0);
    const second = collectReadySoaBakeTilesForView(buf, view);
    expect(typeof second.pending).toBe('boolean');
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
    const idle =
      (SOA_FLAG_CANVAS_IDLE | SOA_FLAG_VISIBLE | SOA_FLAG_BASIC_GEOM) >>> 0;
    for (let i = 0; i < buf.count; i += 1) {
      const o = i * 4;
      buf.positions[o] = (i % 40) * 10;
      buf.positions[o + 1] = Math.floor(i / 40) * 10;
      buf.positions[o + 2] = 8;
      buf.positions[o + 3] = 8;
      buf.kinds[i] = 0;
      buf.flags[i] = idle;
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

  it('camera gesture disables bake path until settle', () => {
    setSoaCameraGestureActive(false);
    expect(isSoaBakePathAllowed()).toBe(true);
    setSoaCameraGestureActive(true);
    expect(isSoaBakePathAllowed()).toBe(false);
    setSoaCameraGestureActive(false);
    expect(isSoaBakePathAllowed()).toBe(true);
  });
});
