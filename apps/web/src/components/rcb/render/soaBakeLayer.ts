/**
 * Tiled OffscreenCanvas bake for large SoA scenes (ADR 0027 Phase 4).
 * Viewport-driven tiles — only tiles intersecting the camera are built/cached
 * so world extent can exceed a single bitmap (million-instance friendly).
 */
import {
  type SceneRenderBuffer,
  SOA_FLAG_BASIC_GEOM,
  SOA_FLAG_CANVAS_IDLE,
  SOA_FLAG_DIRTY,
  SOA_FLAG_FREE,
  SOA_FLAG_VISIBLE,
  SOA_KIND_ELLIPSE,
  SOA_KIND_LINE,
  SOA_KIND_PATH,
  SOA_KIND_RECT,
  paintSoaBufferBasic,
  resolveSoaPaintBox,
} from './sceneRenderBuffer';
import { getNodeTransformPreview, hasNodeTransformPreviews } from '@/components/rcb/core/transformPreview';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import { nodeOwnerFrameId } from '@/components/rcb/frames/frameNodeBinding';

/** Document for plate clip while baking tiles (set by the stage renderer). */
let bakeClipDocument: SceneDocument | null = null;

type PendingBakeJob = {
  key: string;
  bounds: { left: number; top: number; width: number; height: number };
  revision: number;
};

let bakeReadyListeners: Set<() => void> | null = null;
const bakeInflight = new Set<string>();
const bakeQueue: PendingBakeJob[] = [];
let bakeJobSeq = 1;
let bakeWorker: Worker | null = null;
let bakeWorkerSyncedRevision = -1;
let bakeWorkerFailed = false;
let pumpBuf: SceneRenderBuffer | null = null;

function getBakeReadyListeners(): Set<() => void> {
  if (!bakeReadyListeners) bakeReadyListeners = new Set();
  return bakeReadyListeners;
}

export function setSoaBakeClipDocument(doc: SceneDocument | null | undefined) {
  bakeClipDocument = doc ?? null;
}

/** World bake tiles skip plate-bound ink (ArtboardLayer owns those slots). */
function isBakeFrameBoundSlot(buf: SceneRenderBuffer, i: number): boolean {
  if (!bakeClipDocument) return false;
  const id = buf.ids[i];
  if (!id) return false;
  return Boolean(nodeOwnerFrameId(bakeClipDocument.deltaSetLike?.[id]));
}

/** Engage when canvas-idle SoA density is near a full viewport (~800+). */
export const SOA_BAKE_COUNT_THRESHOLD = 800;
/** World-space tile edge (scene units). */
export const SOA_BAKE_TILE_WORLD = 2_048;
/** Max pixel edge per tile canvas. */
export const SOA_BAKE_TILE_PX = 2_048;
/** New tiles built per paint in Vitest sync budget (browser uses Worker only). */
export const SOA_BAKE_NEW_TILES_PER_FRAME = 2;
/** Max Worker bake jobs in flight. */
export const SOA_BAKE_ASYNC_MAX_INFLIGHT = 4;
const MAX_CACHED_TILES = 48;
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
      if (oc.getContext('2d')) return oc;
    } catch {
      /* Vitest / older engines — use HTMLCanvasElement below. */
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
    if (isBakeFrameBoundSlot(buf, i)) continue;
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

/** Cross-frame dirty union so preview moves toward origin still erase prior ink. */
let gestureInkDirtyAccum: SoaWorldBounds | null = null;

function unionWorldBounds(
  a: SoaWorldBounds | null,
  b: SoaWorldBounds | null
): SoaWorldBounds | null {
  if (!a) return b;
  if (!b) return a;
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const right = Math.max(a.left + a.width, b.left + b.width);
  const bottom = Math.max(a.top + a.height, b.top + b.height);
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/** Fold current SoA dirty AABB into the gesture accum (call after markSoaDirty*). */
export function accumulateSoaGestureDirtyFromBuffer(buf: SceneRenderBuffer): void {
  gestureInkDirtyAccum = unionWorldBounds(gestureInkDirtyAccum, unionSoaDirtyAabb(buf));
}

export function peekSoaGestureDirtyAccum(): SoaWorldBounds | null {
  return gestureInkDirtyAccum;
}

export function clearSoaGestureDirtyAccum(): void {
  gestureInkDirtyAccum = null;
}

/** Replace gesture accum without reading SoA slots. */
export function seedSoaGestureDirtyAccum(bounds: SoaWorldBounds | null): void {
  gestureInkDirtyAccum = bounds;
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

/** Live idle+basic slots — free holes / SVG hosts must not trip bake alone. */
export function countSoaBakeEligibleSlots(buf: SceneRenderBuffer): number {
  let n = 0;
  for (let i = 0; i < buf.count; i += 1) {
    const flags = buf.flags[i] >>> 0;
    if (flags & SOA_FLAG_FREE) continue;
    if (!(flags & SOA_FLAG_VISIBLE)) continue;
    if (!(flags & SOA_FLAG_CANVAS_IDLE)) continue;
    if (!(flags & SOA_FLAG_BASIC_GEOM)) continue;
    if (isBakeFrameBoundSlot(buf, i)) continue;
    n += 1;
  }
  return n;
}

export function shouldUseSoaBake(buf: SceneRenderBuffer): boolean {
  const thr = getSoaBakeCountThreshold();
  // Eligible ≤ count, so count < thr cannot engage.
  if (buf.count < thr) return false;
  return countSoaBakeEligibleSlots(buf) >= thr;
}

/**
 * Pan/zoom gesture in flight (RcbCanvas cameraMoving).
 * Skip tile bake while true — world tiles stay valid; live WebGL fills the
 * viewport. Bake resumes on settle (avoids zoom thrashing the Worker).
 */
let soaCameraGestureActive = false;

export function setSoaCameraGestureActive(active: boolean): void {
  soaCameraGestureActive = Boolean(active);
}

export function isSoaCameraGestureActive(): boolean {
  return soaCameraGestureActive;
}

/** Bake path gate for WebGL atlas tiles (gesture / transform preview). */
export function isSoaBakePathAllowed(): boolean {
  if (soaCameraGestureActive) return false;
  if (hasNodeTransformPreviews()) return false;
  return true;
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
    skipIndex: (i) => isBakeFrameBoundSlot(buf, i),
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
    if (isBakeFrameBoundSlot(buf, i)) continue;
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

/** Drop tiles overlapping dirty AABB so they rebuild on next collect. */
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

/** Notify when an async tile lands (SceneRenderer bumps idle paint). */
export function subscribeSoaBakeTileReady(listener: () => void): () => void {
  const listeners = getBakeReadyListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifySoaBakeTileReady() {
  const listeners = bakeReadyListeners;
  if (!listeners) return;
  for (const fn of listeners) {
    fn();
  }
}

function canUseSoaBakeWorker(): boolean {
  if (isSoaBakeVitestEnv()) return false;
  return (
    !bakeWorkerFailed &&
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap === 'function'
  );
}

function isSoaBakeVitestEnv(): boolean {
  try {
    return Boolean(import.meta.env.MODE === 'test' || import.meta.env.VITEST);
  } catch {
    return false;
  }
}

function clearBakeAsyncState() {
  bakeQueue.length = 0;
  bakeInflight.clear();
  bakeWorkerSyncedRevision = -1;
}

function getSoaBakeWorker(): Worker | null {
  if (!canUseSoaBakeWorker()) return null;
  if (bakeWorker) return bakeWorker;
  try {
    const w = new Worker(new URL('./soaBakeTile.worker.ts', import.meta.url), {
      type: 'module',
    });
    w.onmessage = (ev: MessageEvent) => {
      handleBakeWorkerMessage(ev.data);
    };
    w.onerror = () => {
      bakeWorkerFailed = true;
      bakeWorker = null;
      clearBakeAsyncState();
      notifySoaBakeTileReady();
    };
    bakeWorker = w;
    return w;
  } catch {
    bakeWorkerFailed = true;
    return null;
  }
}

function handleBakeWorkerMessage(data: {
  type?: string;
  key?: string;
  revision?: number;
  ok?: boolean;
  bitmap?: ImageBitmap;
}) {
  if (!data || data.type !== 'tile') return;
  const key = String(data.key || '');
  bakeInflight.delete(key);
  const cache = getSharedSoaBakeCache();
  const revision = Number(data.revision) || 0;
  if (data.ok && data.bitmap && cache && cache.bufferRevision === revision && key) {
    installBakeTileBitmap(cache, key, revision, data.bitmap);
    notifySoaBakeTileReady();
  } else {
    try {
      data.bitmap?.close?.();
    } catch {
      /* ignore */
    }
  }
  pumpSoaBakeQueue();
}

function installBakeTileBitmap(
  cache: SoaBakeCache,
  key: string,
  revision: number,
  bitmap: ImageBitmap
) {
  const parts = key.split(',');
  const tx = Number(parts[0]);
  const ty = Number(parts[1]);
  const tw = cache.tileWorld;
  const bounds: SoaWorldBounds = {
    left: tx * tw,
    top: ty * tw,
    width: tw,
    height: tw,
  };
  const canvas = createBakeCanvas(SOA_BAKE_TILE_PX, SOA_BAKE_TILE_PX);
  const ctx = canvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) {
    bitmap.close();
    return;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const tile: SoaBakeTile = { key, canvas, bounds, bufferRevision: revision };
  cache.tiles.set(key, tile);
  if (pumpBuf && pumpBuf.revision === revision) {
    bindElementsForTileBounds(pumpBuf, cache, key, bounds);
  }
  touchLru(cache, key);
}

function syncSoaBakeWorkerBuffer(buf: SceneRenderBuffer): boolean {
  const w = getSoaBakeWorker();
  if (!w) return false;
  if (bakeWorkerSyncedRevision === buf.revision) return true;
  const n = Math.max(0, buf.count);
  const pathUsed = Math.max(0, buf.pathXYCount);
  w.postMessage({
    type: 'sync',
    revision: buf.revision,
    count: n,
    positions: buf.positions.slice(0, n * POS_STRIDE),
    radii: buf.radii.slice(0, n * 4),
    colors: buf.colors.slice(0, n),
    flags: buf.flags.slice(0, n),
    kinds: buf.kinds.slice(0, n),
    strokeWidths: buf.strokeWidths.slice(0, n),
    strokeColors: buf.strokeColors.slice(0, n),
    pathXY: buf.pathXY.slice(0, pathUsed),
    pathStart: buf.pathStart.slice(0, n),
    pathLen: buf.pathLen.slice(0, n),
    pathClosed: buf.pathClosed.slice(0, n),
  });
  bakeWorkerSyncedRevision = buf.revision;
  return true;
}

function enqueueSoaBakeJob(job: PendingBakeJob) {
  if (bakeInflight.has(job.key)) return;
  if (bakeQueue.some((q) => q.key === job.key)) return;
  bakeQueue.push(job);
}

function pumpSoaBakeQueue() {
  const buf = pumpBuf;
  if (!buf) return;
  while (bakeInflight.size < SOA_BAKE_ASYNC_MAX_INFLIGHT && bakeQueue.length) {
    const job = bakeQueue.shift();
    if (!job) break;
    if (job.revision !== buf.revision) continue;
    const cache = getSharedSoaBakeCache();
    if (cache?.tiles.get(job.key)?.bufferRevision === job.revision) continue;
    if (bakeInflight.has(job.key)) continue;
    if (!syncSoaBakeWorkerBuffer(buf)) {
      throw new Error('SoA bake Worker unavailable — no idle/main-thread bake path');
    }
    const w = getSoaBakeWorker();
    if (!w) {
      throw new Error('SoA bake Worker unavailable — no idle/main-thread bake path');
    }
    bakeInflight.add(job.key);
    bakeJobSeq += 1;
    w.postMessage({
      type: 'bake',
      jobId: bakeJobSeq,
      key: job.key,
      revision: job.revision,
      tilePx: SOA_BAKE_TILE_PX,
      bounds: job.bounds,
    });
  }
}

/** Ready tiles in view; browser enqueues Worker jobs; Vitest builds sync (no Worker dual path). */
export function collectReadySoaBakeTilesForView(
  buf: SceneRenderBuffer,
  view: { left?: number; top?: number; x?: number; y?: number; width: number; height: number }
): { tiles: SoaBakeTile[]; pending: boolean } {
  const cache = getSharedSoaBakeCache() ?? createSoaBakeCache();
  setSharedSoaBakeCache(cache);
  if (cache.bufferRevision !== buf.revision) {
    cache.tiles.clear();
    cache.lru = [];
    cache.elementToTiles.clear();
    cache.tileToElements.clear();
    cache.bufferRevision = buf.revision;
    cache.tileWorld = getSoaBakeTileWorld();
    clearBakeAsyncState();
  }
  pumpBuf = buf;
  const ready: SoaBakeTile[] = [];
  let pending = false;
  let syncBuilt = 0;
  const useWorker = !isSoaBakeVitestEnv();
  for (const { tx, ty, bounds } of tilesForView(view, cache.tileWorld)) {
    const key = tileKey(tx, ty);
    const cached = cache.tiles.get(key);
    if (cached && cached.bufferRevision === buf.revision) {
      ready.push(cached);
      continue;
    }
    pending = true;
    if (useWorker) {
      enqueueSoaBakeJob({ key, bounds, revision: buf.revision });
      continue;
    }
    if (syncBuilt >= SOA_BAKE_NEW_TILES_PER_FRAME) continue;
    const tile = ensureSoaBakeTile(buf, cache, tx, ty, bounds);
    if (!tile) continue;
    syncBuilt += 1;
    ready.push(tile);
  }
  pumpSoaBakeQueue();
  return {
    tiles: ready,
    pending: pending || bakeInflight.size > 0 || bakeQueue.length > 0,
  };
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
  clearBakeAsyncState();
  sharedCache = null;
  pumpBuf = null;
}
