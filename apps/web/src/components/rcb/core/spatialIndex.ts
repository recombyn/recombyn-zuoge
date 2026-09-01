import type { SceneDocument } from '@/components/rcb/sceneNode';
/**
 * Spatial index for scene AABBs (culling + hit candidate filter).
 * Backed by {@link SoaQuadtree} (world units; pan/zoom only transforms queries).
 */

import { SoaQuadtree, type SoaQuadItem } from './soaQuadtree';
import { nodeLeftTop } from '../scene/paint/sceneToSvg';
import { effectivePaintBox } from './transformPreview';

export type RcbSpatialItem = SoaQuadItem;

export class RcbSpatialIndex {
  private readonly tree: SoaQuadtree;

  /**
   * @param cellSize Leaf capacity hint from former grid cell size
   * (larger → slightly fuller leaves before split).
   */
  constructor(cellSize = 256) {
    const maxItems = Math.max(8, Math.min(32, Math.round(Math.max(32, cellSize) / 16)));
    this.tree = new SoaQuadtree({ maxItems });
  }

  get size() {
    return this.tree.size;
  }

  has(id: string) {
    return this.tree.has(id);
  }

  /** Indexed ids (unordered). Prefer for membership sync — not a cull hot path. */
  ids(): IterableIterator<string> {
    return this.tree.ids();
  }

  clear() {
    this.tree.clear();
  }

  /**
   * Build / refresh AABBs from a SceneRenderBuffer (SoA paint sidecar).
   * Document spatial remains the authoring source; this feeds cull/hit when
   * idle shapes live only in the buffer.
   */
  static fromRenderBuffer(
    buf: {
      count: number;
      positions: Float32Array;
      flags: Uint32Array;
      ids: Array<string | undefined>;
    },
    opts?: { cellSize?: number; visibleFlag?: number }
  ): RcbSpatialIndex {
    const index = new RcbSpatialIndex(opts?.cellSize);
    const visibleFlag = opts?.visibleFlag ?? 1; // SOA_FLAG_VISIBLE
    const stride = 4;
    for (let i = 0; i < buf.count; i += 1) {
      if (!(buf.flags[i] & visibleFlag)) continue;
      const id = buf.ids[i];
      if (!id) continue;
      const o = i * stride;
      const x = buf.positions[o];
      const y = buf.positions[o + 1];
      const w = buf.positions[o + 2];
      const h = buf.positions[o + 3];
      index.upsert({
        id,
        minX: Math.min(x, x + w),
        minY: Math.min(y, y + h),
        maxX: Math.max(x, x + w),
        maxY: Math.max(y, y + h),
      });
    }
    return index;
  }

  upsert(item: RcbSpatialItem) {
    this.tree.upsert(item);
  }

  remove(id: string) {
    this.tree.remove(id);
  }

  /** All items whose AABB intersects the query rect. */
  search(minX: number, minY: number, maxX: number, maxY: number): RcbSpatialItem[] {
    return this.tree.search(minX, minY, maxX, maxY);
  }

  searchPoint(x: number, y: number, pad = 0): RcbSpatialItem[] {
    return this.tree.searchPoint(x, y, pad);
  }
}

export function boxesIntersect(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number }
) {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

/** Bottom→top rank from ROOT/page children (O(N) once per id-list change). */
export function buildIdRankMap(ids: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 1) m.set(ids[i], i);
  return m;
}

/**
 * Order candidate ids by document rank without scanning the full id list.
 * ascending = bottom→top (paint / cull); descending = top→bottom (hit-test).
 */
export function sortIdsByRank(
  ids: Iterable<string>,
  rank: Map<string, number>,
  opts?: { ascending?: boolean }
): string[] {
  const ascending = opts?.ascending !== false;
  const out = Array.from(ids);
  out.sort((a, b) => {
    const ra = rank.get(a) ?? -1;
    const rb = rank.get(b) ?? -1;
    return ascending ? ra - rb : rb - ra;
  });
  return out;
}

/** Axis AABB in scene space (rotation-expanded). Optional pad for stroke / hit slack. */
export function nodeSceneAabb(
  document: SceneDocument,
  nodeId: string,
  pad = 0
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const node = document?.deltaSetLike?.[nodeId];
  if (!node) return null;
  const { left: docLeft, top: docTop } = nodeLeftTop(document, node);
  const paint = effectivePaintBox(
    nodeId,
    {
      left: docLeft,
      top: docTop,
      width: Math.max(1, Number(node.width) || 1),
      height: Math.max(1, Number(node.height) || 1),
    },
    Number(node.attrs?.angle) || 0
  );
  if (paint.hidden) return null;
  const x0 = paint.left;
  const y0 = paint.top;
  const w = paint.width;
  const h = paint.height;
  const angle = paint.angle;
  let minX = x0;
  let minY = y0;
  let maxX = x0 + w;
  let maxY = y0 + h;
  if (Math.abs(angle) > 0.5) {    const rad = (Math.abs(angle) * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const bw = w * cos + h * sin;
    const bh = w * sin + h * cos;
    const cx = x0 + w / 2;
    const cy = y0 + h / 2;
    minX = cx - bw / 2;
    minY = cy - bh / 2;
    maxX = cx + bw / 2;
    maxY = cy + bh / 2;
  }
  // Puppet pin displacements can pull ink outside the plate — expand pick AABB.
  const attrs = (node.attrs || {}) as Record<string, unknown>;
  if (
    node.key === 'image' &&
    (attrs.puppetEnabled === true || attrs.puppetEnabled === 'true')
  ) {
    let maxOut = 0;
    const consider = (raw: unknown) => {
      if (!Array.isArray(raw)) return;
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const dx = Number(o.dx) || 0;
        const dy = Number(o.dy) || 0;
        maxOut = Math.max(maxOut, Math.abs(dx) * w, Math.abs(dy) * h);
      }
    };
    consider(attrs.puppetPins);
    if (Array.isArray(attrs.puppetTrack)) {
      for (const k of attrs.puppetTrack) {
        if (k && typeof k === 'object') consider((k as Record<string, unknown>).pins);
      }
    }
    if (maxOut > 0) {
      minX -= maxOut;
      minY -= maxOut;
      maxX += maxOut;
      maxY += maxOut;
    }
  }
  const stroke = Math.max(
    0,
    Number(node.attrs?.['border-width'] ?? 0) ||
      0
  );
  const expand = pad + stroke;
  return {
    minX: minX - expand,
    minY: minY - expand,
    maxX: maxX + expand,
    maxY: maxY + expand,
  };
}

/** Prefer spatial candidates once the scene reaches this many root ids. */
export const SCENE_SPATIAL_LARGE_THRESHOLD = 48;

export type SceneSpatialSyncInput = {
  document: SceneDocument;
  /** Prefer the live ROOT/page children array (identity used for membership). */
  childrenIds: readonly string[];
  reloadToken: number | string;
  patchedNodeIds?: readonly string[];
  /** Extra AABB pad in scene units (stroke handled inside nodeSceneAabb). */
  aabbPad?: number;
};

/**
 * Owns spatial index + id rank for cull / hit / marquee.
 * Full rebuild on reloadToken; membership only when children identity changes;
 * geometry refresh via patchedNodeIds — never O(N) AABB rebuild on size drift.
 */
export class SceneSpatialRuntime {
  readonly index: RcbSpatialIndex;
  private reloadToken: number | string | null = null;
  private childrenRef: readonly string[] | null = null;
  private rank = new Map<string, number>();

  constructor(cellSize = 256) {
    this.index = new RcbSpatialIndex(cellSize);
  }

  get size() {
    return this.index.size;
  }

  get idRank(): ReadonlyMap<string, number> {
    return this.rank;
  }

  clear() {
    this.index.clear();
    this.reloadToken = null;
    this.childrenRef = null;
    this.rank = new Map();
  }

  sync(input: SceneSpatialSyncInput): RcbSpatialIndex {
    const doc = input.document;
    if (!doc) {
      this.clear();
      return this.index;
    }
    const childrenSrc = input.childrenIds;
    const pad = input.aabbPad ?? 32;
    const patched = input.patchedNodeIds || [];

    const tokenChanged = this.reloadToken !== input.reloadToken;
    const childrenChanged = this.childrenRef !== childrenSrc;
    if (tokenChanged || childrenChanged || this.index.size === 0) {
      this.rank = buildIdRankMap(childrenSrc);
      this.childrenRef = childrenSrc;
    }

    if (tokenChanged || this.index.size === 0) {
      this.index.clear();
      for (const id of childrenSrc) {
        const box = nodeSceneAabb(doc, id, pad);
        if (!box) continue;
        this.index.upsert({ id, ...box });
      }
      this.reloadToken = input.reloadToken;
      return this.index;
    }

    if (childrenChanged) {
      const idSet = new Set(childrenSrc);
      for (const id of [...this.index.ids()]) {
        if (!idSet.has(id)) this.index.remove(id);
      }
      for (const id of childrenSrc) {
        if (this.index.has(id)) continue;
        const box = nodeSceneAabb(doc, id, pad);
        if (box) this.index.upsert({ id, ...box });
      }
    }

    this.patchNodes(doc, patched, pad);
    return this.index;
  }

  /** Live geometry preview — keep broad-phase AABBs aligned with documentRef. */
  patchNodes(
    document: SceneDocument,
    patchedNodeIds: readonly string[],
    aabbPad = 32
  ): void {
    for (const raw of patchedNodeIds) {
      const id = String(raw || '').trim();
      if (!id) continue;
      if (!document.deltaSetLike?.[id]) {
        this.index.remove(id);
        continue;
      }
      const box = nodeSceneAabb(document, id, aabbPad);
      if (!box) this.index.remove(id);
      else this.index.upsert({ id, ...box });
    }
  }

  /** Bottom→top ids intersecting rect (rank-sorted hits only). */
  queryIdsInRect(
    box: { left: number; top: number; width: number; height: number },
    opts?: { ascending?: boolean }
  ): string[] {
    const hits = this.index.search(
      box.left,
      box.top,
      box.left + box.width,
      box.top + box.height
    );
    if (!hits.length) return [];
    return sortIdsByRank(
      hits.map((h) => h.id),
      this.rank,
      { ascending: opts?.ascending !== false }
    );
  }

  /** Top→bottom hit-test order — always spatial broad-phase (no full-scene scan). */
  hitCandidateIds(opts: { x: number; y: number; pad: number }): string[] {
    const nearby = this.index.searchPoint(opts.x, opts.y, opts.pad);
    return sortIdsByRank(
      nearby.map((n) => n.id),
      this.rank,
      { ascending: false }
    );
  }

  /**
   * Refresh AABBs from a SceneRenderBuffer (SoA paint sidecar).
   * Only upserts slots present in the buffer — does not drop text/media hosts
   * that are indexed from the document but absent from SoA.
   */
  upsertFromRenderBuffer(
    buf: {
      count: number;
      positions: Float32Array;
      flags: Uint32Array;
      ids: Array<string | undefined>;
    },
    opts?: { pad?: number; visibleFlag?: number }
  ): number {
    const pad = opts?.pad ?? 0;
    const visibleFlag = opts?.visibleFlag ?? 1;
    const stride = 4;
    let n = 0;
    for (let i = 0; i < buf.count; i += 1) {
      if (!(buf.flags[i] & visibleFlag)) continue;
      const id = buf.ids[i];
      if (!id) continue;
      const o = i * stride;
      const x = buf.positions[o];
      const y = buf.positions[o + 1];
      const w = buf.positions[o + 2];
      const h = buf.positions[o + 3];
      const minX = Math.min(x, x + w) - pad;
      const minY = Math.min(y, y + h) - pad;
      const maxX = Math.max(x, x + w) + pad;
      const maxY = Math.max(y, y + h) + pad;
      this.index.upsert({ id, minX, minY, maxX, maxY });
      n += 1;
    }
    return n;
  }

  /**
   * Patch a few SoA slot AABBs into the shared index (promote/demote wake).
   * Avoids full-buffer upsertFromRenderBuffer on every flag flip.
   */
  upsertIdsFromRenderBuffer(
    buf: {
      indexById: Map<string, number>;
      positions: Float32Array;
      flags: Uint32Array;
      ids: Array<string | undefined>;
      count: number;
    },
    ids: readonly string[],
    opts?: { pad?: number; visibleFlag?: number }
  ): number {
    const pad = opts?.pad ?? 0;
    const visibleFlag = opts?.visibleFlag ?? 1;
    const stride = 4;
    let n = 0;
    for (const raw of ids) {
      const id = String(raw || '');
      if (!id) continue;
      const i = buf.indexById.get(id);
      if (i == null || i < 0 || i >= buf.count) continue;
      if (!(buf.flags[i] & visibleFlag)) continue;
      const o = i * stride;
      const x = buf.positions[o];
      const y = buf.positions[o + 1];
      const w = buf.positions[o + 2];
      const h = buf.positions[o + 3];
      this.index.upsert({
        id,
        minX: Math.min(x, x + w) - pad,
        minY: Math.min(y, y + h) - pad,
        maxX: Math.max(x, x + w) + pad,
        maxY: Math.max(y, y + h) + pad,
      });
      n += 1;
    }
    return n;
  }
}

/**
 * Product canvas registers the live SceneSpatialRuntime here so stage underlay
 * / other consumers share one sync source (ADR 0027) instead of a second empty index.
 */
let sharedSceneSpatial: SceneSpatialRuntime | null = null;

export function setSharedSceneSpatialRuntime(
  runtime: SceneSpatialRuntime | null
): void {
  sharedSceneSpatial = runtime;
}

export function getSharedSceneSpatialRuntime(): SceneSpatialRuntime | null {
  return sharedSceneSpatial;
}

