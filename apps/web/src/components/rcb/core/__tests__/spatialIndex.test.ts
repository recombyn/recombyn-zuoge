import { describe, expect, it, afterEach } from 'vitest';
import {
  RcbSpatialIndex,
  SceneSpatialRuntime,
  boxesIntersect,
  buildIdRankMap,
  getSharedSceneSpatialRuntime,
  setSharedSceneSpatialRuntime,
  sortIdsByRank,
} from '../spatialIndex';

describe('RcbSpatialIndex', () => {
  it('finds items by point and rect', () => {
    const idx = new RcbSpatialIndex(100);
    idx.upsert({ id: 'a', minX: 0, minY: 0, maxX: 50, maxY: 50 });
    idx.upsert({ id: 'b', minX: 200, minY: 200, maxX: 250, maxY: 250 });
    expect(idx.searchPoint(25, 25).map((x) => x.id)).toEqual(['a']);
    expect(idx.searchPoint(210, 210).map((x) => x.id)).toEqual(['b']);
    expect(idx.search(0, 0, 300, 300).map((x) => x.id).sort()).toEqual(['a', 'b']);
    expect(idx.search(180, 180, 190, 190)).toEqual([]);
  });

  it('upsert replaces bounds', () => {
    const idx = new RcbSpatialIndex(100);
    idx.upsert({ id: 'a', minX: 0, minY: 0, maxX: 10, maxY: 10 });
    idx.upsert({ id: 'a', minX: 500, minY: 500, maxX: 510, maxY: 510 });
    expect(idx.searchPoint(5, 5)).toEqual([]);
    expect(idx.searchPoint(505, 505).map((x) => x.id)).toEqual(['a']);
    expect(idx.size).toBe(1);
  });

  it('has / ids track membership', () => {
    const idx = new RcbSpatialIndex(100);
    idx.upsert({ id: 'a', minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(idx.has('a')).toBe(true);
    expect(idx.has('b')).toBe(false);
    expect([...idx.ids()]).toEqual(['a']);
    idx.remove('a');
    expect(idx.has('a')).toBe(false);
    expect(idx.size).toBe(0);
  });

  it('boxesIntersect', () => {
    expect(
      boxesIntersect(
        { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        { minX: 5, minY: 5, maxX: 15, maxY: 15 }
      )
    ).toBe(true);
    expect(
      boxesIntersect(
        { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        { minX: 11, minY: 0, maxX: 20, maxY: 10 }
      )
    ).toBe(false);
  });
});

describe('sortIdsByRank', () => {
  it('orders candidates without scanning the full list', () => {
    const rank = buildIdRankMap(['a', 'b', 'c', 'd', 'e']);
    expect(sortIdsByRank(['e', 'a', 'c'], rank, { ascending: true })).toEqual([
      'a',
      'c',
      'e',
    ]);
    expect(sortIdsByRank(['e', 'a', 'c'], rank, { ascending: false })).toEqual([
      'e',
      'c',
      'a',
    ]);
  });
});

describe('SceneSpatialRuntime', () => {
  function makeDoc(ids: string[]) {
    const delta: Record<string, any> = {
      ROOT: { children: ids },
    };
    ids.forEach((id, i) => {
      delta[id] = {
        id,
        x: i * 100,
        y: 0,
        width: 40,
        height: 40,
        attrs: {},
      };
    });
    return { deltaSetLike: delta };
  }

  it('syncs membership without full rebuild on patch-only', () => {
    const runtime = new SceneSpatialRuntime(100);
    const children = ['a', 'b', 'c'];
    const doc = makeDoc(children);
    runtime.sync({ document: doc, childrenIds: children, reloadToken: 1 });
    expect(runtime.size).toBe(3);

    // Same children identity + geometry patch on b
    doc.deltaSetLike.b.x = 500;
    runtime.sync({
      document: doc,
      childrenIds: children,
      reloadToken: 1,
      patchedNodeIds: ['b'],
    });
    expect(runtime.size).toBe(3);
    expect(runtime.index.searchPoint(520, 20).map((h) => h.id)).toEqual(['b']);
    expect(runtime.index.searchPoint(100, 20)).toEqual([]);
  });

  it('hitCandidateIds uses spatial only on large scenes', () => {
    const runtime = new SceneSpatialRuntime(100);
    const children = Array.from({ length: 60 }, (_, i) => `n${i}`);
    const doc = makeDoc(children);
    runtime.sync({ document: doc, childrenIds: children, reloadToken: 1 });
    const order = runtime.hitCandidateIds({
      x: 50_000,
      y: 50_000,
      pad: 1,
    });
    expect(order).toEqual([]);
  });

  it('patchNodes updates AABB without full rebuild', () => {
    const runtime = new SceneSpatialRuntime(100);
    const children = ['a', 'b'];
    const doc = makeDoc(children);
    runtime.sync({ document: doc, childrenIds: children, reloadToken: 1 });
    doc.deltaSetLike.b.x = 900;
    runtime.patchNodes(doc, ['b']);
    expect(runtime.index.searchPoint(920, 20).map((h) => h.id)).toEqual(['b']);
  });
});

describe('shared SceneSpatialRuntime', () => {
  afterEach(() => {
    setSharedSceneSpatialRuntime(null);
  });

  it('publishes and clears the product runtime for stage underlay consumers', () => {
    const runtime = new SceneSpatialRuntime(256);
    expect(getSharedSceneSpatialRuntime()).toBeNull();
    setSharedSceneSpatialRuntime(runtime);
    expect(getSharedSceneSpatialRuntime()).toBe(runtime);
    setSharedSceneSpatialRuntime(null);
    expect(getSharedSceneSpatialRuntime()).toBeNull();
  });
});
