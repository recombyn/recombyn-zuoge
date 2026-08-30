/**
 * Parse precomp asset layers into editable AABB shapes + position keyframes.
 */
import {
  parseLottieAnimationData,
  serializeLottieAnimationData,
} from '@/components/rcb/scene/document/nodeFactories';
import { scenePointToLottieLocal } from '@/components/editor/nodes/AnimationNode/animationComposeLayers';

export type PrecompEditPlate = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PrecompPositionKf = {
  frame: number;
  timeSec: number;
  x: number;
  y: number;
};

export type PrecompEditableLayer = {
  ind: number;
  name: string;
  /** Layer center in precomp local coords (from ks.p). */
  cx: number;
  cy: number;
  /** Shape size in local coords. */
  w: number;
  h: number;
  fill: string;
  cornerRadius: number;
  positionKfs: PrecompPositionKf[];
};

function asObj(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function readStaticVec(prop: unknown): number[] | null {
  const p = asObj(prop);
  if (!p) return null;
  const animated = p.a === 1 || p.a === true || p.a === '1';
  if (animated) {
    const k = p.k;
    if (!Array.isArray(k) || !k.length) return null;
    const first = asObj(k[0]);
    if (first && Array.isArray(first.s)) return first.s.map((x) => num(x));
    return null;
  }
  if (Array.isArray(p.k)) return p.k.map((x) => num(x));
  return null;
}

function readStaticNum(prop: unknown, fallback = 0): number {
  const p = asObj(prop);
  if (!p) return fallback;
  const animated = p.a === 1 || p.a === true || p.a === '1';
  if (animated) {
    const k = p.k;
    if (!Array.isArray(k) || !k.length) return fallback;
    const first = asObj(k[0]);
    if (first) {
      if (Array.isArray(first.s)) return num(first.s[0], fallback);
      return num(first.s, fallback);
    }
    return fallback;
  }
  if (Array.isArray(p.k)) return num(p.k[0], fallback);
  return num(p.k, fallback);
}

function rgbToHex(c: number[]): string {
  const r = Math.round(Math.max(0, Math.min(1, num(c[0]))) * 255);
  const g = Math.round(Math.max(0, Math.min(1, num(c[1]))) * 255);
  const b = Math.round(Math.max(0, Math.min(1, num(c[2]))) * 255);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function readFill(shapes: unknown[]): string {
  for (const raw of shapes) {
    const s = asObj(raw);
    if (!s || s.ty !== 'fl') continue;
    const c = readStaticVec(s.c);
    if (c && c.length >= 3) return rgbToHex(c);
  }
  return '#3B82F6';
}

function readRectSize(shapes: unknown[]): { w: number; h: number; r: number } | null {
  for (const raw of shapes) {
    const s = asObj(raw);
    if (!s) continue;
    if (s.ty === 'rc' || s.ty === 'el') {
      const size = readStaticVec(s.s);
      if (!size || size.length < 2) continue;
      return {
        w: Math.max(1, Math.abs(size[0])),
        h: Math.max(1, Math.abs(size[1])),
        r: s.ty === 'rc' ? Math.max(0, readStaticNum(s.r, 0)) : Math.max(size[0], size[1]) / 2,
      };
    }
  }
  // Fallback: path bbox estimate from first 'sh' if present — skip; use default box.
  return null;
}

function readPositionKfs(prop: unknown, fr: number): PrecompPositionKf[] {
  const p = asObj(prop);
  if (!p) return [];
  const fps = Math.max(1, fr);
  const animated = p.a === 1 || p.a === true || p.a === '1';
  if (!animated) {
    const v = readStaticVec(p);
    if (!v || v.length < 2) return [];
    return [{ frame: 0, timeSec: 0, x: v[0], y: v[1] }];
  }
  const k = p.k;
  if (!Array.isArray(k)) return [];
  const out: PrecompPositionKf[] = [];
  for (const row of k) {
    const r = asObj(row);
    if (!r || !Array.isArray(r.s) || r.s.length < 2) continue;
    const frame = Math.round(num(r.t));
    out.push({
      frame,
      timeSec: frame / fps,
      x: num(r.s[0]),
      y: num(r.s[1]),
    });
  }
  return out;
}

/** Linear sample of position keyframes at a timeline second (hold at ends). */
export function samplePositionAtTime(
  kfs: PrecompPositionKf[],
  timeSec: number
): { x: number; y: number } | null {
  if (!kfs.length) return null;
  if (kfs.length === 1) return { x: kfs[0].x, y: kfs[0].y };
  const sorted = [...kfs].sort((a, b) => a.timeSec - b.timeSec || a.frame - b.frame);
  const t = Number.isFinite(timeSec) ? timeSec : 0;
  if (t <= sorted[0].timeSec) return { x: sorted[0].x, y: sorted[0].y };
  const last = sorted[sorted.length - 1];
  if (t >= last.timeSec) return { x: last.x, y: last.y };
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t < a.timeSec || t > b.timeSec) continue;
    const span = Math.max(1e-6, b.timeSec - a.timeSec);
    const u = (t - a.timeSec) / span;
    return {
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
    };
  }
  return { x: sorted[0].x, y: sorted[0].y };
}

/** Inverse of scenePointToLottieLocal (FIT / contain). */
export function lottieLocalToScenePoint(
  localX: number,
  localY: number,
  plate: PrecompEditPlate,
  animW: number,
  animH: number
): { x: number; y: number } {
  const aw = Math.max(1, animW);
  const ah = Math.max(1, animH);
  const scale = Math.min(plate.width / aw, plate.height / ah);
  const contentW = aw * scale;
  const contentH = ah * scale;
  const ox = plate.left + (plate.width - contentW) / 2;
  const oy = plate.top + (plate.height - contentH) / 2;
  return {
    x: ox + localX * scale,
    y: oy + localY * scale,
  };
}

export function scenePointToPrecompLocal(
  sceneX: number,
  sceneY: number,
  plate: PrecompEditPlate,
  animW: number,
  animH: number
): { x: number; y: number } {
  return scenePointToLottieLocal(sceneX, sceneY, plate, animW, animH);
}

export function resolvePrecompAsset(
  hostAnimationData: unknown,
  assetId: string
): {
  root: Record<string, unknown>;
  asset: Record<string, unknown>;
  layers: unknown[];
  w: number;
  h: number;
  fr: number;
} | null {
  const root = parseLottieAnimationData(hostAnimationData);
  if (!root) return null;
  const id = String(assetId || '').trim();
  if (!id) return null;
  const assets = Array.isArray(root.assets) ? root.assets : [];
  const asset = assets.find((a) => String(asObj(a)?.id || '') === id);
  const assetObj = asObj(asset);
  if (!assetObj || !Array.isArray(assetObj.layers)) return null;
  return {
    root,
    asset: assetObj,
    layers: assetObj.layers as unknown[],
    w: Math.max(1, num(assetObj.w, num(root.w, 100))),
    h: Math.max(1, num(assetObj.h, num(root.h, 100))),
    fr: Math.max(1, num(assetObj.fr, num(root.fr, 30))),
  };
}

export function parsePrecompEditableLayers(
  hostAnimationData: unknown,
  assetId: string
): PrecompEditableLayer[] {
  const resolved = resolvePrecompAsset(hostAnimationData, assetId);
  if (!resolved) return [];
  const { layers, fr } = resolved;
  const out: PrecompEditableLayer[] = [];
  for (const raw of layers) {
    const layer = asObj(raw);
    if (!layer) continue;
    // Shape layers only (ty 4).
    if (num(layer.ty, -1) !== 4) continue;
    const ind = num(layer.ind);
    if (!(ind > 0)) continue;
    const shapes = Array.isArray(layer.shapes) ? (layer.shapes as unknown[]) : [];
    const size = readRectSize(shapes) || { w: 80, h: 80, r: 0 };
    const ks = asObj(layer.ks);
    const p = readStaticVec(ks?.p) || [size.w / 2, size.h / 2, 0];
    out.push({
      ind,
      name: String(layer.nm || `Layer ${ind}`).trim() || `Layer ${ind}`,
      cx: p[0],
      cy: p[1],
      w: size.w,
      h: size.h,
      fill: readFill(shapes),
      cornerRadius: size.r,
      positionKfs: readPositionKfs(ks?.p, fr),
    });
  }
  return out;
}

export function linkedLotNodeIdFromAsset(assetId: string): string | null {
  const id = String(assetId || '').trim();
  if (!id.startsWith('lot_')) return null;
  const nodeId = id.slice(4);
  return nodeId || null;
}

/** Patch layer center + size inside a precomp asset; returns new host animation JSON. */
export function patchPrecompLayerGeometry(opts: {
  hostAnimationData: unknown;
  assetId: string;
  layerInd: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
}): string | null {
  const resolved = resolvePrecompAsset(opts.hostAnimationData, opts.assetId);
  if (!resolved) return null;
  const root = structuredClone
    ? structuredClone(resolved.root)
    : (JSON.parse(JSON.stringify(resolved.root)) as Record<string, unknown>);
  const assets = Array.isArray(root.assets) ? (root.assets as Record<string, unknown>[]) : [];
  const asset = assets.find((a) => String(a?.id || '') === opts.assetId);
  if (!asset || !Array.isArray(asset.layers)) return null;
  const layers = asset.layers as Record<string, unknown>[];
  const layer = layers.find((l) => num(l?.ind) === opts.layerInd);
  if (!layer) return null;
  const ks = asObj(layer.ks) || {};
  const pProp = asObj(ks.p);
  if (pProp && (pProp.a === 1 || pProp.a === true || pProp.a === '1')) {
    // Keep keyframes; shift all by delta from first/current static sample.
    // Simpler: set static center when dragging the rect body (clears anim on p).
    ks.p = { a: 0, k: [opts.cx, opts.cy, 0] };
  } else {
    ks.p = { a: 0, k: [opts.cx, opts.cy, 0] };
  }
  layer.ks = ks;
  const shapes = Array.isArray(layer.shapes) ? [...(layer.shapes as unknown[])] : [];
  layer.shapes = shapes.map((raw) => {
    const s = asObj(raw);
    if (!s) return raw;
    if (s.ty !== 'rc' && s.ty !== 'el') return raw;
    return {
      ...s,
      s: { a: 0, k: [Math.max(1, opts.w), Math.max(1, opts.h)] },
    };
  });
  return serializeLottieAnimationData(root);
}

/** Move a single position keyframe in a precomp layer. */
export function patchPrecompPositionKeyframe(opts: {
  hostAnimationData: unknown;
  assetId: string;
  layerInd: number;
  frame: number;
  x: number;
  y: number;
}): string | null {
  const resolved = resolvePrecompAsset(opts.hostAnimationData, opts.assetId);
  if (!resolved) return null;
  const root = structuredClone
    ? structuredClone(resolved.root)
    : (JSON.parse(JSON.stringify(resolved.root)) as Record<string, unknown>);
  const assets = Array.isArray(root.assets) ? (root.assets as Record<string, unknown>[]) : [];
  const asset = assets.find((a) => String(a?.id || '') === opts.assetId);
  if (!asset || !Array.isArray(asset.layers)) return null;
  const layer = (asset.layers as Record<string, unknown>[]).find(
    (l) => num(l?.ind) === opts.layerInd
  );
  if (!layer) return null;
  const ks = asObj(layer.ks) || {};
  const pProp = asObj(ks.p);
  if (!pProp) {
    ks.p = { a: 0, k: [opts.x, opts.y, 0] };
    layer.ks = ks;
    return serializeLottieAnimationData(root);
  }
  const animated = pProp.a === 1 || pProp.a === true || pProp.a === '1';
  if (!animated) {
    ks.p = { a: 0, k: [opts.x, opts.y, 0] };
    layer.ks = ks;
    return serializeLottieAnimationData(root);
  }
  const rows = Array.isArray(pProp.k) ? [...(pProp.k as unknown[])] : [];
  let hit = false;
  for (let i = 0; i < rows.length; i += 1) {
    const row = asObj(rows[i]);
    if (!row) continue;
    if (Math.abs(num(row.t) - opts.frame) > 0.51) continue;
    const s = Array.isArray(row.s) ? [...row.s] : [opts.x, opts.y, 0];
    s[0] = opts.x;
    s[1] = opts.y;
    if (s.length < 3) s[2] = 0;
    rows[i] = { ...row, s };
    hit = true;
    break;
  }
  if (!hit) return null;
  ks.p = { ...pProp, a: 1, k: rows };
  layer.ks = ks;
  return serializeLottieAnimationData(root);
}

/** Extract nested lot node's own animation JSON from host asset (for sync). */
export function extractPrecompAssetJson(
  hostAnimationData: unknown,
  assetId: string
): string | null {
  const resolved = resolvePrecompAsset(hostAnimationData, assetId);
  if (!resolved) return null;
  const { asset, fr } = resolved;
  const standalone = {
    v: '5.7.4',
    fr,
    ip: num(asset.ip, 0),
    op: Math.max(1, num(asset.op, fr * 2)),
    w: resolved.w,
    h: resolved.h,
    nm: String(asset.nm || assetId),
    ddd: 0,
    assets: Array.isArray(asset.assets) ? asset.assets : [],
    layers: asset.layers,
  };
  return serializeLottieAnimationData(standalone);
}
