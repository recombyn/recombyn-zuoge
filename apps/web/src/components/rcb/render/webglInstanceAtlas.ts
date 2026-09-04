/**
 * WebGL instance atlas — fixed-cell LRU packer for path / outline stamps + bake tiles
 * (ADR 0027). One textured quad replaces many line segments.
 */
import {
  SOA_KIND_ELLIPSE,
  SOA_KIND_IMAGE,
  SOA_KIND_PATH,
  SOA_KIND_POLY,
  SOA_KIND_RECT,
  SOA_KIND_TEXT,
  type SceneRenderBuffer,
} from '@/components/rcb/render/sceneRenderBuffer';

export const SOA_ATLAS_DEFAULT_SIZE = 2048;
export const SOA_ATLAS_CELL = 256;
export const SOA_ATLAS_PAD = 2;
/** Usable texels per cell after padding — idle media softer than this on screen. */
export const SOA_ATLAS_INNER = SOA_ATLAS_CELL - SOA_ATLAS_PAD * 2;
/** Prefer atlas stamp when a path would emit at least this many segments. */
export const SOA_ATLAS_SEG_THRESHOLD = 12;

/** Longest screen edge (CSS px × dpr) for an idle media stamp. */
export function idleMediaScreenEdgePx(
  width: number,
  height: number,
  zoom: number,
  dpr = 1
): number {
  const edge = Math.max(Math.max(1, Number(width) || 1), Math.max(1, Number(height) || 1));
  return edge * Math.max(0.05, Number(zoom) || 1) * Math.max(1, Number(dpr) || 1);
}

/**
 * Idle image/video stamps into a fixed atlas cell. When the on-screen edge
 * exceeds that cell, the stamp looks soft until selection paint-raises a
 * full-res SVG host — promote those nodes to DOM hosts while zoomed in.
 *
 * Empty generators are excluded: they bake a plate glyph (no bitmap to sharpen),
 * and DOM promotion would paint above all SoA rects, breaking stackOrder.
 */
export function idleMediaNeedsSharpHost(
  node:
    | {
        key?: unknown;
        width?: unknown;
        height?: unknown;
        attrs?: Record<string, unknown> | null;
      }
    | null
    | undefined,
  zoom: number,
  dpr = 1
): boolean {
  if (!node) return false;
  const key = String(node.key || '');
  if (key !== 'image' && key !== 'video') return false;
  const attrs = node.attrs || {};
  const isImageGen =
    attrs.imageGenerator === true || String(attrs.imageGenerator || '') === 'true';
  const isVideoGen =
    attrs.videoGenerator === true || String(attrs.videoGenerator || '') === 'true';
  if (isImageGen || isVideoGen) {
    const src = String(
      (key === 'video' ? attrs.poster : null) || attrs.src || ''
    ).trim();
    // Empty plate — stay on canvas/atlas idle so stackOrder matches rects.
    if (!src) return false;
  }
  return idleMediaScreenEdgePx(Number(node.width) || 1, Number(node.height) || 1, zoom, dpr) >
    SOA_ATLAS_INNER;
}


export type SoaAtlasRegion = {
  key: string;
  cell: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** World AABB stamped into this cell. */
  world: { left: number; top: number; width: number; height: number };
};

export type SoaAtlasStats = {
  hits: number;
  misses: number;
  evictions: number;
  restamps: number;
  releases: number;
};

export type SoaWebglAtlas = {
  size: number;
  cell: number;
  cols: number;
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  regions: Map<string, SoaAtlasRegion>;
  /** Free cell indices. */
  free: number[];
  /** LRU order: oldest at front. */
  lru: string[];
  revision: number;
  stats: SoaAtlasStats;
};

export function createEmptySoaAtlasStats(): SoaAtlasStats {
  return { hits: 0, misses: 0, evictions: 0, restamps: 0, releases: 0 };
}

function createAtlasSurface(size: number): {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
} | null {
  // Reuse the first 2d context — some envs null a second getContext on the same canvas.
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const oc = new OffscreenCanvas(size, size);
      const ctx = oc.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
      if (ctx) return { canvas: oc, ctx };
    } catch {
      /* fall through */
    }
  }
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  return { canvas: c, ctx };
}

/** Atlas stamps — product always on with WebGL. Off in Vitest. */
export function isSoaWebglAtlasEnabled(): boolean {
  try {
    if (import.meta.env.MODE === 'test' || import.meta.env.VITEST) return false;
    return true;
  } catch {
    return true;
  }
}

export function createSoaWebglAtlas(
  size = SOA_ATLAS_DEFAULT_SIZE,
  cell = SOA_ATLAS_CELL
): SoaWebglAtlas | null {
  const surface = createAtlasSurface(size);
  if (!surface) return null;
  const { canvas, ctx } = surface;
  const cols = Math.max(1, Math.floor(size / cell));
  const n = cols * cols;
  const free: number[] = [];
  for (let i = 0; i < n; i += 1) free.push(i);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);
  return {
    size,
    cell,
    cols,
    canvas,
    ctx,
    regions: new Map(),
    free,
    lru: [],
    revision: 0,
    stats: createEmptySoaAtlasStats(),
  };
}

export function resetSoaWebglAtlas(atlas: SoaWebglAtlas) {
  atlas.regions.clear();
  atlas.lru = [];
  atlas.free = [];
  const n = atlas.cols * atlas.cols;
  for (let i = 0; i < n; i += 1) atlas.free.push(i);
  atlas.revision += 1;
  atlas.stats = createEmptySoaAtlasStats();
  atlas.ctx.setTransform(1, 0, 0, 1, 0, 0);
  atlas.ctx.clearRect(0, 0, atlas.size, atlas.size);
}

function touchLru(atlas: SoaWebglAtlas, key: string) {
  const i = atlas.lru.indexOf(key);
  if (i >= 0) atlas.lru.splice(i, 1);
  atlas.lru.push(key);
}

function cellOrigin(atlas: SoaWebglAtlas, cellIndex: number) {
  const col = cellIndex % atlas.cols;
  const row = Math.floor(cellIndex / atlas.cols);
  return { x: col * atlas.cell, y: row * atlas.cell };
}

/** Evict oldest LRU entry and free its cell. Returns false if nothing to evict. */
export function evictSoaAtlasOldest(atlas: SoaWebglAtlas): boolean {
  const oldest = atlas.lru.shift();
  if (!oldest) return false;
  const region = atlas.regions.get(oldest);
  if (!region) return false;
  atlas.regions.delete(oldest);
  const { x, y } = cellOrigin(atlas, region.cell);
  atlas.ctx.clearRect(x, y, atlas.cell, atlas.cell);
  atlas.free.push(region.cell);
  atlas.revision += 1;
  atlas.stats.evictions += 1;
  return true;
}

/** Free one region by key (keeps other cells intact). */
export function releaseSoaAtlasRegion(atlas: SoaWebglAtlas, key: string): boolean {
  const region = atlas.regions.get(key);
  if (!region) return false;
  atlas.regions.delete(key);
  const i = atlas.lru.indexOf(key);
  if (i >= 0) atlas.lru.splice(i, 1);
  const { x, y } = cellOrigin(atlas, region.cell);
  atlas.ctx.clearRect(x, y, atlas.cell, atlas.cell);
  atlas.free.push(region.cell);
  atlas.revision += 1;
  atlas.stats.releases += 1;
  return true;
}

/** Release all regions whose key starts with `prefix`. */
export function releaseSoaAtlasPrefix(atlas: SoaWebglAtlas, prefix: string): number {
  let n = 0;
  for (const key of [...atlas.regions.keys()]) {
    if (!key.startsWith(prefix)) continue;
    if (releaseSoaAtlasRegion(atlas, key)) n += 1;
  }
  return n;
}

/**
 * Drop path/round stamps whose node left the SoA buffer (keeps still-valid cells).
 * Bake tiles (`bake:`) are managed separately via bake revision.
 */
export function pruneSoaAtlasForBuffer(atlas: SoaWebglAtlas, buf: SceneRenderBuffer): number {
  const keep = new Set<string>();
  for (let i = 0; i < buf.count; i += 1) {
    const id = buf.ids[i];
    if (!id) continue;
    const kind = buf.kinds[i];
    if (kind === SOA_KIND_PATH) keep.add(`path:${id}`);
    if (kind === SOA_KIND_RECT) {
      keep.add(`round:${id}`);
      keep.add(`rich:${id}`);
    }
    if (kind === SOA_KIND_ELLIPSE || kind === SOA_KIND_POLY || kind === SOA_KIND_PATH) {
      keep.add(`rich:${id}`);
    }
    if (kind === SOA_KIND_IMAGE) {
      // image/video share IMAGE kind; audio stamps use aud: prefix.
      keep.add(`img:${id}`);
      keep.add(`aud:${id}`);
    }
    if (kind === SOA_KIND_TEXT) keep.add(`txt:${id}`);
  }
  let n = 0;
  for (const key of [...atlas.regions.keys()]) {
    if (
      !key.startsWith('path:') &&
      !key.startsWith('round:') &&
      !key.startsWith('img:') &&
      !key.startsWith('aud:') &&
      !key.startsWith('txt:') &&
      !key.startsWith('rich:')
    ) {
      continue;
    }
    if (keep.has(key)) continue;
    if (releaseSoaAtlasRegion(atlas, key)) n += 1;
  }
  return n;
}

export function getSoaAtlasStats(atlas: SoaWebglAtlas): SoaAtlasStats {
  return { ...atlas.stats };
}

function allocateCell(atlas: SoaWebglAtlas): number | null {
  if (atlas.free.length > 0) return atlas.free.pop()!;
  if (!evictSoaAtlasOldest(atlas)) return null;
  if (atlas.free.length > 0) return atlas.free.pop()!;
  return null;
}

export function computePolylineWorldBounds(
  xy: Float32Array,
  startFloat: number,
  pointCount: number
): { left: number; top: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (let i = 0; i < pointCount; i += 1) {
    const o = startFloat + i * 2;
    const x = xy[o];
    const y = xy[o + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    any = true;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!any) return null;
  const pad = 2;
  return {
    left: minX - pad,
    top: minY - pad,
    width: Math.max(1, maxX - minX + pad * 2),
    height: Math.max(1, maxY - minY + pad * 2),
  };
}

function beginCellStamp(
  atlas: SoaWebglAtlas,
  key: string,
  world: { left: number; top: number; width: number; height: number }
): SoaAtlasRegion | null {
  const hit = atlas.regions.get(key);
  if (hit) {
    touchLru(atlas, key);
    return hit;
  }
  const cell = allocateCell(atlas);
  if (cell == null) return null;
  const origin = cellOrigin(atlas, cell);
  const inner = atlas.cell - SOA_ATLAS_PAD * 2;
  const scale = Math.min(1, inner / Math.max(world.width, world.height));
  const pw = Math.max(4, Math.ceil(world.width * scale));
  const ph = Math.max(4, Math.ceil(world.height * scale));
  const x = origin.x + SOA_ATLAS_PAD;
  const y = origin.y + SOA_ATLAS_PAD;
  atlas.ctx.clearRect(origin.x, origin.y, atlas.cell, atlas.cell);
  const region: SoaAtlasRegion = {
    key,
    cell,
    x,
    y,
    w: pw,
    h: ph,
    world,
  };
  atlas.regions.set(key, region);
  touchLru(atlas, key);
  atlas.revision += 1;
  return region;
}

function atlasCssIsOpaque(c: string): boolean {
  const s = String(c || '')
    .trim()
    .toLowerCase();
  if (!s || s === 'none' || s === 'transparent') return false;
  if (s === 'rgba(0,0,0,0)' || s.startsWith('rgba(0,0,0,0')) return false;
  return true;
}

type AtlasStrokeStampOpts = {
  force?: boolean;
  strokeCss?: string;
  strokeWidth?: number;
};

type AtlasWorldBox = { left: number; top: number; width: number; height: number };

/** True when a cached stamp's world AABB no longer matches the live polyline. */
function atlasWorldMismatch(a: AtlasWorldBox, b: AtlasWorldBox): boolean {
  return (
    Math.abs(a.left - b.left) > 0.5 ||
    Math.abs(a.top - b.top) > 0.5 ||
    Math.abs(a.width - b.width) > 0.5 ||
    Math.abs(a.height - b.height) > 0.5
  );
}

/** Hit / restamp bookkeeping shared by path / rect / ellipse / image stamps. */
function takeAtlasStampSlot(
  atlas: SoaWebglAtlas,
  key: string,
  opts?: { force?: boolean }
): SoaAtlasRegion | 'draw' | null {
  const existing = atlas.regions.get(key);
  if (existing && !opts?.force) {
    touchLru(atlas, key);
    atlas.stats.hits += 1;
    return existing;
  }
  if (existing && opts?.force) {
    releaseSoaAtlasRegion(atlas, key);
    atlas.stats.restamps += 1;
  } else {
    atlas.stats.misses += 1;
  }
  return 'draw';
}

function strokePaddedWorld(world: AtlasWorldBox, strokeW: number): AtlasWorldBox {
  if (!(strokeW > 0)) return world;
  return {
    left: world.left - strokeW,
    top: world.top - strokeW,
    width: world.width + strokeW * 2,
    height: world.height + strokeW * 2,
  };
}

function withAtlasWorldTransform(
  atlas: SoaWebglAtlas,
  region: SoaAtlasRegion,
  stampWorld: AtlasWorldBox,
  scale: number,
  draw: (ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) => void
) {
  const { ctx } = atlas;
  ctx.save();
  ctx.beginPath();
  ctx.rect(region.x, region.y, region.w, region.h);
  ctx.clip();
  ctx.setTransform(
    scale,
    0,
    0,
    scale,
    region.x - stampWorld.left * scale,
    region.y - stampWorld.top * scale
  );
  draw(ctx);
  ctx.restore();
}

function fillStrokeClosedPath(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  fillCss: string,
  strokeW: number,
  strokeCss: string
) {
  if (atlasCssIsOpaque(fillCss)) {
    ctx.fillStyle = fillCss;
    ctx.fill();
  }
  if (strokeW > 0 && atlasCssIsOpaque(strokeCss)) {
    ctx.strokeStyle = strokeCss;
    ctx.lineWidth = strokeW;
    ctx.lineJoin = 'miter';
    ctx.stroke();
  }
}

/**
 * Stamp a world-space polyline into a fixed atlas cell (LRU-evicts when full).
 */
export function stampSoaPathToAtlas(
  atlas: SoaWebglAtlas,
  key: string,
  xy: Float32Array,
  startPoint: number,
  pointCount: number,
  fillCss: string,
  closed: boolean,
  lineWidth = 2,
  opts?: { force?: boolean; strokeCss?: string; fillRule?: 'nonzero' | 'evenodd' }
): SoaAtlasRegion | null {
  const polyWorld = computePolylineWorldBounds(xy, startPoint * 2, pointCount);
  if (!polyWorld) return null;
  // Half-stroke (+ round caps) must fit the stamp cell — same as rect/ellipse.
  const world = strokePaddedWorld(polyWorld, Math.max(0, lineWidth));
  const existing = atlas.regions.get(key);
  // Geometry moved but DIRTY was cleared → restamp or idle shows a stale AABB 色块.
  const force =
    Boolean(opts?.force) || Boolean(existing && atlasWorldMismatch(existing.world, world));
  const slot = takeAtlasStampSlot(atlas, key, { force });
  if (slot !== 'draw') return slot;
  const region = beginCellStamp(atlas, key, world);
  if (!region) return null;

  const strokeCss = opts?.strokeCss ?? fillCss;
  const fillRule = opts?.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
  const hasFill = closed && atlasCssIsOpaque(fillCss);
  const strokeOk = atlasCssIsOpaque(strokeCss);
  const inner = atlas.cell - SOA_ATLAS_PAD * 2;
  const scale = Math.min(1, inner / Math.max(world.width, world.height));
  withAtlasWorldTransform(atlas, region, world, scale, (ctx) => {
    ctx.strokeStyle = strokeCss;
    ctx.fillStyle = fillCss;
    // lineWidth is scene units; setTransform(scale) already maps to atlas pixels.
    // Dividing by scale previously thickened strokes by 1/scale when paths were
    // downsampled into a cell (looked fat + soft after the textured quad upscaled).
    ctx.lineWidth = lineWidth;
    ctx.lineCap = closed ? 'round' : 'butt';
    ctx.lineJoin = closed ? 'round' : 'miter';
    ctx.beginPath();
    let pending = false;
    const base = startPoint * 2;
    for (let i = 0; i < pointCount; i += 1) {
      const o = base + i * 2;
      const x = xy[o];
      const y = xy[o + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        if (pending && closed) ctx.closePath();
        pending = false;
        continue;
      }
      if (!pending) {
        ctx.moveTo(x, y);
        pending = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    if (pending && closed) ctx.closePath();
    if (hasFill && closed) {
      if (fillRule === 'evenodd') ctx.fill('evenodd');
      else ctx.fill();
    }
    // lineWidth 0 → fill-only stamp; outline is emitted as crisp WebGL segments.
    if (strokeOk && lineWidth > 0) ctx.stroke();
  });
  return region;
}

/**
 * Stamp a filled rounded rect (optional outline). Instanced quads are sharp fill-only.
 */
export function stampSoaRoundedRectToAtlas(
  atlas: SoaWebglAtlas,
  key: string,
  world: AtlasWorldBox,
  colorCss: string,
  radii: { tl: number; tr: number; br: number; bl: number },
  opts?: AtlasStrokeStampOpts
): SoaAtlasRegion | null {
  const slot = takeAtlasStampSlot(atlas, key, opts);
  if (slot !== 'draw') return slot;
  const strokeW = Math.max(0, Number(opts?.strokeWidth) || 0);
  const strokeCss = String(opts?.strokeCss || '');
  const stampWorld = strokePaddedWorld(world, strokeW);
  const region = beginCellStamp(atlas, key, stampWorld);
  if (!region) return null;
  const inner = atlas.cell - SOA_ATLAS_PAD * 2;
  const scale = Math.min(1, inner / Math.max(stampWorld.width, stampWorld.height));
  withAtlasWorldTransform(atlas, region, stampWorld, scale, (ctx) => {
    const { left: x, top: y, width: w, height: h } = world;
    const tl = Math.max(0, radii.tl);
    const tr = Math.max(0, radii.tr);
    const br = Math.max(0, radii.br);
    const bl = Math.max(0, radii.bl);
    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + w - tr, y);
    if (tr > 0) ctx.arcTo(x + w, y, x + w, y + tr, tr);
    else ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - br);
    if (br > 0) ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
    else ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + bl, y + h);
    if (bl > 0) ctx.arcTo(x, y + h, x, y + h - bl, bl);
    else ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + tl);
    if (tl > 0) ctx.arcTo(x, y, x + tl, y, tl);
    else ctx.lineTo(x, y);
    ctx.closePath();
    fillStrokeClosedPath(ctx, colorCss, strokeW, strokeCss);
  });
  return region;
}

/** Ellipse fill (+ optional outline) stamp. */
export function stampSoaEllipseToAtlas(
  atlas: SoaWebglAtlas,
  key: string,
  world: AtlasWorldBox,
  colorCss: string,
  opts?: AtlasStrokeStampOpts
): SoaAtlasRegion | null {
  const slot = takeAtlasStampSlot(atlas, key, opts);
  if (slot !== 'draw') return slot;
  const strokeW = Math.max(0, Number(opts?.strokeWidth) || 0);
  const strokeCss = String(opts?.strokeCss || '');
  const stampWorld = strokePaddedWorld(world, strokeW);
  const region = beginCellStamp(atlas, key, stampWorld);
  if (!region) return null;
  const inner = atlas.cell - SOA_ATLAS_PAD * 2;
  const scale = Math.min(1, inner / Math.max(stampWorld.width, stampWorld.height));
  withAtlasWorldTransform(atlas, region, stampWorld, scale, (ctx) => {
    const cx = world.left + world.width / 2;
    const cy = world.top + world.height / 2;
    const rx = Math.max(0.5, world.width / 2);
    const ry = Math.max(0.5, world.height / 2);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    fillStrokeClosedPath(ctx, colorCss, strokeW, strokeCss);
  });
  return region;
}

/**
 * Copy a bake / OffscreenCanvas tile into the atlas (shared with path stamps).
 * Pass `force: true` after a bake tile rebuild so pixels refresh in-place.
 */
export function stampImageToAtlas(
  atlas: SoaWebglAtlas,
  key: string,
  source: CanvasImageSource,
  world: { left: number; top: number; width: number; height: number },
  opts?: { force?: boolean }
): SoaAtlasRegion | null {
  if (!atlasStampSourceIsSafe(source)) return null;
  const existing = atlas.regions.get(key);
  if (existing && !opts?.force) {
    touchLru(atlas, key);
    atlas.stats.hits += 1;
    return existing;
  }
  if (existing && opts?.force) {
    // Redraw into the same cell (stable UV).
    const { ctx } = atlas;
    existing.world = world;
    const inner = atlas.cell - SOA_ATLAS_PAD * 2;
    const scale = Math.min(1, inner / Math.max(world.width, world.height));
    existing.w = Math.max(4, Math.ceil(world.width * scale));
    existing.h = Math.max(4, Math.ceil(world.height * scale));
    ctx.save();
    const origin = cellOrigin(atlas, existing.cell);
    ctx.clearRect(origin.x, origin.y, atlas.cell, atlas.cell);
    try {
      ctx.drawImage(source, existing.x, existing.y, existing.w, existing.h);
    } catch {
      ctx.restore();
      releaseSoaAtlasRegion(atlas, key);
      return null;
    }
    ctx.restore();
    touchLru(atlas, key);
    atlas.revision += 1;
    atlas.stats.restamps += 1;
    return existing;
  }
  atlas.stats.misses += 1;
  const region = beginCellStamp(atlas, key, world);
  if (!region) return null;
  const { ctx } = atlas;
  ctx.save();
  ctx.clearRect(region.x, region.y, region.w, region.h);
  try {
    ctx.drawImage(source, region.x, region.y, region.w, region.h);
  } catch {
    atlas.regions.delete(key);
    const i = atlas.lru.indexOf(key);
    if (i >= 0) atlas.lru.splice(i, 1);
    atlas.free.push(region.cell);
    ctx.restore();
    return null;
  }
  ctx.restore();
  return region;
}

export function atlasRegionToUv(atlas: SoaWebglAtlas, region: SoaAtlasRegion) {
  const s = atlas.size;
  return {
    u0: region.x / s,
    v0: region.y / s,
    u1: (region.x + region.w) / s,
    v1: (region.y + region.h) / s,
  };
}

export function pushAtlasRegionInstance(
  atlas: SoaWebglAtlas,
  region: SoaAtlasRegion,
  rects: number[],
  colors: number[],
  kinds: number[],
  angles: number[],
  uvs: number[],
  angleRad = 0,
  offsetX = 0,
  offsetY = 0
) {
  const uv = atlasRegionToUv(atlas, region);
  const { world } = region;
  rects.push(world.left + offsetX, world.top + offsetY, world.width, world.height);
  colors.push(1, 1, 1, 1);
  kinds.push(3);
  angles.push(Number(angleRad) || 0);
  uvs.push(uv.u0, uv.v0, uv.u1, uv.v1);
}

/** Collect atlas quads for viewport bake tiles; returns number of tiles stamped. */
export function collectSoaBakeTilesIntoAtlas(
  atlas: SoaWebglAtlas,
  tiles: Array<{
    key: string;
    canvas: CanvasImageSource;
    bounds: { left: number; top: number; width: number; height: number };
    /** True when bake canvas was just rebuilt — force atlas pixel refresh. */
    force?: boolean;
  }>,
  rects: number[],
  colors: number[],
  kinds: number[],
  angles: number[],
  uvs: number[]
): number {
  let n = 0;
  for (const tile of tiles) {
    const region = stampImageToAtlas(
      atlas,
      `bake:${tile.key}`,
      tile.canvas,
      tile.bounds,
      { force: tile.force === true }
    );
    if (!region) continue;
    pushAtlasRegionInstance(atlas, region, rects, colors, kinds, angles, uvs);
    n += 1;
  }
  return n;
}

let sharedAtlas: SoaWebglAtlas | null = null;

export function ensureSharedSoaWebglAtlas(): SoaWebglAtlas | null {
  if (!sharedAtlas) sharedAtlas = createSoaWebglAtlas();
  return sharedAtlas;
}

/** Drop a tainted atlas surface and allocate a fresh one (WebGL texImage2D recovery). */
export function recreateSharedSoaWebglAtlas(): SoaWebglAtlas | null {
  sharedAtlas = createSoaWebglAtlas();
  return sharedAtlas;
}

/** True when a stamp source will not taint the atlas canvas. */
export function atlasStampSourceIsSafe(source: CanvasImageSource): boolean {
  if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
    try {
      const ctx = source.getContext('2d');
      if (!ctx) return false;
      ctx.getImageData(0, 0, 1, 1);
      return true;
    } catch {
      return false;
    }
  }
  if (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas) {
    try {
      const ctx = source.getContext('2d');
      if (!ctx) return false;
      ctx.getImageData(0, 0, 1, 1);
      return true;
    } catch {
      return false;
    }
  }
  // HTMLImageElement / ImageBitmap / Video — trust caller CORS; drawImage of
  // cross-origin without CORS taints. Prefer baking through a readable canvas.
  return true;
}
