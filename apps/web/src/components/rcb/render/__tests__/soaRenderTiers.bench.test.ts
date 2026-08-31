/**
 * SoA render-engine tier benches (2k / 10k / 100k light rects).
 *
 * Records create (doc+buffer sync), pan cull proxy, hit, and RSS when available.
 * 1M is noted as bake-path only — not first-class editable layers.
 *
 * Run: `npm run test:stress --workspace=apps/web`
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import { createEmptyDocument } from '@/components/rcb/scene/document/sceneDocument';
import { RcbSpatialIndex } from '@/components/rcb/core/spatialIndex';
import {
  createSceneRenderBuffer,
  forEachVisibleInRect,
  hitTestSoaBuffer,
  hitTestSoaBufferOrdered,
  syncSceneRenderBufferFromDocument,
  type SceneRenderBuffer,
} from '../sceneRenderBuffer';
import {
  ensureSoaBake,
  ensureSoaBakeTile,
  getSoaBakeCountThreshold,
  setSharedSoaBakeCache,
  createSoaBakeCache,
  shouldUseSoaBake,
} from '../soaBakeLayer';

type TierRow = {
  n: number;
  buildDocMs: number;
  syncMs: number;
  panCullMs: number;
  panCullVisible: number;
  hitLinearMs: number;
  hitOrderedMs: number;
  spatialBuildMs: number;
  spatialHitCandAvg: number;
  bakeEnsureMs: number | null;
  bakeTiles: number | null;
  rssMb: number | null;
  heapMb: number | null;
  bakeRecommended: boolean;
  bakeThreshold: number;
};

const RESULTS: TierRow[] = [];

function rssMb(): number | null {
  try {
    const mem = (process as NodeJS.Process & { memoryUsage?: () => NodeJS.MemoryUsage }).memoryUsage?.();
    if (!mem) return null;
    return Math.round((mem.rss / (1024 * 1024)) * 10) / 10;
  } catch {
    return null;
  }
}

function heapMb(): number | null {
  try {
    const mem = (process as NodeJS.Process & { memoryUsage?: () => NodeJS.MemoryUsage }).memoryUsage?.();
    if (!mem) return null;
    return Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10;
  } catch {
    return null;
  }
}

function buildLightRectDoc(n: number): SceneDocument {
  const children: string[] = [];
  const deltaSetLike: Record<string, unknown> = {};
  const cols = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i += 1) {
    const id = `r${i}`;
    children.push(id);
    deltaSetLike[id] = {
      id,
      key: 'shape',
      x: (i % cols) * 24,
      y: Math.floor(i / cols) * 24,
      width: 16,
      height: 16,
      attrs: { shapeType: 'rect', fill: i % 2 ? '#334155' : '#94a3b8' },
      children: [],
    };
  }
  const base = createEmptyDocument({
    width: cols * 24 + 64,
    height: Math.ceil(n / cols) * 24 + 64,
    emptyWorld: true,
  });
  return {
    ...base,
    deltaSetLike: {
      ...base.deltaSetLike,
      ...deltaSetLike,
      ROOT: { ...(base.deltaSetLike.ROOT as object), children },
    },
    stackOrder: children.map((id) => `node:${id}`),
  } as SceneDocument;
}

function runTier(n: number): TierRow {
  const tDoc0 = performance.now();
  const doc = buildLightRectDoc(n);
  const buildDocMs = performance.now() - tDoc0;

  const buf = createSceneRenderBuffer(n);
  const tSync0 = performance.now();
  syncSceneRenderBufferFromDocument(buf, doc);
  const syncMs = performance.now() - tSync0;
  expect(buf.count).toBe(n);

  const view = { minX: 0, minY: 0, maxX: 480, maxY: 320 };
  const tCull0 = performance.now();
  let panCullVisible = 0;
  for (let rep = 0; rep < 20; rep += 1) {
    panCullVisible = 0;
    forEachVisibleInRect(buf, view, () => {
      panCullVisible += 1;
    });
  }
  const panCullMs = (performance.now() - tCull0) / 20;

  const mid = Math.floor(n / 2);
  const midId = `r${mid}`;
  const idx = buf.indexById.get(midId)!;
  const hx = buf.positions[idx * 4] + 4;
  const hy = buf.positions[idx * 4 + 1] + 4;

  const tHit0 = performance.now();
  let hitId: string | null = null;
  for (let rep = 0; rep < 50; rep += 1) {
    hitId = hitTestSoaBuffer(buf, hx, hy);
  }
  const hitLinearMs = (performance.now() - tHit0) / 50;
  expect(hitId).toBeTruthy();

  const order = [midId];
  const tOrd0 = performance.now();
  for (let rep = 0; rep < 200; rep += 1) {
    hitTestSoaBufferOrdered(buf, hx, hy, order);
  }
  const hitOrderedMs = (performance.now() - tOrd0) / 200;

  const tSp0 = performance.now();
  const spatial = RcbSpatialIndex.fromRenderBuffer(buf);
  const spatialBuildMs = performance.now() - tSp0;

  let candSum = 0;
  const probes = 40;
  for (let p = 0; p < probes; p += 1) {
    const id = `r${Math.floor((p / probes) * n)}`;
    const i = buf.indexById.get(id)!;
    const x = buf.positions[i * 4] + 2;
    const y = buf.positions[i * 4 + 1] + 2;
    candSum += spatial.search(x - 8, y - 8, x + 24, y + 24).length;
  }
  const spatialHitCandAvg = candSum / probes;

  let bakeEnsureMs: number | null = null;
  let bakeTiles: number | null = null;
  if (shouldUseSoaBake(buf)) {
    const cache = createSoaBakeCache();
    setSharedSoaBakeCache(cache);
    const tw = 2_048;
    const tBake0 = performance.now();
    const bake = ensureSoaBake(buf, null);
    if (bake?.valid) {
      for (const [tx, ty] of [
        [0, 0],
        [1, 0],
        [0, 1],
      ] as const) {
        ensureSoaBakeTile(buf, cache, tx, ty, {
          left: tx * tw,
          top: ty * tw,
          width: tw,
          height: tw,
        });
      }
    }
    bakeEnsureMs = Math.round((performance.now() - tBake0) * 10) / 10;
    bakeTiles = cache.tiles.size;
  }

  return {
    n,
    buildDocMs: Math.round(buildDocMs * 10) / 10,
    syncMs: Math.round(syncMs * 10) / 10,
    panCullMs: Math.round(panCullMs * 100) / 100,
    panCullVisible,
    hitLinearMs: Math.round(hitLinearMs * 1000) / 1000,
    hitOrderedMs: Math.round(hitOrderedMs * 1000) / 1000,
    spatialBuildMs: Math.round(spatialBuildMs * 10) / 10,
    spatialHitCandAvg: Math.round(spatialHitCandAvg * 10) / 10,
    bakeEnsureMs,
    bakeTiles,
    rssMb: rssMb(),
    heapMb: heapMb(),
    bakeRecommended: shouldUseSoaBake(buf),
    bakeThreshold: getSoaBakeCountThreshold(),
  };
}

describe('SoA render tier benches', () => {
  it('2k / 10k / 100k light rects — sync, pan cull, hit, RSS', () => {
    for (const n of [2_000, 10_000, 100_000] as const) {
      RESULTS.push(runTier(n));
    }
    expect(RESULTS).toHaveLength(3);
    expect(RESULTS[0].n).toBe(2_000);
    expect(RESULTS[2].syncMs).toBeLessThan(20_000);
    // Ordered + spatial candidates stay interactive; linear scan grows with N.
    expect(RESULTS[0].hitOrderedMs).toBeLessThan(2);
    expect(RESULTS[1].hitOrderedMs).toBeLessThan(2);

    const outPath = resolve(__dirname, '../../../../../soa-render-tiers.bench.json');
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          note:
            '1M light shapes: use SoA bake tiles + pick (not 1M SVG hosts / editable layers).',
          bakeThresholdDefault: getSoaBakeCountThreshold(),
          tiers: RESULTS,
        },
        null,
        2
      )
    );
  });

  it('documents 1M as bake-path (threshold), not host-per-node', () => {
    const fake = { count: 1_000_000 } as SceneRenderBuffer;
    expect(shouldUseSoaBake(fake)).toBe(true);
    expect(getSoaBakeCountThreshold()).toBeLessThanOrEqual(1_000_000);
  });
});
