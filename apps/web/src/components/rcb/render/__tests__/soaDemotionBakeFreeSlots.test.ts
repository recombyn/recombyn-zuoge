import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRenderDemotionScheduler } from '../renderDemotionScheduler';
import {
  bulkRemoveSoaByIds,
  compactSoaFreeSlots,
  createSceneRenderBuffer,
  SOA_FLAG_FREE,
  upsertSoaGeom,
} from '../sceneRenderBuffer';
import {
  bindSoaBakeElementTiles,
  createSoaBakeCache,
  invalidateSoaBakeTilesForElements,
  tileKey,
  unbindSoaBakeElement,
} from '../soaBakeLayer';

describe('allocateSoaSlot + freeSlots', () => {
  it('reuses tombstone slots after compact path via bulkRemove', () => {
    const buf = createSceneRenderBuffer();
    for (let i = 0; i < 12; i += 1) {
      upsertSoaGeom(buf, `n${i}`, { x: i * 10, y: 0, w: 8, h: 8 });
    }
    expect(buf.count).toBe(12);
    expect(bulkRemoveSoaByIds(buf, ['n1', 'n3', 'n5', 'n7', 'n9', 'n11', 'n0', 'n2'])).toBe(8);
    expect(buf.freeSlots.length).toBe(0);
    expect(buf.count).toBe(4);
    expect(buf.indexById.has('n4')).toBe(true);
    expect(buf.indexById.has('n1')).toBe(false);

    upsertSoaGeom(buf, 'fresh', { x: 1, y: 1, w: 2, h: 2 });
    expect(buf.count).toBe(5);
    expect(buf.indexById.get('fresh')).toBe(4);
  });

  it('tombestone + compactSoaFreeSlots packs densely', () => {
    const buf = createSceneRenderBuffer();
    upsertSoaGeom(buf, 'a', { x: 0, y: 0, w: 1, h: 1 });
    upsertSoaGeom(buf, 'b', { x: 10, y: 0, w: 1, h: 1 });
    upsertSoaGeom(buf, 'c', { x: 20, y: 0, w: 1, h: 1 });
    // Manual tombstone path: free middle via freeSlots list
    const mid = buf.indexById.get('b')!;
    buf.indexById.delete('b');
    buf.quadtree.remove('b');
    buf.ids[mid] = undefined as unknown as string;
    buf.flags[mid] = SOA_FLAG_FREE;
    buf.freeSlots.push(mid);
    expect(compactSoaFreeSlots(buf)).toBe(1);
    expect(buf.count).toBe(2);
    expect(buf.freeSlots.length).toBe(0);
    expect([...buf.indexById.keys()].sort()).toEqual(['a', 'c']);
  });
});

describe('createRenderDemotionScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('promotes adds immediately; demotes ink on CANDIDATE; releases host after delay', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const promoted: string[][] = [];
    const demoted: string[][] = [];
    const after: string[][] = [];
    const sched = createRenderDemotionScheduler({
      demoteDelayMs: 300,
      sink: {
        promote: (ids) => promoted.push([...ids]),
        demote: (ids) => demoted.push([...ids]),
        afterFlips: (ids) => after.push([...ids]),
      },
    });
    sched.setForceHosts(['a', 'b']);
    expect(promoted).toEqual([['a', 'b']]);
    expect(sched.getHint('a')).toBe('ACTIVE_SVG');
    expect(sched.heldHostIds().has('a')).toBe(true);

    sched.setForceHosts(['a']);
    expect(sched.pendingDemoteIds()).toEqual(['b']);
    expect(sched.getHint('b')).toBe('CANDIDATE');
    expect(sched.heldHostIds().has('b')).toBe(true);
    // Ink demote runs immediately; host stay held until quiet wake.
    expect(demoted).toEqual([['b']]);

    vi.advanceTimersByTime(300);
    expect(demoted).toEqual([['b']]);
    expect(sched.getHint('b')).toBe('DEPLOYED_SOA');
    expect(sched.heldHostIds().has('b')).toBe(false);

    vi.runOnlyPendingTimers();
    sched.dispose();
  });

  it('noteElementActive bumps quiet lastActive without re-demoting ink', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const demoted: string[] = [];
    const sched = createRenderDemotionScheduler({
      demoteDelayMs: 300,
      sink: {
        promote: () => undefined,
        demote: (ids) => demoted.push(...ids),
      },
    });
    sched.setForceHosts(['x']);
    sched.setForceHosts([]);
    expect(sched.pendingDemoteIds()).toEqual(['x']);
    expect(sched.getHint('x')).toBe('CANDIDATE');
    expect(demoted).toEqual(['x']);
    vi.advanceTimersByTime(200);
    sched.noteElementActive('x');
    expect(sched.pendingDemoteIds()).toEqual(['x']);
    expect(sched.getHint('x')).toBe('CANDIDATE');
    // Pulse only extends quiet window — ink demote stays once.
    expect(demoted).toEqual(['x']);
    vi.advanceTimersByTime(200);
    expect(sched.getHint('x')).toBe('CANDIDATE');
    expect(sched.heldHostIds().has('x')).toBe(true);
    vi.advanceTimersByTime(100);
    expect(sched.getHint('x')).toBe('DEPLOYED_SOA');
    expect(sched.heldHostIds().has('x')).toBe(false);
    sched.dispose();
  });

  it('uses a single wake for many candidates (not per-id timers)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const sched = createRenderDemotionScheduler({
      demoteDelayMs: 300,
      sink: {
        promote: () => undefined,
        demote: () => undefined,
      },
    });
    const ids = Array.from({ length: 40 }, (_, i) => `n${i}`);
    sched.setForceHosts(ids);
    sched.setForceHosts([]);
    expect(sched.pendingDemoteIds()).toHaveLength(40);
    vi.advanceTimersByTime(300);
    expect(sched.pendingDemoteIds()).toHaveLength(0);
    for (const id of ids) expect(sched.getHint(id)).toBe('DEPLOYED_SOA');
    sched.dispose();
  });

  it('promoteNow / demoteNow batch without delay', () => {
    const promoted: string[] = [];
    const demoted: string[] = [];
    const sched = createRenderDemotionScheduler({
      demoteDelayMs: 9999,
      sink: {
        promote: (ids) => promoted.push(...ids),
        demote: (ids) => demoted.push(...ids),
      },
    });
    sched.promoteNow(['p1', 'p2']);
    sched.demoteNow(['d1']);
    expect(promoted).toEqual(['p1', 'p2']);
    expect(demoted).toEqual(['d1']);
    sched.dispose();
  });
});

describe('soa bake element↔tile map', () => {
  it('bind / invalidate by element skips unrelated tiles', () => {
    const cache = createSoaBakeCache();
    cache.tileWorld = 100;
    // Fake cached tiles
    cache.tiles.set(tileKey(0, 0), {
      key: tileKey(0, 0),
      canvas: document.createElement('canvas'),
      bounds: { left: 0, top: 0, width: 100, height: 100 },
      bufferRevision: 1,
    });
    cache.tiles.set(tileKey(5, 5), {
      key: tileKey(5, 5),
      canvas: document.createElement('canvas'),
      bounds: { left: 500, top: 500, width: 100, height: 100 },
      bufferRevision: 1,
    });
    cache.lru.push(tileKey(0, 0), tileKey(5, 5));

    bindSoaBakeElementTiles(cache, 'shape', {
      minX: 10,
      minY: 10,
      maxX: 40,
      maxY: 40,
    });
    expect(cache.elementToTiles.get('shape')?.has(tileKey(0, 0))).toBe(true);
    expect(cache.tileToElements.get(tileKey(0, 0))?.has('shape')).toBe(true);

    const dropped = invalidateSoaBakeTilesForElements(cache, ['shape']);
    expect(dropped).toEqual([tileKey(0, 0)]);
    expect(cache.tiles.has(tileKey(0, 0))).toBe(false);
    expect(cache.tiles.has(tileKey(5, 5))).toBe(true);

    unbindSoaBakeElement(cache, 'missing');
  });
});
