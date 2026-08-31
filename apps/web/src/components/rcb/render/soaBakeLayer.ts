/**
 * Tiled OffscreenCanvas bake for large SoA scenes (ADR 0027 Phase 4).
 * Viewport-driven tiles — only tiles intersecting the camera are built/cached
 * so world extent can exceed a single bitmap (million-instance friendly).
 */
import {
  type SceneRenderBuffer,
  SOA_FLAG_CANVAS_IDLE,
  SOA_FLAG_DIRTY,
  SOA_FLAG_VISIBLE,
  SOA_KIND_ELLIPSE,
  SOA_KIND_LINE,
  SOA_KIND_PATH,
  SOA_KIND_RECT,
  paintSoaBufferBasic,
  resolveSoaPaintBox,
} from './sceneRenderBuffer';
import { getNodeTransformPreview } from '@/components/rcb/core/transformPreview';

export const SOA_BAKE_COUNT_THRESHOLD = 8_000;
/** World-space tile edge (scene units). */
export const SOA_BAKE_TILE_WORLD = 2_048;
/** Max pixel edge per tile canvas. */
export const SOA_BAKE_TILE_PX = 2_048;
const MAX_CACHED_TILES = 24;
const POS_STRIDE = 4;

export type SoaWorldBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type SoaBakeTile = {
  key: string;
  canvas: OffscreenCanvas | HTMLCanvasElement;
  bounds: SoaWorldBounds;
  bufferRevision: number;
};

export type SoaBakeLayer = {
  tiles: SoaBakeTile[];
  bounds: SoaWorldBounds;
  bufferRevision: number;
  valid: boolean;
  /** Viewport tile cache (not one full-world bake). */
  tiled: boolean;
};

export type SoaBakeCache = {
  bufferRevision: number;
  tileWorld: number;
  tiles: Map<string, SoaBakeTile>;
  lru: string[];
};

function createBakeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  const width = Math.max(1, Math.min(SOA_BAKE_TILE_PX, Math.ceil(w)));
  const height = Math.max(1, Math.min(SOA_BAKE_TILE_PX, Math.ceil(h)));
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const oc = new OffscreenCanvas(width, height);
      // Some test / older environments expose OffscreenCanvas without a 2d ctx.
      if (oc.getContext('2d')) return oc;
    } catch {
      /* fall through */
    }
  }
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

export function computeSoaIdleBounds(buf: SceneRenderBuffer): SoaWorldBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (let i = 0; i < buf.count; i += 1) {
    const flags = buf.flags[i];
    if (!(flags & SOA_FLAG_VISIBLE) || !(flags & SOA_FLAG_CANVAS_IDLE)) continue;
    const kind = buf.kinds[i];
    if (
      kind !== SOA_KIND_RECT &&
      kind !== SOA_KIND_ELLIPSE &&
      kind !== SOA_KIND_LINE &&
      kind !== SOA_KIND_PATH
    ) {
      continue;
    }
    const o = i * POS_STRIDE;
    const x = buf.positions[o];
    const y = buf.positions[o + 1];
    const w = buf.positions[o + 2];
    const h = buf.positions[o + 3];
    any = true;
    minX = Math.min(minX, x, x + w);
    minY = Math.min(minY, y, y + h);
    maxX = Math.max(maxX, x, x + w);
    maxY = Math.max(maxY, y, y + h);
  }
  if (!any || !Number.isFinite(minX)) return null;
  return {
    left: minX,
    top: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function unionSoaDirtyAabb(buf: SceneRenderBuffer): SoaWorldBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (let i = 0; i < buf.count; i += 1) {
    if (!(buf.flags[i] & SOA_FLAG_DIRTY)) continue;
    // Include promoted (non-idle) slots so their former Canvas pixels get cleared.
    if (!(buf.flags[i] & SOA_FLAG_VISIBLE)) continue;
    const id = buf.ids[i];
    if (id && getNodeTransformPreview(id)?.hidden) continue;
    const { x, y, w, h } = resolveSoaPaintBox(buf, i);
    const angle = id ? Number(getNodeTransformPreview(id)?.angle) || 0 : 0;
    let x0 = x;
    let y0 = y;
    let x1 = x + w;
    let y1 = y + h;
    if (Math.abs(angle) > 0.5) {
      const rad = (Math.abs(angle) * Math.PI) / 180;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const bw = w * cos + h * sin;
      const bh = w * sin + h * cos;
      const cx = x + w / 2;
      const cy = y + h / 2;
      x0 = cx - bw / 2;
      y0 = cy - bh / 2;
      x1 = cx + bw / 2;
      y1 = cy + bh / 2;
    }
    any = true;
    minX = Math.min(minX, x0, x1);
    minY = Math.min(minY, y0, y1);
    maxX = Math.max(maxX, x0, x1);
    maxY = Math.max(maxY, y0, y1);
  }
  if (!any || !Number.isFinite(minX)) return null;
  return {
    left: minX,
    top: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function getSoaBakeCountThreshold(): number {
  try {
    const raw = Number(import.meta.env.VITE_SOA_BAKE_THRESHOLD);
    if (Number.isFinite(raw) && raw >= 100) return Math.floor(raw);
  } catch {
    /* ignore */
  }
  return SOA_BAKE_COUNT_THRESHOLD;
}

export function getSoaBakeTileWorld(): number {
  try {
    const raw = Number(import.meta.env.VITE_SOA_BAKE_TILE);
    if (Number.isFinite(raw) && raw >= 256) return Math.floor(raw);
  } catch {
    /* ignore */
  }
  return SOA_BAKE_TILE_WORLD;
}

export function shouldUseSoaBake(buf: SceneRenderBuffer): boolean {
  return buf.count >= getSoaBakeCountThreshold();
}

function paintIdleInto(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  buf: SceneRenderBuffer,
  bounds: SoaWorldBounds
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const sx = ctx.canvas.width / Math.max(1, bounds.width);
  const sy = ctx.canvas.height / Math.max(1, bounds.height);
  ctx.setTransform(sx, 0, 0, sy, -bounds.left * sx, -bounds.top * sy);
  paintSoaBufferBasic(ctx as CanvasRenderingContext2D, buf, bounds, {
    dirtyOnly: false,
  });
}

export function tileKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

/** List tile indices that overlap a view AABB. */
export function tilesForView(
  view: { left?: number; top?: number; x?: number; y?: number; width: number; height: number },
  tileWorld: number
): Array<{ tx: number; ty: number; bounds: SoaWorldBounds }> {
  const vl = view.left ?? view.x ?? 0;
  const vt = view.top ?? view.y ?? 0;
  const vr = vl + view.width;
  const vb = vt + view.height;
  const tw = Math.max(256, tileWorld);
  const tx0 = Math.floor(vl / tw);
  const ty0 = Math.floor(vt / tw);
  const tx1 = Math.floor((vr - 1e-6) / tw);
  const ty1 = Math.floor((vb - 1e-6) / tw);
  const out: Array<{ tx: number; ty: number; bounds: SoaWorldBounds }> = [];
  for (let ty = ty0; ty <= ty1; ty += 1) {
    for (let tx = tx0; tx <= tx1; tx += 1) {
      out.push({
        tx,
        ty,
        bounds: { left: tx * tw, top: ty * tw, width: tw, height: tw },
      });
    }
  }
  return out;
}

function touchLru(cache: SoaBakeCache, key: string) {
  const i = cache.lru.indexOf(key);
  if (i >= 0) cache.lru.splice(i, 1);
  cache.lru.push(key);
  while (cache.lru.length > MAX_CACHED_TILES) {
    const drop = cache.lru.shift();
    if (drop) cache.tiles.delete(drop);
  }
}

export function createSoaBakeCache(): SoaBakeCache {
  return {
    bufferRevision: -1,
    tileWorld: getSoaBakeTileWorld(),
    tiles: new Map(),
    lru: [],
  };
}

export function ensureSoaBakeTile(
  buf: SceneRenderBuffer,
  cache: SoaBakeCache,
  tx: number,
  ty: number,
  bounds: SoaWorldBounds
): SoaBakeTile | null {
  if (cache.bufferRevision !== buf.revision) {
    cache.tiles.clear();
    cache.lru = [];
    cache.bufferRevision = buf.revision;
    cache.tileWorld = getSoaBakeTileWorld();
  }
  const key = tileKey(tx, ty);
  const hit = cache.tiles.get(key);
  if (hit && hit.bufferRevision === buf.revision) {
    touchLru(cache, key);
    return hit;
  }
  const canvas = createBakeCanvas(SOA_BAKE_TILE_PX, SOA_BAKE_TILE_PX);
  const ctx = canvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) return null;
  paintIdleInto(ctx, buf, bounds);
  const tile: SoaBakeTile = { key, canvas, bounds, bufferRevision: buf.revision };
  cache.tiles.set(key, tile);
  touchLru(cache, key);
  return tile;
}

export function ensureSoaBake(
  buf: SceneRenderBuffer,
  prev: SoaBakeLayer | null
): SoaBakeLayer | null {
  if (!shouldUseSoaBake(buf)) return null;
  const bounds = computeSoaIdleBounds(buf);
  if (!bounds) return null;
  if (prev?.valid && prev.tiled && prev.bufferRevision === buf.revision) {
    return prev;
  }
  return {
    tiles: [],
    bounds,
    bufferRevision: buf.revision,
    valid: true,
    tiled: true,
  };
}

/** Drop tiles overlapping dirty AABB so they rebuild on next blit. */
export function patchSoaBakeDirty(buf: SceneRenderBuffer, bake: SoaBakeLayer): boolean {
  const cache = getSharedSoaBakeCache();
  const dirty = unionSoaDirtyAabb(buf);
  if (!dirty) return true;
  if (!cache || cache.bufferRevision !== buf.revision) {
    bake.valid = false;
    return false;
  }
  invalidateSoaBakeTilesForDirty(buf, cache, dirty);
  bake.bufferRevision = buf.revision;
  bake.valid = true;
  return true;
}

/**
 * Delete bake-cache tiles overlapping `dirty` and clear DIRTY flags.
 * Returns the dropped tile keys (`tx,ty`) for atlas incremental restamp.
 */
export function invalidateSoaBakeTilesForDirty(
  buf: SceneRenderBuffer,
  cache: SoaBakeCache,
  dirty: SoaWorldBounds
): string[] {
  const tw = cache.tileWorld;
  const dropped: string[] = [];
  for (const { tx, ty } of tilesForView(dirty, tw)) {
    const key = tileKey(tx, ty);
    cache.tiles.delete(key);
    const i = cache.lru.indexOf(key);
    if (i >= 0) cache.lru.splice(i, 1);
    dropped.push(key);
  }
  for (let i = 0; i < buf.count; i += 1) {
    if (buf.flags[i] & SOA_FLAG_DIRTY) {
      buf.flags[i] = (buf.flags[i] & ~SOA_FLAG_DIRTY) >>> 0;
    }
  }
  return dropped;
}

export function invalidateSoaBake(bake: SoaBakeLayer | null | undefined) {
  if (bake) bake.valid = false;
  resetSharedSoaBakeCache();
}

function blitOneTile(
  ctx: CanvasRenderingContext2D,
  tile: SoaBakeTile,
  view: { left?: number; top?: number; x?: number; y?: number; width: number; height: number }
) {
  const { bounds, canvas } = tile;
  const vl = view.left ?? view.x ?? 0;
  const vt = view.top ?? view.y ?? 0;
  const vr = vl + view.width;
  const vb = vt + view.height;
  const bl = bounds.left;
  const bt = bounds.top;
  const br = bl + bounds.width;
  const bb = bt + bounds.height;
  if (br < vl || bb < vt || bl > vr || bt > vb) return;
  const scaleX = canvas.width / Math.max(1, bounds.width);
  const scaleY = canvas.height / Math.max(1, bounds.height);
  const srcX = Math.max(0, (vl - bl) * scaleX);
  const srcY = Math.max(0, (vt - bt) * scaleY);
  const srcR = Math.min(canvas.width, (vr - bl) * scaleX);
  const srcB = Math.min(canvas.height, (vb - bt) * scaleY);
  const srcW = Math.max(1, srcR - srcX);
  const srcH = Math.max(1, srcB - srcY);
  const dstX = Math.max(vl, bl);
  const dstY = Math.max(vt, bt);
  const dstW = Math.min(vr, br) - dstX;
  const dstH = Math.min(vb, bb) - dstY;
  if (dstW <= 0 || dstH <= 0) return;
  ctx.drawImage(
    canvas as CanvasImageSource,
    srcX,
    srcY,
    srcW,
    srcH,
    dstX,
    dstY,
    dstW,
    dstH
  );
}

/** Ensure + blit all tiles covering the viewport. */
export function blitSoaBakeForView(
  ctx: CanvasRenderingContext2D,
  buf: SceneRenderBuffer,
  bake: SoaBakeLayer,
  view: { left?: number; top?: number; x?: number; y?: number; width: number; height: number }
) {
  const cache = getSharedSoaBakeCache() ?? createSoaBakeCache();
  setSharedSoaBakeCache(cache);
  const tw = cache.tileWorld;
  for (const { tx, ty, bounds } of tilesForView(view, tw)) {
    const tile = ensureSoaBakeTile(buf, cache, tx, ty, bounds);
    if (tile) blitOneTile(ctx, tile, view);
  }
  bake.bufferRevision = buf.revision;
  bake.valid = true;
}

export function blitSoaBake(
  ctx: CanvasRenderingContext2D,
  bake: SoaBakeLayer,
  view: { left?: number; top?: number; x?: number; y?: number; width: number; height: number }
) {
  if (bake.tiles.length === 1) {
    blitOneTile(ctx, bake.tiles[0], view);
  }
}

let sharedBake: SoaBakeLayer | null = null;
let sharedCache: SoaBakeCache | null = null;

export function getSharedSoaBake(): SoaBakeLayer | null {
  return sharedBake;
}

export function setSharedSoaBake(bake: SoaBakeLayer | null) {
  sharedBake = bake;
}

export function resetSharedSoaBake() {
  sharedBake = null;
  resetSharedSoaBakeCache();
}

export function getSharedSoaBakeCache(): SoaBakeCache | null {
  return sharedCache;
}

export function setSharedSoaBakeCache(cache: SoaBakeCache | null) {
  sharedCache = cache;
}

export function resetSharedSoaBakeCache() {
  sharedCache = null;
}
