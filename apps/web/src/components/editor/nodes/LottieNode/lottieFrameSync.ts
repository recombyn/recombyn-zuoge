/**
 * Sync Lottie 合成台 scene children (shapes / images) into the host's
 * Bodymovin `animationData` so the timeline can list layers + keyframes.
 */
import {
  createBlankLottieAnimation,
  sceneBoxToLottieLocal,
  type LottieLocalBox,
} from '@/components/editor/nodes/LottieNode/lottieComposeLayers';
import { isLottieFrameHostNode } from '@/components/rcb/scene/document/nodeCapabilities';
import {
  parseLottieAnimationData,
  serializeLottieAnimationData,
} from '@/components/rcb/scene/document/nodeFactories';
import type { SceneDocument, SceneNode } from '@/components/rcb/sceneNode';

const LINK_KEY = 'ln'; // custom: scene node id on a synced layer

/** Prefer clipboard helper; fall back to scanning deltaSetLike (partial docs / tests). */
function listNodesBoundToFrame(document: SceneDocument, frameId: string): string[] {
  const wanted = String(frameId || '').trim();
  if (!wanted) return [];
  const ids: string[] = [];
  const map = document.deltaSetLike || {};
  for (const id of Object.keys(map)) {
    if (id === 'ROOT') continue;
    const node = map[id];
    if (!node || typeof node !== 'object') continue;
    if (String(node.attrs?.frameId || '').trim() !== wanted) continue;
    ids.push(id);
  }
  return ids;
}

function nextLayerIndex(layers: unknown[]): number {
  let max = 0;
  for (const raw of layers) {
    if (!raw || typeof raw !== 'object') continue;
    const ind = Number((raw as { ind?: unknown }).ind);
    if (Number.isFinite(ind) && ind > max) max = ind;
  }
  return max + 1;
}

function isAnimatedProp(prop: unknown): boolean {
  if (!prop || typeof prop !== 'object') return false;
  const p = prop as { a?: unknown; k?: unknown };
  if (Number(p.a) === 1) return true;
  const k = p.k;
  return Array.isArray(k) && k.length > 0 && typeof k[0] === 'object' && k[0] != null && 't' in (k[0] as object);
}

function layerHasKeyframes(ks: unknown): boolean {
  if (!ks || typeof ks !== 'object') return false;
  const o = ks as Record<string, unknown>;
  return ['p', 's', 'r', 'o', 'a', 'sk', 'sa'].some((k) => isAnimatedProp(o[k]));
}

function parseCssColorToRgb01(raw: unknown): [number, number, number] {
  const s = String(raw || '').trim();
  if (!s || s === 'transparent' || s.startsWith('var(')) return [0.23, 0.51, 0.96];
  const hex = s.replace('#', '');
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const r = parseInt(hex[0]! + hex[0]!, 16) / 255;
    const g = parseInt(hex[1]! + hex[1]!, 16) / 255;
    const b = parseInt(hex[2]! + hex[2]!, 16) / 255;
    return [r, g, b];
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    return [r, g, b];
  }
  const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (m) {
    return [
      Math.max(0, Math.min(1, Number(m[1]) / 255)),
      Math.max(0, Math.min(1, Number(m[2]) / 255)),
      Math.max(0, Math.min(1, Number(m[3]) / 255)),
    ];
  }
  return [0.23, 0.51, 0.96];
}

function nodeOpacityPercent(node: SceneNode): number {
  const raw = node.attrs?.opacity ?? node.attrs?.['fill-opacity'];
  const n = Number(raw);
  if (!Number.isFinite(n)) return 100;
  if (n <= 1) return Math.round(Math.max(0, Math.min(1, n)) * 100);
  return Math.round(Math.max(0, Math.min(100, n)));
}

function nodeAngleDeg(node: SceneNode): number {
  const n = Number(node.attrs?.angle);
  return Number.isFinite(n) ? n : 0;
}

function solidFill(rgb: [number, number, number]) {
  return {
    ty: 'fl',
    c: { a: 0, k: [...rgb, 1] },
    o: { a: 0, k: 100 },
    r: 1,
    bm: 0,
    nm: 'Fill',
  };
}

function baseTransform(
  cx: number,
  cy: number,
  ax: number,
  ay: number,
  angle: number,
  opacity: number,
  skew = 0,
  skewAxis = 0
) {
  return {
    o: { a: 0, k: opacity },
    r: { a: 0, k: angle },
    p: { a: 0, k: [cx, cy, 0] },
    a: { a: 0, k: [ax, ay, 0] },
    s: { a: 0, k: [100, 100, 100] },
    sk: { a: 0, k: skew },
    sa: { a: 0, k: skewAxis },
  };
}

function applyStaticTransform(
  layer: Record<string, unknown>,
  cx: number,
  cy: number,
  ax: number,
  ay: number,
  angle: number,
  opacity: number,
  skew = 0,
  skewAxis = 0
) {
  const ks = (layer.ks && typeof layer.ks === 'object' ? { ...(layer.ks as object) } : {}) as Record<
    string,
    unknown
  >;
  if (layerHasKeyframes(ks)) {
    // Keep authored keyframes; only refresh name/link metadata elsewhere.
    layer.ks = ks;
    return;
  }
  layer.ks = baseTransform(cx, cy, ax, ay, angle, opacity, skew, skewAxis);
}

/** Rive-style 3×3 anchor → local [ax, ay] for image layers (top-left origin). */
export type LottieAnchorPreset =
  | 'tl'
  | 'tm'
  | 'tr'
  | 'ml'
  | 'mm'
  | 'mr'
  | 'bl'
  | 'bm'
  | 'br';

export function parseAnchorPreset(raw: unknown): LottieAnchorPreset {
  const v = String(raw || '').trim().toLowerCase();
  if (
    v === 'tl' ||
    v === 'tm' ||
    v === 'tr' ||
    v === 'ml' ||
    v === 'mm' ||
    v === 'mr' ||
    v === 'bl' ||
    v === 'bm' ||
    v === 'br'
  ) {
    return v;
  }
  return 'mm';
}

export function anchorPresetToFrac(preset: LottieAnchorPreset): { fx: number; fy: number } {
  const col = preset.endsWith('l') ? 0 : preset.endsWith('r') ? 1 : 0.5;
  const row = preset.startsWith('t') ? 0 : preset.startsWith('b') ? 1 : 0.5;
  return { fx: col, fy: row };
}

function nodeSkewDeg(node: SceneNode): number {
  const n = Number(node.attrs?.skewX ?? node.attrs?.skew);
  return Number.isFinite(n) ? n : 0;
}

function nodeSkewAxisDeg(node: SceneNode): number {
  const n = Number(node.attrs?.skewAxis ?? node.attrs?.skewY);
  return Number.isFinite(n) ? n : 0;
}

function nodeCornerRadius(node: SceneNode): number {
  const n = Number(node.attrs?.cornerRadius);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function makeRectLayer(opts: {
  ind: number;
  name: string;
  nodeId: string;
  box: LottieLocalBox;
  rgb: [number, number, number];
  angle: number;
  opacity: number;
  op: number;
  ellipse?: boolean;
  cornerRadius?: number;
  skew?: number;
  skewAxis?: number;
  ax?: number;
  ay?: number;
}): Record<string, unknown> {
  const cx = opts.box.x + opts.box.w / 2;
  const cy = opts.box.y + opts.box.h / 2;
  const ax = opts.ax ?? 0;
  const ay = opts.ay ?? 0;
  return {
    ddd: 0,
    ind: opts.ind,
    ty: 4,
    nm: opts.name,
    [LINK_KEY]: opts.nodeId,
    sr: 1,
    ks: baseTransform(
      cx,
      cy,
      ax,
      ay,
      opts.angle,
      opts.opacity,
      opts.skew || 0,
      opts.skewAxis || 0
    ),
    ao: 0,
    shapes: [
      opts.ellipse
        ? {
            ty: 'el',
            d: 1,
            s: { a: 0, k: [opts.box.w, opts.box.h] },
            p: { a: 0, k: [0, 0] },
            nm: 'Ellipse Path',
          }
        : {
            ty: 'rc',
            d: 1,
            s: { a: 0, k: [opts.box.w, opts.box.h] },
            p: { a: 0, k: [0, 0] },
            r: { a: 0, k: Math.max(0, opts.cornerRadius || 0) },
            nm: 'Rectangle Path',
          },
      solidFill(opts.rgb),
    ],
    ip: 0,
    op: opts.op,
    st: 0,
    bm: 0,
  };
}

function makeImageLayer(opts: {
  ind: number;
  name: string;
  nodeId: string;
  box: LottieLocalBox;
  assetId: string;
  angle: number;
  opacity: number;
  op: number;
  skew?: number;
  skewAxis?: number;
  ax?: number;
  ay?: number;
}): Record<string, unknown> {
  const ax = opts.ax ?? opts.box.w / 2;
  const ay = opts.ay ?? opts.box.h / 2;
  const cx = opts.box.x + ax;
  const cy = opts.box.y + ay;
  return {
    ddd: 0,
    ind: opts.ind,
    ty: 2,
    refId: opts.assetId,
    nm: opts.name,
    [LINK_KEY]: opts.nodeId,
    sr: 1,
    ks: baseTransform(
      cx,
      cy,
      ax,
      ay,
      opts.angle,
      opts.opacity,
      opts.skew || 0,
      opts.skewAxis || 0
    ),
    ao: 0,
    w: Math.max(1, Math.round(opts.box.w)),
    h: Math.max(1, Math.round(opts.box.h)),
    ip: 0,
    op: opts.op,
    st: 0,
    bm: 0,
  };
}

function isSyncableChild(node: SceneNode | null | undefined, document: SceneDocument): boolean {
  if (!node) return false;
  if (isLottieFrameHostNode(node, document)) return false;
  if (node.key === 'lottie') return false;
  if (node.key === 'video' || node.key === 'audio') return false;
  if (node.key === 'image') return Boolean(String(node.attrs?.src || '').trim());
  if (node.key === 'shape' || node.key === 'rect') return true;
  // Generators / text still sync as named placeholders via rect approx when they have size
  if (node.key === 'text') return true;
  return false;
}

function shapeIsEllipse(node: SceneNode): boolean {
  const t = String(node.attrs?.shapeType || '').toLowerCase();
  return t === 'circle' || t === 'ellipse';
}

/** Resolve layer in/out: scene attrs > previous layer > short default (~2s), never full-span by default. */
function resolveSyncedLayerTrim(
  node: SceneNode,
  prev: Record<string, unknown> | undefined,
  compOp: number,
  fps: number
): { ip: number; op: number; writeAttrs: boolean } {
  const attrIp = Number(node.attrs?.lottieInFrame);
  const attrOp = Number(node.attrs?.lottieOutFrame);
  if (Number.isFinite(attrIp) && Number.isFinite(attrOp) && attrOp > attrIp) {
    return {
      ip: Math.max(0, Math.round(attrIp)),
      op: Math.max(Math.round(attrIp) + 1, Math.round(attrOp)),
      writeAttrs: false,
    };
  }
  const keepIp = Number(prev?.ip);
  const keepOp = Number(prev?.op);
  if (Number.isFinite(keepIp) && Number.isFinite(keepOp) && keepOp > keepIp) {
    return { ip: keepIp, op: keepOp, writeAttrs: false };
  }
  const span = Math.max(1, Math.round(Math.max(1, fps) * 2));
  return { ip: 0, op: Math.min(Math.max(1, compOp), span), writeAttrs: true };
}

export type LottieFrameSyncResult = {
  animationJson: string;
  /** Scene nodes that need attrs patched (layer index + optional trim). */
  childAttrPatches: Array<{
    nodeId: string;
    lottieLayerInd: number;
    lottieInFrame?: number;
    lottieOutFrame?: number;
  }>;
};

/**
 * Rebuild / update host animation layers from 合成台 children.
 * Preserves transform keyframes on already-linked layers.
 */
export function syncArtboardChildrenIntoAnimation(
  document: SceneDocument,
  frameId: string,
  hostId: string
): LottieFrameSyncResult | null {
  const frames = Array.isArray(document.frames) ? document.frames : [];
  const frame = frames.find((f) => String(f?.id) === frameId);
  const host = document.deltaSetLike?.[hostId];
  if (!frame || !host || host.key !== 'lottie') return null;

  const plate = {
    left: Number(frame.x) || 0,
    top: Number(frame.y) || 0,
    width: Math.max(1, Number(frame.width) || 1),
    height: Math.max(1, Number(frame.height) || 1),
  };

  const existing = parseLottieAnimationData(host.attrs?.animationData);
  const fps = Math.max(1, Math.round(Number(frame.fps) || Number(existing?.fr) || 30));
  const durationSec = Math.max(
    0.5,
    Number(frame.durationSec) ||
      (existing ? (Number(existing.op) - Number(existing.ip || 0)) / fps : 5)
  );
  let anim: Record<string, unknown> =
    existing && Array.isArray(existing.layers)
      ? { ...existing, w: plate.width, h: plate.height, fr: fps }
      : createBlankLottieAnimation({
          width: plate.width,
          height: plate.height,
          durationSec,
          fps,
        });

  // Keep duration at least frame duration (don't shrink authored op if longer).
  const minOp = Math.max(1, Math.round(durationSec * fps));
  const curOp = Math.max(1, Number(anim.op) || minOp);
  anim = { ...anim, op: Math.max(curOp, minOp), ip: Number(anim.ip) || 0 };

  const boundIds = listNodesBoundToFrame(document, frameId);
  const children = boundIds
    .map((id) => ({ id, node: document.deltaSetLike?.[id] as SceneNode | undefined }))
    .filter(({ node }) => isSyncableChild(node, document))
    .sort((a, b) => {
      const ao = Number(a.node?.attrs?.frameOrder);
      const bo = Number(b.node?.attrs?.frameOrder);
      return (Number.isFinite(ao) ? ao : 0) - (Number.isFinite(bo) ? bo : 0);
    });

  const prevLayers = Array.isArray(anim.layers) ? (anim.layers as Record<string, unknown>[]) : [];
  const prevByNode = new Map<string, Record<string, unknown>>();
  const keepUnlinked: Record<string, unknown>[] = [];
  for (const layer of prevLayers) {
    const ln = String(layer?.[LINK_KEY] || '').trim();
    if (ln) prevByNode.set(ln, layer);
    else keepUnlinked.push(layer);
  }

  const prevAssets = Array.isArray(anim.assets) ? [...(anim.assets as unknown[])] : [];
  const assetsById = new Map<string, Record<string, unknown>>();
  for (const raw of prevAssets) {
    if (!raw || typeof raw !== 'object') continue;
    const id = String((raw as { id?: unknown }).id || '').trim();
    if (id) assetsById.set(id, { ...(raw as object) } as Record<string, unknown>);
  }

  const animW = Math.max(1, Number(anim.w) || plate.width);
  const animH = Math.max(1, Number(anim.h) || plate.height);
  const op = Math.max(1, Number(anim.op) || minOp);
  const nextLayers: Record<string, unknown>[] = [...keepUnlinked];
  const childAttrPatches: LottieFrameSyncResult['childAttrPatches'] = [];
  const usedAssetIds = new Set<string>();

  // Lottie draws top-of-array first visually as topmost in many players when listed reverse;
  // our timeline lists layers as in JSON — keep higher frameOrder later in array (bottom = back).
  for (const { id: nodeId, node } of children) {
    if (!node) continue;
    const box = sceneBoxToLottieLocal(
      {
        x: Number(node.x) || 0,
        y: Number(node.y) || 0,
        w: Math.max(1, Number(node.width) || 1),
        h: Math.max(1, Number(node.height) || 1),
      },
      plate,
      animW,
      animH
    );
    const name = String(node.attrs?.name || node.key || 'Layer').trim() || 'Layer';
    const angle = nodeAngleDeg(node);
    const opacity = nodeOpacityPercent(node);
    const skew = nodeSkewDeg(node);
    const skewAxis = nodeSkewAxisDeg(node);
    const cornerRadius = nodeCornerRadius(node);
    const anchor = parseAnchorPreset(node.attrs?.anchorPreset);
    const { fx, fy } = anchorPresetToFrac(anchor);
    const prev = prevByNode.get(nodeId);
    let ind = Number(prev?.ind);
    if (!Number.isFinite(ind) || ind <= 0) {
      ind = nextLayerIndex([...keepUnlinked, ...nextLayers, ...Array.from(prevByNode.values())]);
    }

    if (node.key === 'image') {
      const src = String(node.attrs?.src || '').trim();
      const assetId = `img_${nodeId}`;
      usedAssetIds.add(assetId);
      assetsById.set(assetId, {
        id: assetId,
        w: Math.max(1, Math.round(box.w)),
        h: Math.max(1, Math.round(box.h)),
        u: '',
        p: src,
        e: 1,
      });
      const ax = box.w * fx;
      const ay = box.h * fy;
      let layer =
        prev && Number(prev.ty) === 2
          ? { ...prev, nm: name, [LINK_KEY]: nodeId, refId: assetId, w: Math.round(box.w), h: Math.round(box.h) }
          : makeImageLayer({
              ind,
              name,
              nodeId,
              box,
              assetId,
              angle,
              opacity,
              op,
              skew,
              skewAxis,
              ax,
              ay,
            });
      if (!layer.ind) layer.ind = ind;
      applyStaticTransform(
        layer,
        box.x + ax,
        box.y + ay,
        ax,
        ay,
        angle,
        opacity,
        skew,
        skewAxis
      );
      {
        const trim = resolveSyncedLayerTrim(node, prev, op, fps);
        layer.ip = trim.ip;
        layer.op = trim.op;
        childAttrPatches.push({
          nodeId,
          lottieLayerInd: Number(layer.ind) || ind,
          ...(trim.writeAttrs
            ? { lottieInFrame: trim.ip, lottieOutFrame: trim.op }
            : {}),
        });
      }
      nextLayers.unshift(layer);
      continue;
    }

    const rgb = parseCssColorToRgb01(node.attrs?.['fill-color'] || node.attrs?.fill);
    const ellipse = shapeIsEllipse(node);
    // Shape paths are centered at layer origin; offset anchor relative to center.
    const shapeAx = (fx - 0.5) * box.w;
    const shapeAy = (fy - 0.5) * box.h;
    let layer =
      prev && Number(prev.ty) === 4
        ? { ...prev, nm: name, [LINK_KEY]: nodeId }
        : makeRectLayer({
            ind,
            name,
            nodeId,
            box,
            rgb,
            angle,
            opacity,
            op,
            ellipse,
            cornerRadius,
            skew,
            skewAxis,
            ax: shapeAx,
            ay: shapeAy,
          });
    if (!layer.ind) layer.ind = ind;
    // Refresh shape geometry + fill when static.
    if (!layerHasKeyframes(layer.ks)) {
      layer = makeRectLayer({
        ind: Number(layer.ind) || ind,
        name,
        nodeId,
        box,
        rgb,
        angle,
        opacity,
        op,
        ellipse,
        cornerRadius,
        skew,
        skewAxis,
        ax: shapeAx,
        ay: shapeAy,
      });
    } else {
      applyStaticTransform(
        layer,
        box.x + box.w / 2,
        box.y + box.h / 2,
        shapeAx,
        shapeAy,
        angle,
        opacity,
        skew,
        skewAxis
      );
    }
    {
      const trim = resolveSyncedLayerTrim(node, prev, op, fps);
      layer.ip = trim.ip;
      layer.op = trim.op;
      childAttrPatches.push({
        nodeId,
        lottieLayerInd: Number(layer.ind) || ind,
        ...(trim.writeAttrs
          ? { lottieInFrame: trim.ip, lottieOutFrame: trim.op }
          : {}),
      });
    }
    nextLayers.unshift(layer);
  }

  // Drop orphan image assets that belonged to removed synced layers.
  const nextAssets: unknown[] = [];
  for (const [id, asset] of assetsById) {
    if (id.startsWith('img_') && !usedAssetIds.has(id)) continue;
    nextAssets.push(asset);
  }
  // Keep non-img assets from imports.
  for (const raw of prevAssets) {
    if (!raw || typeof raw !== 'object') continue;
    const id = String((raw as { id?: unknown }).id || '').trim();
    if (!id || id.startsWith('img_')) continue;
    if (nextAssets.some((a) => a && typeof a === 'object' && String((a as { id?: unknown }).id) === id)) {
      continue;
    }
    nextAssets.push(raw);
  }

  anim = { ...anim, layers: nextLayers, assets: nextAssets };
  const animationJson = serializeLottieAnimationData(anim);
  if (!animationJson) return null;
  return { animationJson, childAttrPatches };
}
