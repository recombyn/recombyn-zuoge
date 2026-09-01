import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyDocument, addNodeToDocument } from '@/components/rcb/scene/document/sceneDocument';
import {
  SceneSpatialRuntime,
  setSharedSceneSpatialRuntime,
} from '@/components/rcb/core/spatialIndex';
import {
  getSharedSceneRenderBuffer,
  resetSharedSceneRenderBuffer,
  setSoaCanvasShapesEnabledForTests,
  SOA_FLAG_CANVAS_IDLE,
} from '@/components/rcb/render/sceneRenderBuffer';
import { syncSoaBufferFromDocumentNow } from '../RcbShapesLayer';

describe('syncSoaBufferFromDocumentNow', () => {
  afterEach(() => {
    setSoaCanvasShapesEnabledForTests(null);
    resetSharedSceneRenderBuffer();
    setSharedSceneSpatialRuntime(null);
  });

  it('syncs buffer, promotes selection, and upserts large spatial from SoA', () => {
    setSoaCanvasShapesEnabledForTests(true);
    const runtime = new SceneSpatialRuntime(64);
    setSharedSceneSpatialRuntime(runtime);

    let doc = createEmptyDocument({ width: 4000, height: 4000, emptyWorld: true });
    const ids: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      const id = `n${i}`;
      ids.push(id);
      doc = addNodeToDocument(doc, id, {
        id,
        key: 'shape',
        x: i * 20,
        y: 0,
        width: 16,
        height: 16,
        attrs: { shapeType: 'rect', 'fill-color': '#123456', 'stroke-enabled': false },
        children: [],
      });
    }

    const ok = syncSoaBufferFromDocumentNow(doc, {
      ids,
      forceFullIds: new Set(['n0']),
      fullRebuild: true,
    });
    expect(ok).toBe(true);

    const buf = getSharedSceneRenderBuffer();
    expect(buf.count).toBe(60);
    expect(buf.flags[buf.indexById.get('n0')!] & SOA_FLAG_CANVAS_IDLE).toBeFalsy();
    expect(buf.flags[buf.indexById.get('n1')!] & SOA_FLAG_CANVAS_IDLE).toBeTruthy();
    expect(runtime.index.has('n30')).toBe(true);
    expect(runtime.index.search(600, 0, 620, 20).some((h) => h.id === 'n30')).toBe(true);
  });

  it('no-ops when SoA flag is off', () => {
    setSoaCanvasShapesEnabledForTests(false);
    const doc = createEmptyDocument({ width: 100, height: 100, emptyWorld: true });
    expect(
      syncSoaBufferFromDocumentNow(doc, { ids: [], forceFullIds: [] })
    ).toBe(false);
  });

  it('bulk-inserts large patched batches without full rebuild', () => {
    setSoaCanvasShapesEnabledForTests(true);
    let doc = createEmptyDocument({ width: 2000, height: 2000, emptyWorld: true });
    const ids: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      const id = `n${i}`;
      ids.push(id);
      doc = addNodeToDocument(doc, id, {
        id,
        key: 'shape',
        x: i * 10,
        y: 0,
        width: 8,
        height: 8,
        attrs: { shapeType: 'rect', 'fill-color': '#abc', 'stroke-enabled': false },
        children: [],
      });
    }
    syncSoaBufferFromDocumentNow(doc, { ids, forceFullIds: [], fullRebuild: true });
    const buf = getSharedSceneRenderBuffer();
    const rev0 = buf.revision;

    const patched = ids.slice(0, 12);
    for (const id of patched) {
      const prev = doc.deltaSetLike![id];
      doc = {
        ...doc,
        deltaSetLike: {
          ...doc.deltaSetLike,
          [id]: {
            ...prev,
            x: (Number(prev.x) || 0) + 5,
          },
        },
      };
    }
    syncSoaBufferFromDocumentNow(doc, {
      ids,
      lastPatchedNodeIds: patched,
      forceFullIds: [],
    });
    expect(buf.revision).toBeGreaterThan(rev0);
    expect(buf.count).toBe(40);
    expect(buf.quadtree.size).toBeGreaterThan(0);
    const i0 = buf.indexById.get('n0')!;
    expect(buf.positions[i0 * 4]).toBe(5);
  });
});
