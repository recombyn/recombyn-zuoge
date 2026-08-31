import { describe, expect, it } from 'vitest';
import { createEmptyDocument, addNodeToDocument } from '@/components/rcb/scene/document/sceneDocument';
import { RcbSpatialIndex } from '@/components/rcb/core/spatialIndex';
import {
  createSceneRenderBuffer,
  syncSceneRenderBufferFromDocument,
  syncSceneRenderBufferIncremental,
  hitTestSoaBuffer,
  hitTestSoaBufferOrdered,
  forEachVisibleInRect,
  applySoaHostPromotion,
  upsertSoaGeom,
  markSoaDirtyById,
  packCssColor,
  SOA_FLAG_CANVAS_IDLE,
  SOA_FLAG_VISIBLE,
  SOA_FLAG_DIRTY,
} from '../sceneRenderBuffer';

describe('sceneRenderBuffer', () => {
  it('packs hex colors', () => {
    expect(packCssColor('#3366aa') >>> 0).toBe((0xff000000 | 0x3366aa) >>> 0);
  });

  it('syncs 1000 rects into SoA and hits the topmost', () => {
    let doc = createEmptyDocument({ width: 4000, height: 4000, emptyWorld: true });
    for (let i = 0; i < 1000; i += 1) {
      const id = `r${i}`;
      doc = addNodeToDocument(doc, id, {
        id,
        key: 'shape',
        x: (i % 40) * 20,
        y: Math.floor(i / 40) * 20,
        width: 16,
        height: 16,
        attrs: { shapeType: 'rect', fill: '#112233', 'stroke-enabled': false },
        children: [],
      });
    }
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    expect(buf.count).toBe(1000);
    expect(buf.flags[0] & SOA_FLAG_VISIBLE).toBeTruthy();
    expect(buf.flags[0] & SOA_FLAG_CANVAS_IDLE).toBeTruthy();
    const hit = hitTestSoaBuffer(buf, 8, 8);
    expect(hit).toBeTruthy();
  });

  it('incremental patch updates geometry', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'a', {
      id: 'a',
      key: 'shape',
      x: 10,
      y: 10,
      width: 40,
      height: 40,
      attrs: { shapeType: 'rect', fill: '#ff0000' },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    const idx = buf.indexById.get('a')!;
    expect(buf.positions[idx * 4]).toBe(10);

    doc = {
      ...doc,
      deltaSetLike: {
        ...doc.deltaSetLike,
        a: { ...doc.deltaSetLike.a, x: 100, y: 50 },
      },
    };
    syncSceneRenderBufferIncremental(buf, doc, ['a']);
    expect(buf.positions[idx * 4]).toBe(100);
    expect(buf.positions[idx * 4 + 1]).toBe(50);
  });

  it('samples path polylines into SoA world coords', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'p', {
      id: 'p',
      key: 'shape',
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      attrs: {
        shapeType: 'pen',
        path: 'M 0 0 L 50 0 L 50 40',
        stroke: '#112233',
        closed: 'false',
      },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    const idx = buf.indexById.get('p')!;
    expect(buf.kinds[idx]).toBe(3); // SOA_KIND_PATH
    expect(buf.pathLen[idx]).toBe(3);
    expect(buf.pathStart[idx]).toBeGreaterThanOrEqual(0);
    const base = buf.pathStart[idx] * 2;
    expect(buf.pathXY[base]).toBe(10);
    expect(buf.pathXY[base + 1]).toBe(20);
    expect(buf.pathXY[base + 2]).toBe(60);
    expect(buf.pathXY[base + 3]).toBe(20);
  });

  it('promotes selected hosts off SoA idle paint/pick', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'a', {
      id: 'a',
      key: 'shape',
      x: 10,
      y: 10,
      width: 40,
      height: 40,
      attrs: { shapeType: 'rect', fill: '#ff0000', 'stroke-enabled': false },
      children: [],
    });
    doc = addNodeToDocument(doc, 'b', {
      id: 'b',
      key: 'shape',
      x: 100,
      y: 10,
      width: 40,
      height: 40,
      attrs: { shapeType: 'rect', fill: '#00ff00', 'stroke-enabled': false },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    const ia = buf.indexById.get('a')!;
    const ib = buf.indexById.get('b')!;
    expect(buf.flags[ia] & SOA_FLAG_CANVAS_IDLE).toBeTruthy();
    expect(buf.flags[ib] & SOA_FLAG_CANVAS_IDLE).toBeTruthy();

    applySoaHostPromotion(buf, new Set(['a']));
    expect(buf.flags[ia] & SOA_FLAG_CANVAS_IDLE).toBeFalsy();
    expect(buf.flags[ib] & SOA_FLAG_CANVAS_IDLE).toBeTruthy();
    expect(hitTestSoaBufferOrdered(buf, 20, 20, ['a', 'b'])).toBeNull();
    expect(hitTestSoaBufferOrdered(buf, 110, 20, ['a', 'b'])).toBe('b');

    applySoaHostPromotion(buf, new Set());
    expect(buf.flags[ia] & SOA_FLAG_CANVAS_IDLE).toBeTruthy();
    expect(hitTestSoaBufferOrdered(buf, 20, 20, ['a', 'b'])).toBe('a');
  });

  it('upsertSoaGeom + markSoaDirty update an existing slot', () => {
    const buf = createSceneRenderBuffer();
    const i = upsertSoaGeom(buf, 'x', { x: 1, y: 2, w: 10, h: 12, color: 0xff112233 });
    expect(buf.count).toBe(1);
    expect(buf.positions[i * 4]).toBe(1);
    markSoaDirtyById(buf, 'x');
    expect(buf.flags[i] & SOA_FLAG_DIRTY).toBeTruthy();
  });

  it('syncs 100k rects and supports ordered hit + spatial from buffer', () => {
    const children: string[] = [];
    const deltaSetLike: Record<string, unknown> = {
      ROOT: { id: 'ROOT', children },
    };
    for (let i = 0; i < 100_000; i += 1) {
      const id = `r${i}`;
      children.push(id);
      deltaSetLike[id] = {
        id,
        key: 'shape',
        x: (i % 400) * 40,
        y: Math.floor(i / 400) * 40,
        width: 20,
        height: 20,
        attrs: { shapeType: 'rect', fill: '#112233', 'stroke-enabled': false },
        children: [],
      };
    }
    const doc = createEmptyDocument({ width: 20000, height: 20000, emptyWorld: true });
    const fullDoc = {
      ...doc,
      deltaSetLike: { ...doc.deltaSetLike, ...deltaSetLike, ROOT: { ...doc.deltaSetLike.ROOT, children } },
      stackOrder: children.map((id) => `node:${id}`),
    };
    const buf = createSceneRenderBuffer(100_000);
    const t0 = performance.now();
    syncSceneRenderBufferFromDocument(buf, fullDoc as never);
    const syncMs = performance.now() - t0;
    expect(buf.count).toBe(100_000);
    expect(syncMs).toBeLessThan(15_000);

    const lastId = 'r99999';
    const idx = buf.indexById.get(lastId)!;
    const ox = buf.positions[idx * 4];
    const oy = buf.positions[idx * 4 + 1];
    expect(hitTestSoaBufferOrdered(buf, ox + 10, oy + 10, [lastId])).toBe(lastId);

    let vis = 0;
    forEachVisibleInRect(buf, { minX: 0, minY: 0, maxX: 200, maxY: 200 }, () => {
      vis += 1;
    });
    expect(vis).toBeGreaterThan(0);

    const spatial = RcbSpatialIndex.fromRenderBuffer(buf);
    expect(spatial.size).toBe(100_000);
    const hits = spatial.search(ox, oy, ox + 20, oy + 20);
    expect(hits.some((h) => h.id === lastId)).toBe(true);
  });
});
