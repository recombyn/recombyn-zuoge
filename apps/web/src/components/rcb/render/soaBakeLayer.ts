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
import type { SceneDocument } from '@/components/rcb/sceneNode';

/** Document for plate clip while baking tiles (set by the stage renderer). */
let bakeClipDocument: SceneDocument | null = null;

export function setSoaBakeClipDocument(doc: SceneDocument | null | undefined) {
  bakeClipDocument = doc ?? null;
}

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
  /** Element id → bake tile keys covering its AABB. */
  elementToTiles: Map<string, Set<string>>;
  /** Tile key → element ids stamped into that tile. */
  tileToElements: Map<string, Set<string>>;
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

function unionRotatedPaintBox(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  x: number,
  y: number,
  w: number,
  h: number,
  angleDeg: number
): { minX: number; minY: number; maxX: number; maxY: number } {
  let x0 = x;
  let y0 = y;
  let x1 = x + w;
  let y1 = y + h;
  if (Math.abs(angleDeg) > 0.5) {
    const rad = (Math.abs(angleDeg) * Math.PI) / 180;
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
  return {
    minX: Math.min(minX, x0, x1),
    minY: Math.min(minY, y0, y1),
    maxX: Math.max(maxX, x0, x1),
    maxY: Math.max(maxY, y0, y1),
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
    const live = resolveSoaPaintBox(buf, i);
    const angle = id ? Number(getNodeTransformPreview(id)?.angle) || 0 : 0;
    const o = i * POS_STRIDE;
    const baseX = buf.positions[o];
    const baseY = buf.positions[o + 1];
    const baseW = buf.positions[o + 2];
    const baseH = buf.positions[o + 3];
    const unioned = unionRotatedPaintBox(
      minX,
      minY,
      maxX,
      maxY,
      live.x,
      live.y,
      live.w,
      live.h,
      angle
    );
    minX = unioned.minX;
    minY = unioned.minY;
    maxX = unioned.maxX;
    maxY = unioned.maxY;
    if (
      Math.abs(live.dx) > 1e-3 ||
      Math.abs(live.dy) > 1e-3 ||
      Math.abs(live.w - baseW) > 1e-3 ||
      Math.abs(live.h - baseH) > 1e-3
    ) {
      const trail = unionRotatedPaintBox(minX, minY, maxX, maxY, baseX, baseY, baseW, baseH, angle);
      minX = trail.minX;
      minY = trail.minY;
      maxX = trail.maxX;
      maxY = trail.maxY;
    }
    any = true;
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
    document: bakeClipDocument,
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
    if (!drop) continue;
    cache.tiles.delete(drop);
    unbindTileKey(cache, drop);
  }
}

function linkElementToTile(cache: SoaBakeCache, elementId: string, key: string): void {
  let et = cache.elementToTiles.get(elementId);
  if (!et) {
    et = new Set();
    cache.elementToTiles.set(elementId, et);
  }
  et.add(key);
  let te = cache.tileToElements.get(key);
  if (!te) {
    te = new Set();
    cache.tileToElements.set(key, te);
  }
  te.add(elementId);
}

/** Drop reverse maps for one tile key (tile bitmap already removed). */
function unbindTileKey(cache: SoaBakeCache, key: string): void {
  const els = cache.tileToElements.get(key);
  if (!els) {
    cache.tileToElements.delete(key);
    return;
  }
  for (const id of els) {
    const tiles = cache.elementToTiles.get(id);
    if (!tiles) continue;
    tiles.delete(key);
    if (!tiles.size) cache.elementToTiles.delete(id);
  }
  cache.tileToElements.delete(key);
}

/** Delete one tile bitmap + LRU + reverse maps. */
function dropBakeTile(cache: SoaBakeCache, key: string): void {
  cache.tiles.delete(key);
  const li = cache.lru.indexOf(key);
  if (li >= 0) cache.lru.splice(li, 1);
  unbindTileKey(cache, key);
}

/** Clear element↔tile bindings for one element (keeps tile bitmaps). */
export function unbindSoaBakeElement(cache: SoaBakeCache, elementId: string): void {
  const tiles = cache.elementToTiles.get(elementId);
  if (!tiles) return;
  for (const key of tiles) {
    const els = cache.tileToElements.get(key);
    if (!els) continue;
    els.delete(elementId);
    if (!els.size) cache.tileToElements.delete(key);
  }
  cache.elementToTiles.delete(elementId);
}

/**
 * Bind an element's world AABB to the tiles it covers.
 * Replaces any previous binding for that id.
 */
export function bindSoaBakeElementTiles(
  cache: SoaBakeCache,
  elementId: string,
  box: { minX: number; minY: number; maxX: number; maxY: number }
): string[] {
  unbindSoaBakeElement(cache, elementId);
  const keys: string[] = [];
  const view = {
    left: box.minX,
    top: box.minY,
    width: Math.max(1e-3, box.maxX - box.minX),
    height: Math.max(1e-3, box.maxY - box.minY),
  };
  for (const { tx, ty } of tilesForView(view, cache.tileWorld)) {
    const key = tileKey(tx, ty);
    keys.push(key);
    linkElementToTile(cache, elementId, key);
  }
  return keys;
}

function slotIntersectsBounds(
  x: number,
  y: number,
  w: number,
  h: number,
  bounds: SoaWorldBounds
): boolean {
  const minX = Math.min(x, x + w);
  const minY = Math.min(y, y + h);
  const maxX = Math.max(x, x + w);
  const maxY = Math.max(y, y + h);
  const br = bounds.left + bounds.width;
  const bb = bounds.top + bounds.height;
  return !(maxX < bounds.left || maxY < bounds.top || minX > br || minY > bb);
}

/** Register all visible idle SoA slots against the tiles covering a painted tile AABB. */
function bindElementsForTileBounds(
  buf: SceneRenderBuffer,
  cache: SoaBakeCache,
  tileK: string,
  bounds: SoaWorldBounds
): void {
  for (let i = 0; i < buf.count; i += 1) {
    const flags = buf.flags[i];
    if (!(flags & SOA_FLAG_VISIBLE) || !(flags & SOA_FLAG_CANVAS_IDLE)) continue;
    const id = buf.ids[i];
    if (!id) continue;
    const o = i * POS_STRIDE;
    if (
      !slotIntersectsBounds(
        buf.positions[o],
        buf.positions[o + 1],
        buf.positions[o + 2],
        buf.positions[o + 3],
        bounds
      )
    ) {
      continue;
    }
    linkElementToTile(cache, id, tileK);
  }
}

/**
 * Invalidate bake tiles for known element ids via the reverse map (no AABB re-intersect).
 * Falls back to empty when ids have no binding yet.
 */
export function invalidateSoaBakeTilesForElements(
  cache: SoaBakeCache,
  elementIds: readonly string[]
): string[] {
  const dropped = new Set<string>();
  for (const raw of elementIds) {
    const id = String(raw || '');
    if (!id) continue;
    const keys = cache.elementToTiles.get(id);
    if (!keys) continue;
    for (const key of [...keys]) {
      if (dropped.has(key)) continue;
      dropped.add(key);
      dropBakeTile(cache, key);
    }
  }
  return [...dropped];
}

export function createSoaBakeCache(): SoaBakeCache {
  return {
    bufferRevision: -1,
    tileWorld: getSoaBakeTileWorld(),
    tiles: new Map(),
    lru: [],
    elementToTiles: new Map(),
    tileToElements: new Map(),
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
    cache.elementToTiles.clear();
    cache.tileToElements.clear();
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
  bindElementsForTileBounds(buf, cache, key, bounds);
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
 * Delete bake-cache tiles for dirty slots.
 * Uses element↔tile map when present, always unions dirty-AABB tiles so moves
 * still clear the destination footprint.
 */
export function invalidateSoaBakeTilesForDirty(
  buf: SceneRenderBuffer,
  cache: SoaBakeCache,
  dirty: SoaWorldBounds
): string[] {
  const dirtyIds: string[] = [];
  for (let i = 0; i < buf.count; i += 1) {
    if (!(buf.flags[i] & SOA_FLAG_DIRTY)) continue;
    const id = buf.ids[i];
    if (id) dirtyIds.push(id);
  }
  const dropped = new Set<string>();
  if (dirtyIds.length && cache.elementToTiles.size > 0) {
    for (const key of invalidateSoaBakeTilesForElements(cache, dirtyIds)) {
      dropped.add(key);
    }
  }
  const tw = cache.tileWorld;
  for (const { tx, ty } of tilesForView(dirty, tw)) {
    const key = tileKey(tx, ty);
    if (dropped.has(key)) continue;
    dropBakeTile(cache, key);
    dropped.add(key);
  }
  for (let i = 0; i < buf.count; i += 1) {
    if (buf.flags[i] & SOA_FLAG_DIRTY) {
      buf.flags[i] = (buf.flags[i] & ~SOA_FLAG_DIRTY) >>> 0;
    }
  }
  return [...dropped];
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
