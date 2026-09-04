import { describe, expect, it } from 'vitest';
import {
  createSoaWebglAtlas,
  stampSoaPathToAtlas,
  stampSoaRoundedRectToAtlas,
  stampImageToAtlas,
  evictSoaAtlasOldest,
  releaseSoaAtlasRegion,
  releaseSoaAtlasPrefix,
  pruneSoaAtlasForBuffer,
  atlasRegionToUv,
  SOA_ATLAS_CELL,
  SOA_ATLAS_INNER,
  SOA_ATLAS_SEG_THRESHOLD,
  idleMediaNeedsSharpHost,
  idleMediaScreenEdgePx,
} from '../webglInstanceAtlas';
import {
  createSceneRenderBuffer,
  SOA_KIND_PATH,
  SOA_KIND_RECT,
} from '../sceneRenderBuffer';

describe('webglInstanceAtlas', () => {
  it('idleMediaNeedsSharpHost when screen edge exceeds atlas inner cell', () => {
    expect(SOA_ATLAS_INNER).toBe(SOA_ATLAS_CELL - 4);
    expect(idleMediaScreenEdgePx(80, 60, 1, 1)).toBe(80);
    expect(idleMediaNeedsSharpHost({ key: 'image', width: 80, height: 60 }, 1, 1)).toBe(false);
    expect(idleMediaNeedsSharpHost({ key: 'image', width: 400, height: 300 }, 1, 1)).toBe(true);
    expect(idleMediaNeedsSharpHost({ key: 'image', width: 80, height: 60 }, 4, 1)).toBe(true);
    expect(idleMediaNeedsSharpHost({ key: 'video', width: 400, height: 300 }, 1, 1)).toBe(true);
    expect(idleMediaNeedsSharpHost({ key: 'shape', width: 400, height: 300 }, 1, 1)).toBe(false);
  });
  it('shelf-packs stamped polylines and returns UVs', () => {
    const atlas = createSoaWebglAtlas(512, 128);
    if (!atlas) return;
    const xy = new Float32Array([0, 0, 10, 0, 20, 5, 30, 0, 40, 8, 50, 0]);
    const region = stampSoaPathToAtlas(atlas, 'p1', xy, 0, 6, '#112233', false, 2);
    expect(region).not.toBeNull();
    expect(region!.w).toBeGreaterThan(0);
    const uv = atlasRegionToUv(atlas, region!);
    expect(uv.u0).toBeGreaterThanOrEqual(0);
    expect(uv.u1).toBeGreaterThan(uv.u0);
    expect(uv.v1).toBeGreaterThan(uv.v0);

    const again = stampSoaPathToAtlas(atlas, 'p1', xy, 0, 6, '#112233', false, 2);
    expect(again).toBe(region);
    expect(SOA_ATLAS_SEG_THRESHOLD).toBeGreaterThan(0);
  });

  it('LRU-evicts oldest cell when atlas is full', () => {
    // 2x2 cells
    const atlas = createSoaWebglAtlas(SOA_ATLAS_CELL * 2, SOA_ATLAS_CELL);
    if (!atlas) return;
    const mk = (key: string, x: number) => {
      const xy = new Float32Array([x, 0, x + 10, 0, x + 20, 5]);
      return stampSoaPathToAtlas(atlas!, key, xy, 0, 3, '#000', false, 2);
    };
    expect(mk('a', 0)).not.toBeNull();
    expect(mk('b', 20)).not.toBeNull();
    expect(mk('c', 40)).not.toBeNull();
    expect(mk('d', 60)).not.toBeNull();
    expect(atlas.regions.size).toBe(4);
    // Touch a so it is newest; b should be oldest among remaining after one more insert
    stampSoaPathToAtlas(atlas, 'a', new Float32Array([0, 0, 1, 0]), 0, 2, '#000', false, 2);
    expect(mk('e', 80)).not.toBeNull();
    expect(atlas.regions.has('e')).toBe(true);
    // One of the untouched early keys should have been evicted
    expect(atlas.regions.size).toBe(4);
    expect(atlas.regions.has('b') || atlas.regions.has('c') || atlas.regions.has('d')).toBe(true);
    expect(evictSoaAtlasOldest(atlas)).toBe(true);
  });

  it('stamps rounded rects into atlas cells', () => {
    const atlas = createSoaWebglAtlas(512, 128);
    if (!atlas) return;
    const region = stampSoaRoundedRectToAtlas(
      atlas,
      'round:a',
      { left: 10, top: 20, width: 80, height: 40 },
      '#ffffff',
      { tl: 12, tr: 12, br: 12, bl: 12 }
    );
    expect(region).not.toBeNull();
    expect(region!.world.width).toBe(80);
    expect(atlas.stats.misses).toBe(1);
    const hit = stampSoaRoundedRectToAtlas(
      atlas,
      'round:a',
      { left: 10, top: 20, width: 80, height: 40 },
      '#ffffff',
      { tl: 12, tr: 12, br: 12, bl: 12 }
    );
    expect(hit).toBe(region);
    expect(atlas.stats.hits).toBe(1);
  });

  it('stamps an image/bake tile into a cell', () => {
    const atlas = createSoaWebglAtlas(512, 128);
    if (!atlas) return;
    const src = document.createElement('canvas');
    src.width = 32;
    src.height = 32;
    const sctx = src.getContext('2d');
    if (!sctx) return;
    sctx.fillStyle = '#f00';
    sctx.fillRect(0, 0, 32, 32);
    const region = stampImageToAtlas(atlas, 'bake:0,0', src, {
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });
    expect(region).not.toBeNull();
    expect(region!.world.width).toBe(100);
    expect(atlas.stats.misses).toBe(1);

    // Hit
    stampImageToAtlas(atlas, 'bake:0,0', src, {
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });
    expect(atlas.stats.hits).toBe(1);

    // Force restamp keeps same cell
    sctx.fillStyle = '#0f0';
    sctx.fillRect(0, 0, 32, 32);
    const again = stampImageToAtlas(
      atlas,
      'bake:0,0',
      src,
      { left: 0, top: 0, width: 100, height: 100 },
      { force: true }
    );
    expect(again?.cell).toBe(region!.cell);
    expect(atlas.stats.restamps).toBe(1);
  });

  it('releaseSoaAtlasRegion frees a cell for reuse', () => {
    const atlas = createSoaWebglAtlas(SOA_ATLAS_CELL * 2, SOA_ATLAS_CELL);
    if (!atlas) return;
    const xy = new Float32Array([0, 0, 10, 0, 20, 0]);
    stampSoaPathToAtlas(atlas, 'path:a', xy, 0, 3, '#000', false, 2);
    expect(releaseSoaAtlasRegion(atlas, 'path:a')).toBe(true);
    expect(atlas.regions.has('path:a')).toBe(false);
    expect(atlas.stats.releases).toBe(1);
    expect(releaseSoaAtlasPrefix(atlas, 'path:')).toBe(0);
  });

  it('pruneSoaAtlasForBuffer drops orphan path/round keys', () => {
    const atlas = createSoaWebglAtlas(SOA_ATLAS_CELL * 2, SOA_ATLAS_CELL);
    if (!atlas) return;
    const xy = new Float32Array([0, 0, 10, 0, 20, 0]);
    stampSoaPathToAtlas(atlas, 'path:keep', xy, 0, 3, '#000', false, 2);
    stampSoaPathToAtlas(atlas, 'path:gone', xy, 0, 3, '#000', false, 2);
    stampSoaRoundedRectToAtlas(
      atlas,
      'round:keep',
      { left: 0, top: 0, width: 20, height: 10 },
      '#fff',
      { tl: 4, tr: 4, br: 4, bl: 4 }
    );
    stampImageToAtlas(
      atlas,
      'bake:0,0',
      (() => {
        const c = document.createElement('canvas');
        c.width = 8;
        c.height = 8;
        return c;
      })(),
      { left: 0, top: 0, width: 8, height: 8 }
    );
    const buf = createSceneRenderBuffer(4);
    buf.count = 2;
    buf.ids[0] = 'keep';
    buf.kinds[0] = SOA_KIND_PATH;
    buf.ids[1] = 'keep';
    buf.kinds[1] = SOA_KIND_RECT;
    expect(pruneSoaAtlasForBuffer(atlas, buf)).toBe(1);
    expect(atlas.regions.has('path:keep')).toBe(true);
    expect(atlas.regions.has('path:gone')).toBe(false);
    expect(atlas.regions.has('round:keep')).toBe(true);
    expect(atlas.regions.has('bake:0,0')).toBe(true);
  });

  it('force restamps dirty path cell in place', () => {
    const atlas = createSoaWebglAtlas(512, 128);
    if (!atlas) return;
    const xy = new Float32Array([0, 0, 10, 0, 20, 5]);
    const a = stampSoaPathToAtlas(atlas, 'path:p', xy, 0, 3, '#000', false, 2);
    const b = stampSoaPathToAtlas(atlas, 'path:p', xy, 0, 3, '#f00', false, 4, {
      force: true,
    });
    expect(a).not.toBeNull();
    expect(b?.cell).toBe(a!.cell);
    expect(atlas.stats.restamps).toBe(1);
  });
});
