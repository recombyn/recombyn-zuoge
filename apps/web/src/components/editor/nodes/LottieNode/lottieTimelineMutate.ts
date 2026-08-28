/**
 * Mutate Bodymovin transform keyframes on a Lottie composition.
 */

type AnimLike = Record<string, unknown>;

function asObj(v: unknown): AnimLike | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return v as AnimLike;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function cloneJson<T>(v: T): T {
  return structuredClone
    ? structuredClone(v)
    : (JSON.parse(JSON.stringify(v)) as T);
}

function isAnimated(prop: AnimLike | null): boolean {
  if (!prop) return false;
  return prop.a === 1 || prop.a === true || prop.a === '1';
}

function defaultValueForKey(key: string): number | number[] {
  switch (key) {
    case 'p':
      return [0, 0, 0];
    case 's':
      return [100, 100, 100];
    case 'a':
      return [0, 0, 0];
    case 'r':
    case 'sk':
    case 'sa':
      return 0;
    case 'o':
      return 100;
    default:
      return 0;
  }
}

function readStaticValue(prop: AnimLike | null, key: string): number | number[] {
  if (!prop) return defaultValueForKey(key);
  if (isAnimated(prop)) {
    const k = prop.k;
    if (!Array.isArray(k) || !k.length) return defaultValueForKey(key);
    const first = asObj(k[0]);
    if (first && 's' in first) {
      const s = first.s;
      if (Array.isArray(s)) return s.map((x) => num(x));
      return num(s);
    }
    // Some exports store numeric array directly when length-1.
    if (typeof k[0] === 'number') return k.map((x) => num(x));
    return defaultValueForKey(key);
  }
  const k = prop.k;
  if (Array.isArray(k)) return k.map((x) => num(x));
  return num(k, Number(defaultValueForKey(key)) || 0);
}

function sampleAnimatedValue(
  prop: AnimLike,
  frame: number,
  key: string
): number | number[] {
  const k = prop.k;
  if (!Array.isArray(k) || !k.length) return defaultValueForKey(key);
  const rows = k
    .map((item) => asObj(item))
    .filter(Boolean) as AnimLike[];
  if (!rows.length) return defaultValueForKey(key);

  const valueOf = (row: AnimLike): number | number[] => {
    if ('s' in row) {
      const s = row.s;
      if (Array.isArray(s)) return s.map((x) => num(x));
      return num(s);
    }
    return defaultValueForKey(key);
  };

  const lerp = (a: number | number[], b: number | number[], t: number) => {
    if (Array.isArray(a) || Array.isArray(b)) {
      const aa = Array.isArray(a) ? a : [num(a)];
      const bb = Array.isArray(b) ? b : [num(b)];
      const n = Math.max(aa.length, bb.length);
      return Array.from({ length: n }, (_, i) => {
        const av = num(aa[Math.min(i, aa.length - 1)]);
        const bv = num(bb[Math.min(i, bb.length - 1)]);
        return av + (bv - av) * t;
      });
    }
    return num(a) + (num(b) - num(a)) * t;
  };

  if (frame <= num(rows[0].t)) return valueOf(rows[0]);
  const last = rows[rows.length - 1];
  if (frame >= num(last.t)) return valueOf(last);
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    const ta = num(a.t);
    const tb = num(b.t);
    if (frame < ta || frame > tb) continue;
    if (a.h === 1 || a.h === true) return valueOf(a);
    const span = tb - ta;
    const t = span <= 1e-9 ? 0 : (frame - ta) / span;
    return lerp(valueOf(a), valueOf(b), Math.max(0, Math.min(1, t)));
  }
  return valueOf(last);
}

function frameNear(a: number, b: number, eps = 0.51): boolean {
  return Math.abs(a - b) <= eps;
}

function normalizeKeyframeList(
  rows: AnimLike[],
  key: string
): AnimLike {
  rows.sort((x, y) => num(x.t) - num(y.t));
  if (!rows.length) {
    return { a: 0, k: defaultValueForKey(key) };
  }
  if (rows.length === 1) {
    // Keep as animated single key so editors can add neighbors.
    return { a: 1, k: rows };
  }
  return { a: 1, k: rows };
}

function toKeyframeRows(prop: AnimLike | null, key: string): AnimLike[] {
  if (!prop) return [];
  if (!isAnimated(prop)) {
    return [{ t: 0, s: readStaticValue(prop, key) }];
  }
  const k = prop.k;
  if (!Array.isArray(k)) return [];
  const rows: AnimLike[] = [];
  for (const item of k) {
    const row = asObj(item);
    if (!row || !('t' in row)) continue;
    const next: AnimLike = { t: num(row.t) };
    if ('s' in row) next.s = row.s;
    else next.s = defaultValueForKey(key);
    if ('e' in row) next.e = row.e;
    if ('i' in row) next.i = row.i;
    if ('o' in row) next.o = row.o;
    if ('h' in row) next.h = row.h;
    rows.push(next);
  }
  return rows;
}

export function upsertTransformKeyframe(opts: {
  animationData: Record<string, unknown>;
  sceneKind: 'main' | 'precomp';
  assetId?: string;
  layerInd: number;
  propKey: string;
  frame: number;
  /** Explicit value (e.g. paste); otherwise samples/lerps at frame. */
  value?: number | number[];
}): Record<string, unknown> | null {
  const root = cloneJson(opts.animationData);
  const layers = resolveLayers(root, opts.sceneKind, opts.assetId);
  if (!layers) return null;
  const layer = layers.find((raw) => num(asObj(raw)?.ind) === opts.layerInd);
  const layerObj = asObj(layer);
  if (!layerObj) return null;
  const ks = asObj(layerObj.ks) || {};
  layerObj.ks = ks;
  const key = opts.propKey;
  const prop = asObj(ks[key]);
  const frame = Math.max(0, Math.round(opts.frame));
  const value =
    opts.value !== undefined
      ? opts.value
      : prop
        ? isAnimated(prop)
          ? sampleAnimatedValue(prop, frame, key)
          : readStaticValue(prop, key)
        : defaultValueForKey(key);
  let rows = toKeyframeRows(prop, key).filter((row) => !frameNear(num(row.t), frame));
  rows.push({ t: frame, s: value });
  ks[key] = normalizeKeyframeList(rows, key);
  return root;
}

export function removeTransformKeyframe(opts: {
  animationData: Record<string, unknown>;
  sceneKind: 'main' | 'precomp';
  assetId?: string;
  layerInd: number;
  propKey: string;
  frame: number;
}): Record<string, unknown> | null {
  const root = cloneJson(opts.animationData);
  const layers = resolveLayers(root, opts.sceneKind, opts.assetId);
  if (!layers) return null;
  const layer = layers.find((raw) => num(asObj(raw)?.ind) === opts.layerInd);
  const layerObj = asObj(layer);
  if (!layerObj) return null;
  const ks = asObj(layerObj.ks);
  if (!ks) return null;
  const key = opts.propKey;
  const prop = asObj(ks[key]);
  if (!prop || !isAnimated(prop)) return null;
  const frame = Math.max(0, opts.frame);
  const rows = toKeyframeRows(prop, key).filter((row) => !frameNear(num(row.t), frame));
  ks[key] = normalizeKeyframeList(rows, key);
  return root;
}

export function moveTransformKeyframe(opts: {
  animationData: Record<string, unknown>;
  sceneKind: 'main' | 'precomp';
  assetId?: string;
  layerInd: number;
  propKey: string;
  fromFrame: number;
  toFrame: number;
}): Record<string, unknown> | null {
  const root = cloneJson(opts.animationData);
  const layers = resolveLayers(root, opts.sceneKind, opts.assetId);
  if (!layers) return null;
  const layer = layers.find((raw) => num(asObj(raw)?.ind) === opts.layerInd);
  const layerObj = asObj(layer);
  if (!layerObj) return null;
  const ks = asObj(layerObj.ks);
  if (!ks) return null;
  const key = opts.propKey;
  const prop = asObj(ks[key]);
  if (!prop || !isAnimated(prop)) return null;
  const from = opts.fromFrame;
  const to = Math.max(0, Math.round(opts.toFrame));
  const rows = toKeyframeRows(prop, key);
  const idx = rows.findIndex((row) => frameNear(num(row.t), from));
  if (idx < 0) return null;
  const kept = rows.filter((_, i) => i !== idx && !frameNear(num(rows[i].t), to));
  kept.push({ ...rows[idx], t: to });
  ks[key] = normalizeKeyframeList(kept, key);
  return root;
}

function resolveLayers(
  root: AnimLike,
  sceneKind: 'main' | 'precomp',
  assetId?: string
): unknown[] | null {
  if (sceneKind === 'main') {
    if (!Array.isArray(root.layers)) return null;
    return root.layers as unknown[];
  }
  const id = String(assetId || '').trim();
  if (!id || !Array.isArray(root.assets)) return null;
  for (const raw of root.assets) {
    const asset = asObj(raw);
    if (!asset || String(asset.id || '') !== id) continue;
    if (!Array.isArray(asset.layers)) return null;
    return asset.layers as unknown[];
  }
  return null;
}

export function parsePropId(propId: string): { layerInd: number; propKey: string } | null {
  const idx = propId.indexOf(':');
  if (idx <= 0) return null;
  const layerInd = Number(propId.slice(0, idx));
  const propKey = propId.slice(idx + 1);
  if (!Number.isFinite(layerInd) || !propKey) return null;
  return { layerInd, propKey };
}

/** Rename a layer (`nm`) in the active composition. */
export function setLayerName(opts: {
  animationData: Record<string, unknown>;
  sceneKind: 'main' | 'precomp';
  assetId?: string;
  layerInd: number;
  name: string;
}): Record<string, unknown> | null {
  const root = cloneJson(opts.animationData);
  const layers = resolveLayers(root, opts.sceneKind, opts.assetId);
  if (!layers) return null;
  const layer = layers.find((raw) => num(asObj(raw)?.ind) === opts.layerInd);
  const layerObj = asObj(layer);
  if (!layerObj) return null;
  const next = String(opts.name || '').trim();
  if (next) layerObj.nm = next;
  return root;
}

/** Remove a layer by `ind` from the active composition. */
export function removeLayerByInd(opts: {
  animationData: Record<string, unknown>;
  sceneKind: 'main' | 'precomp';
  assetId?: string;
  layerInd: number;
}): Record<string, unknown> | null {
  const root = cloneJson(opts.animationData);
  const layers = resolveLayers(root, opts.sceneKind, opts.assetId);
  if (!layers) return null;
  const idx = layers.findIndex((raw) => num(asObj(raw)?.ind) === opts.layerInd);
  if (idx < 0) return null;
  layers.splice(idx, 1);
  return root;
}

/**
 * Reorder layers so `orderedInds` is top→bottom (first = first in Bodymovin array).
 * Layers not listed keep their relative order after the listed ones.
 */
export function reorderLayersByInd(opts: {
  animationData: Record<string, unknown>;
  sceneKind: 'main' | 'precomp';
  assetId?: string;
  orderedInds: number[];
}): Record<string, unknown> | null {
  const root = cloneJson(opts.animationData);
  const layers = resolveLayers(root, opts.sceneKind, opts.assetId);
  if (!layers) return null;
  const byInd = new Map<number, unknown>();
  for (const raw of layers) {
    const ind = num(asObj(raw)?.ind);
    if (Number.isFinite(ind)) byInd.set(ind, raw);
  }
  const next: unknown[] = [];
  const used = new Set<number>();
  for (const ind of opts.orderedInds) {
    const layer = byInd.get(ind);
    if (!layer || used.has(ind)) continue;
    next.push(layer);
    used.add(ind);
  }
  for (const raw of layers) {
    const ind = num(asObj(raw)?.ind);
    if (used.has(ind)) continue;
    next.push(raw);
  }
  layers.length = 0;
  for (const raw of next) layers.push(raw);
  return root;
}

/** Update a layer's in/out points (Bodymovin ip/op frames). */
export function setLayerTimeRange(opts: {
  animationData: Record<string, unknown>;
  sceneKind: 'main' | 'precomp';
  assetId?: string;
  layerInd: number;
  inFrame: number;
  outFrame: number;
}): Record<string, unknown> | null {
  const root = cloneJson(opts.animationData);
  const layers = resolveLayers(root, opts.sceneKind, opts.assetId);
  if (!layers) return null;
  const layer = layers.find((raw) => num(asObj(raw)?.ind) === opts.layerInd);
  const layerObj = asObj(layer);
  if (!layerObj) return null;
  const sceneOp =
    opts.sceneKind === 'main'
      ? Math.max(1, num(root.op, 60))
      : (() => {
          const assets = Array.isArray(root.assets) ? root.assets : [];
          const asset = assets
            .map((raw) => asObj(raw))
            .find((a) => a && String(a.id || '') === String(opts.assetId || ''));
          return Math.max(1, num(asset?.op, num(root.op, 60)));
        })();
  let ip = Math.max(0, Math.round(opts.inFrame));
  let op = Math.max(ip + 1, Math.round(opts.outFrame));
  ip = Math.min(ip, sceneOp - 1);
  op = Math.min(Math.max(op, ip + 1), sceneOp);
  layerObj.ip = ip;
  layerObj.op = op;
  // Keep start time aligned with in-point when present.
  if ('st' in layerObj) layerObj.st = ip;
  return root;
}

/** Update composition (or precomp) work area — Bodymovin ip/op frames. */
export function setCompWorkArea(opts: {
  animationData: Record<string, unknown>;
  sceneKind: 'main' | 'precomp';
  assetId?: string;
  inFrame: number;
  outFrame: number;
}): Record<string, unknown> | null {
  const root = cloneJson(opts.animationData);
  let ip = Math.max(0, Math.round(opts.inFrame));
  let op = Math.max(ip + 1, Math.round(opts.outFrame));
  if (opts.sceneKind === 'main') {
    root.ip = ip;
    root.op = op;
    return root;
  }
  const assets = Array.isArray(root.assets) ? root.assets : [];
  const asset = assets
    .map((raw) => asObj(raw))
    .find((a) => a && String(a.id || '') === String(opts.assetId || ''));
  if (!asset) return null;
  asset.ip = ip;
  asset.op = op;
  return root;
}

export type LottieEasingPreset = 'linear' | 'ease' | 'easeIn' | 'easeOut' | 'hold';

function valueDims(value: unknown): number {
  if (Array.isArray(value)) return Math.max(1, value.length);
  return 1;
}

function easingPair(
  preset: LottieEasingPreset,
  dims: number
): { out?: AnimLike; inn?: AnimLike; hold?: boolean } {
  const pack = (x: number, y: number) =>
    dims <= 1
      ? { x: [x], y: [y] }
      : { x: Array.from({ length: dims }, () => x), y: Array.from({ length: dims }, () => y) };
  switch (preset) {
    case 'hold':
      return { hold: true };
    case 'linear':
      return { out: pack(0, 0), inn: pack(1, 1) };
    case 'easeIn':
      return { out: pack(0.667, 0), inn: pack(1, 1) };
    case 'easeOut':
      return { out: pack(0, 0), inn: pack(0.333, 1) };
    case 'ease':
    default:
      return { out: pack(0.333, 0), inn: pack(0.667, 1) };
  }
}

/**
 * Apply easing on the segment starting at `frame` (this key → next key).
 * Hold marks the key as stepped (`h: 1`).
 */
export function setTransformKeyframeEasing(opts: {
  animationData: Record<string, unknown>;
  sceneKind: 'main' | 'precomp';
  assetId?: string;
  layerInd: number;
  propKey: string;
  frame: number;
  preset: LottieEasingPreset;
}): Record<string, unknown> | null {
  const root = cloneJson(opts.animationData);
  const layers = resolveLayers(root, opts.sceneKind, opts.assetId);
  if (!layers) return null;
  const layer = layers.find((raw) => num(asObj(raw)?.ind) === opts.layerInd);
  const layerObj = asObj(layer);
  if (!layerObj) return null;
  const ks = asObj(layerObj.ks);
  if (!ks) return null;
  const key = opts.propKey;
  const prop = asObj(ks[key]);
  if (!prop || !isAnimated(prop)) return null;
  const rows = toKeyframeRows(prop, key);
  const idx = rows.findIndex((row) => frameNear(num(row.t), opts.frame));
  if (idx < 0) return null;
  const dims = valueDims(rows[idx].s);
  const pair = easingPair(opts.preset, dims);
  const cur = { ...rows[idx] };
  if (pair.hold) {
    cur.h = 1;
    delete cur.i;
    delete cur.o;
  } else {
    delete cur.h;
    if (pair.out) cur.o = pair.out;
    const next = rows[idx + 1] ? { ...rows[idx + 1] } : null;
    if (next && pair.inn) {
      next.i = pair.inn;
      delete next.h;
      rows[idx + 1] = next;
    }
  }
  rows[idx] = cur;
  ks[key] = normalizeKeyframeList(rows, key);
  return root;
}

/** Overwrite the value (`s`) of an existing keyframe at `frame`. */
export function setTransformKeyframeValue(opts: {
  animationData: Record<string, unknown>;
  sceneKind: 'main' | 'precomp';
  assetId?: string;
  layerInd: number;
  propKey: string;
  frame: number;
  value: number | number[];
}): Record<string, unknown> | null {
  const root = cloneJson(opts.animationData);
  const layers = resolveLayers(root, opts.sceneKind, opts.assetId);
  if (!layers) return null;
  const layer = layers.find((raw) => num(asObj(raw)?.ind) === opts.layerInd);
  const layerObj = asObj(layer);
  if (!layerObj) return null;
  const ks = asObj(layerObj.ks);
  if (!ks) return null;
  const key = opts.propKey;
  const prop = asObj(ks[key]);
  if (!prop) return null;
  if (!isAnimated(prop)) {
    ks[key] = { a: 0, k: opts.value };
    return root;
  }
  const rows = toKeyframeRows(prop, key);
  const idx = rows.findIndex((row) => frameNear(num(row.t), opts.frame));
  if (idx < 0) return null;
  rows[idx] = { ...rows[idx], s: opts.value };
  ks[key] = normalizeKeyframeList(rows, key);
  return root;
}

/** Read keyframe payload for clipboard (value + optional hold). */
export function readTransformKeyframe(opts: {
  animationData: Record<string, unknown>;
  sceneKind: 'main' | 'precomp';
  assetId?: string;
  layerInd: number;
  propKey: string;
  frame: number;
}): { propKey: string; value: number | number[]; hold?: boolean } | null {
  const layers = resolveLayers(opts.animationData, opts.sceneKind, opts.assetId);
  if (!layers) return null;
  const layer = layers.find((raw) => num(asObj(raw)?.ind) === opts.layerInd);
  const layerObj = asObj(layer);
  if (!layerObj) return null;
  const ks = asObj(layerObj.ks);
  if (!ks) return null;
  const prop = asObj(ks[opts.propKey]);
  if (!prop) return null;
  if (!isAnimated(prop)) {
    return { propKey: opts.propKey, value: readStaticValue(prop, opts.propKey) };
  }
  const rows = toKeyframeRows(prop, opts.propKey);
  const row = rows.find((item) => frameNear(num(item.t), opts.frame));
  if (!row) return null;
  const value = Array.isArray(row.s)
    ? row.s.map((x) => num(x))
    : num(row.s, Number(defaultValueForKey(opts.propKey)) || 0);
  return {
    propKey: opts.propKey,
    value,
    hold: row.h === 1 || row.h === true,
  };
}
