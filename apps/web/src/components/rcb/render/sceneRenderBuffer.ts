/**
 * SceneRenderBuffer — SoA paint/pick sidecar (ADR 0027 Phase 3+).
 *
 * SceneDocument remains the authoring/collab source of truth. This buffer holds
 * contiguous typed arrays for lightweight geometry so Canvas can paint and
 * spatial pick without one SVG host per node.
 */
import type { SceneDocument, SceneNodeInput } from '@/components/rcb/sceneNode';
import {
  isFrameLocalCoordSpace,
  nodeLeftTop,
} from '@/components/rcb/scene/paint/sceneToSvg';
import { isNodeOverlayHidden } from '@/components/rcb/scene/document/nodeCapabilities';
import {
  clampCornerRadii,
  radiiFromAttrs,
} from '@/components/rcb/scene/document/sceneRadii';
import {
  resolveStroke,
  resolveStrokeAlign,
  boolEffectAttr,
} from '@/components/rcb/scene/document/sceneEffects';
import {
  ellipseArcPercentFromAttrs,
  ellipseInnerRatioFromAttrs,
  HEAVY_PATH_D_CHARS,
  shapeVertexPoints,
  starInnerRatioFromAttrs,
} from '@/components/rcb/scene/document/sceneShapes';
import { getShapeBaseline } from '@/components/rcb/core/geometry/baseline';
import { getShapeHost } from '@/components/rcb/shapes/shapeHostRegistry';
import {
  pathDLooksClosed,
  sampleSoaPathPolyline,
  SOA_PATH_MAX_PTS,
} from '@/components/rcb/render/soaPathSamples';
import { getNodeTransformPreview } from '@/components/rcb/core/transformPreview';
import {
  getLiveCornerRadiusPreviewNodeId,
  getLiveCornerRadiusPreviewRadii,
} from '@/components/rcb/scene/document/sceneRadii';
import {
  findClippingFrameForNode,
  frameClipRevealsOverflow,
} from '@/components/rcb/frames/frameContentClip';
import { stackZIndex } from '@/components/rcb/scene/document/sceneDocument';

export const SOA_FLAG_VISIBLE = 1 << 0;
export const SOA_FLAG_LOCKED = 1 << 1;
export const SOA_FLAG_DIRTY = 1 << 2;
/** Eligible for Canvas-only paint (no SVG host unless promoted). */
export const SOA_FLAG_CANVAS_IDLE = 1 << 3;
/** Geometry is SoA-basic (solid fill/roundRect/ellipse/line/path/poly + center stroke). */
export const SOA_FLAG_BASIC_GEOM = 1 << 4;

export const SOA_KIND_RECT = 0;
export const SOA_KIND_ELLIPSE = 1;
export const SOA_KIND_LINE = 2;
export const SOA_KIND_PATH = 3;
export const SOA_KIND_IMAGE = 4;
export const SOA_KIND_POLY = 5;
export const SOA_KIND_OTHER = 15;
/** Fallback line/path width when attrs omit border-width (matches prior Canvas/WebGL default). */
export const SOA_DEFAULT_STROKE_WIDTH = 2;

const GROW = 1024;
const POS_STRIDE = 4; // x, y, w, h
const RAD_STRIDE = 4; // tl, tr, br, bl

/** Last document seen by SoA paint — used when resolveSoaPaintBox omits `doc`. */
let soaPaintDocument: SceneDocument | null = null;

/** Keep SoA paint/hit frame-local aware during plate drag (live artboard geom). */
export function setSoaPaintDocument(doc: SceneDocument | null | undefined): void {
  soaPaintDocument = doc ?? null;
}

export function getSoaPaintDocument(): SceneDocument | null {
  return soaPaintDocument;
}

/** Lightweight SoA paint/pick eligibility — shapes only (not media/text hosts). */
export function isSoaCanvasEligible(node: SceneNodeInput | null | undefined): boolean {
  if (!node) return false;
  const key = String(node.key || '');
  if (key === 'lottie' || key === 'audio' || key === 'group' || key === 'text') return false;
  // Image/video stay on SVG/HTML hosts — never SoA canvas ink.
  if (key === 'image' || key === 'video') return false;
  const t = String(node.attrs?.shapeType || (key === 'shape' ? 'rect' : key) || '').toLowerCase();
  if (t === 'rect' || t === 'roundrect' || t === '' || key === 'shape') return true;
  if (t === 'circle' || t === 'ellipse' || t === 'oval') return true;
  if (t === 'line' || t === 'arrow') return true;
  if (t === 'pen' || t === 'pencil' || t === 'path' || key === 'path') return true;
  // Poly/star stay eligible for buffer/spatial, but never BASIC_GEOM (rich idle / SVG).
  if (t === 'triangle' || t === 'polygon' || t === 'star') return true;
  return false;
}

function isTransparentCssColor(c: string): boolean {
  const s = String(c || '')
    .trim()
    .toLowerCase();
  return !s || s === 'none' || s === 'transparent' || s === 'rgba(0,0,0,0)';
}

function pathAttrsHaveSolidFill(attrs: Record<string, unknown>): boolean {
  if (!boolEffectAttr(attrs['fill-enabled'], true)) return false;
  if (!boolEffectAttr(attrs['fill-visible'], true)) return false;
  const fill = attrs.fill ?? attrs['fill-color'] ?? attrs.fillColor;
  return !isTransparentCssColor(String(fill || ''));
}

/** True when VITE_SOA_WEBGL_ATLAS is explicitly disabled (default-on with WebGL). */
function isSoaWebglAtlasEnvOff(): boolean {
  try {
    const v = String(import.meta.env.VITE_SOA_WEBGL_ATLAS ?? '').toLowerCase();
    return v === '0' || v === 'false' || v === 'no';
  } catch {
    return false;
  }
}

/**
 * True when {@link paintSoaBufferBasic} can draw the node faithfully.
 * Gradient / non-center strokeAlign / text / media / rotation / flip stay off
 * BASIC_GEOM (rich canvas ink or DOM hosts).
 * Solid rounded rects, center outline stroke, and simple poly/star are OK on the
 * Canvas2D SoA path. WebGL instances still lack outline+poly, so those stay off
 * BASIC_GEOM while `VITE_SOA_WEBGL` is on.
 * Line/path ink *is* the stroke (not an outline on a fill).
 */
export function isSoaBasicGeomSufficient(node: SceneNodeInput | null | undefined): boolean {
  if (!node || !isSoaCanvasEligible(node)) return false;
  const attrs = node.attrs || {};
  if (Math.abs(Number(attrs.angle) || 0) > 0.5) return false;
  // Flip needs SVG / rich idle transform — basic SoA fill has no scale(-1).
  if (attrs.flipX === true || attrs.flipX === 'true') return false;
  if (attrs.flipY === true || attrs.flipY === 'true') return false;

  const fillType = String(attrs['fill-type'] || 'solid').toLowerCase();
  if (fillType && fillType !== 'solid' && fillType !== '') return false;

  const key = String(node.key || '');
  const t = String(attrs.shapeType || (key === 'shape' ? 'rect' : key) || '').toLowerCase();
  const webgl = isSoaWebglEnvEnabled();
  // Line/path ink *is* the stroke — outline stroke on filled shapes is separate.
  const strokeInk =
    t === 'line' ||
    t === 'arrow' ||
    t === 'pen' ||
    t === 'pencil' ||
    t === 'path' ||
    key === 'path';
  if (!strokeInk) {
    const stroke = resolveStroke(node);
    if ((Number(stroke.strokeWidth) || 0) > 0 && !isTransparentCssColor(String(stroke.stroke || ''))) {
      // Canvas2D SoA only paints center-aligned outlines.
      if (resolveStrokeAlign(attrs) !== 'center') return false;
      // WebGL instance path has no outline stroke — keep SVG hosts.
      if (webgl) return false;
    }
  }

  if (t === 'rect' || t === 'roundrect' || t === '') return true;
  if (t === 'circle' || t === 'ellipse' || t === 'oval') {
    if (ellipseInnerRatioFromAttrs(attrs) > 1e-6) return false;
    const arc = ellipseArcPercentFromAttrs(attrs);
    if (arc > 0 && arc < 100 - 1e-6) return false;
    return true;
  }
  if (t === 'line' || t === 'arrow') return true;
  if (t === 'triangle' || t === 'polygon' || t === 'star') {
    // WebGL pack skips SOA_KIND_POLY — Canvas2D SoA only.
    if (webgl) return false;
    return true;
  }
  if (t === 'pen' || t === 'pencil' || t === 'path' || key === 'path') {
    const d = String(attrs.path || '').trim();
    if (!d || d.length >= HEAVY_PATH_D_CHARS) return false;
    // Boolean compounds / holes need Path2D + evenodd — SoA polyline fill is nonzero-only.
    const fillRule = String(attrs['fill-rule'] || '').toLowerCase();
    if (fillRule === 'evenodd') return false;
    if (attrs.outlined === true || attrs.outlined === 'true') return false;
    // Closed fill needs atlas stamps; without atlas keep SVG (segment batch is stroke-only).
    if (
      webgl &&
      isSoaWebglAtlasEnvOff() &&
      pathDLooksClosed(d, attrs.closed) &&
      pathAttrsHaveSolidFill(attrs)
    ) {
      return false;
    }
    return true;
  }
  return false;
}

export type SceneRenderBuffer = {
  capacity: number;
  count: number;
  /** [x,y,w,h] * capacity */
  positions: Float32Array;
  /** [tl,tr,br,bl] * capacity — scene units; 0 = sharp */
  radii: Float32Array;
  colors: Uint32Array;
  flags: Uint32Array;
  /** Low 8 bits unused; kind in bits 8–11 via helpers. */
  kinds: Uint8Array;
  /** Per-slot stroke width in scene units (line/path/outline). 0 = unused. */
  strokeWidths: Float32Array;
  /** Outline stroke ARGB for rect/ellipse/poly (0 = no outline). Line/path ink uses `colors`. */
  strokeColors: Uint32Array;
  ids: string[];
  indexById: Map<string, number>;
  /** Generation bumped on any structural sync. */
  revision: number;
  /** Per-slot start point index into pathXY (−1 = no samples). */
  pathStart: Int32Array;
  /** Per-slot vertex count. */
  pathLen: Uint16Array;
  /** 1 = closed (may fill). */
  pathClosed: Uint8Array;
  /** Shared world-space samples [x,y,x,y,…]. */
  pathXY: Float32Array;
  /** Number of floats currently used in pathXY. */
  pathXYCount: number;
};

/** Test-only override; `null` = use env / Vitest defaults. */
let soaCanvasShapesOverride: boolean | null = null;

/** Force SoA canvas shapes on/off in unit tests and benches (`null` clears). */
export function setSoaCanvasShapesEnabledForTests(value: boolean | null) {
  soaCanvasShapesOverride = value;
}

export function isSoaCanvasShapesEnabled(): boolean {
  if (soaCanvasShapesOverride != null) return soaCanvasShapesOverride;
  try {
    // Vitest: off unless setSoaCanvasShapesEnabledForTests(true).
    if (import.meta.env.MODE === 'test' || import.meta.env.VITEST) return false;
    const env = String(import.meta.env.VITE_SOA_CANVAS_SHAPES ?? '').toLowerCase();
    if (env === '0' || env === 'false' || env === 'no') return false;
    if (env === '1' || env === 'true' || env === 'yes') return true;
    return true;
  } catch {
    return true;
  }
}

/** WebGL ink env (no circular import of webglSceneRenderer). */
export function isSoaWebglEnvEnabled(): boolean {
  try {
    if (import.meta.env.MODE === 'test' || import.meta.env.VITEST) return false;
    const env = String(import.meta.env.VITE_SOA_WEBGL ?? '').toLowerCase();
    return env === '1' || env === 'true' || env === 'yes';
  } catch {
    return false;
  }
}

/** Line/path stroke width stored in the SoA buffer (scene units). */
export function soaStrokeWidth(buf: SceneRenderBuffer, index: number): number {
  const w = buf.strokeWidths[index];
  if (Number.isFinite(w) && w > 0) return w;
  return SOA_DEFAULT_STROKE_WIDTH;
}

function slotStrokeWidth(node: SceneNodeInput, kind: number): number {
  if (kind === SOA_KIND_LINE || kind === SOA_KIND_PATH) {
    const { strokeWidth } = resolveStroke(node, '#333333');
    if (Number.isFinite(strokeWidth) && strokeWidth > 0) return strokeWidth;
    return SOA_DEFAULT_STROKE_WIDTH;
  }
  if (kind === SOA_KIND_RECT || kind === SOA_KIND_ELLIPSE || kind === SOA_KIND_POLY) {
    if (resolveStrokeAlign(node.attrs) !== 'center') return 0;
    const { stroke, strokeWidth } = resolveStroke(node);
    if (!(strokeWidth > 0) || isTransparentCssColor(String(stroke || ''))) return 0;
    return strokeWidth;
  }
  return 0;
}

function slotOutlineStrokeColor(node: SceneNodeInput, kind: number): number {
  // PATH: stroke lives here so closed unfilled pens stay stroke-only (colors=0).
  if (kind === SOA_KIND_PATH) {
    const { stroke, strokeWidth } = resolveStroke(node, '#333333');
    if (!(strokeWidth > 0) || isTransparentCssColor(String(stroke || ''))) return 0;
    return packCssColor(stroke, 0xff333333);
  }
  if (kind !== SOA_KIND_RECT && kind !== SOA_KIND_ELLIPSE && kind !== SOA_KIND_POLY) return 0;
  if (resolveStrokeAlign(node.attrs) !== 'center') return 0;
  const { stroke, strokeWidth } = resolveStroke(node);
  if (!(strokeWidth > 0) || isTransparentCssColor(String(stroke || ''))) return 0;
  return packCssColor(stroke, 0xff333333);
}

export function createSceneRenderBuffer(initialCapacity = GROW): SceneRenderBuffer {
  const capacity = Math.max(GROW, initialCapacity);
  return {
    capacity,
    count: 0,
    positions: new Float32Array(capacity * POS_STRIDE),
    radii: new Float32Array(capacity * RAD_STRIDE),
    colors: new Uint32Array(capacity),
    flags: new Uint32Array(capacity),
    kinds: new Uint8Array(capacity),
    strokeWidths: new Float32Array(capacity),
    strokeColors: new Uint32Array(capacity),
    ids: new Array(capacity),
    indexById: new Map(),
    revision: 0,
    pathStart: new Int32Array(capacity).fill(-1),
    pathLen: new Uint16Array(capacity),
    pathClosed: new Uint8Array(capacity),
    pathXY: new Float32Array(0),
    pathXYCount: 0,
  };
}

function ensureCapacity(buf: SceneRenderBuffer, need: number) {
  if (need <= buf.capacity) return;
  let next = buf.capacity;
  while (next < need) next += GROW;
  const positions = new Float32Array(next * POS_STRIDE);
  positions.set(buf.positions);
  const radii = new Float32Array(next * RAD_STRIDE);
  radii.set(buf.radii);
  const colors = new Uint32Array(next);
  colors.set(buf.colors);
  const flags = new Uint32Array(next);
  flags.set(buf.flags);
  const kinds = new Uint8Array(next);
  kinds.set(buf.kinds);
  const strokeWidths = new Float32Array(next);
  strokeWidths.set(buf.strokeWidths);
  const strokeColors = new Uint32Array(next);
  strokeColors.set(buf.strokeColors);
  const ids = new Array(next);
  for (let i = 0; i < buf.count; i += 1) ids[i] = buf.ids[i];
  const pathStart = new Int32Array(next).fill(-1);
  pathStart.set(buf.pathStart);
  const pathLen = new Uint16Array(next);
  pathLen.set(buf.pathLen);
  const pathClosed = new Uint8Array(next);
  pathClosed.set(buf.pathClosed);
  buf.capacity = next;
  buf.positions = positions;
  buf.radii = radii;
  buf.colors = colors;
  buf.flags = flags;
  buf.kinds = kinds;
  buf.strokeWidths = strokeWidths;
  buf.strokeColors = strokeColors;
  buf.ids = ids;
  buf.pathStart = pathStart;
  buf.pathLen = pathLen;
  buf.pathClosed = pathClosed;
}

function ensurePathXYCapacity(buf: SceneRenderBuffer, floatNeed: number) {
  if (floatNeed <= buf.pathXY.length) return;
  let next = Math.max(256, buf.pathXY.length || 256);
  while (next < floatNeed) next *= 2;
  const xy = new Float32Array(next);
  if (buf.pathXYCount > 0) xy.set(buf.pathXY.subarray(0, buf.pathXYCount));
  buf.pathXY = xy;
}

/** Pack #RRGGBB or #RRGGBBAA (approx) into opaque ARGB uint32. */
export function packCssColor(raw: unknown, fallback = 0xff808080): number {
  const s = String(raw || '').trim();
  if (isTransparentCssColor(s)) return 0;
  if (!s) return fallback;
  const hex = s.startsWith('#') ? s.slice(1) : '';
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const rgb = parseInt(hex, 16) >>> 0;
    return (0xff000000 | rgb) >>> 0;
  }
  if (/^[0-9a-fA-F]{8}$/.test(hex)) {
    // RRGGBBAA → ARGB
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = parseInt(hex.slice(6, 8), 16);
    return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
  }
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
  }
  return fallback;
}

export function unpackCssColor(argb: number): string {
  const a = (argb >>> 24) & 0xff;
  const r = (argb >>> 16) & 0xff;
  const g = (argb >>> 8) & 0xff;
  const b = argb & 0xff;
  if (a >= 255) {
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  }
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

function shapeKindOf(node: SceneNodeInput): number {
  const key = String(node.key || '');
  if (key === 'image' || key === 'video') return SOA_KIND_IMAGE;
  const t = String(node.attrs?.shapeType || (key === 'shape' ? 'rect' : key) || '').toLowerCase();
  if (t === 'circle' || t === 'ellipse' || t === 'oval') return SOA_KIND_ELLIPSE;
  if (t === 'line' || t === 'arrow') return SOA_KIND_LINE;
  if (t === 'pen' || t === 'pencil' || t === 'path' || key === 'path') return SOA_KIND_PATH;
  if (t === 'triangle' || t === 'polygon' || t === 'star') return SOA_KIND_POLY;
  if (t === 'rect' || t === 'roundrect' || t === '' || key === 'shape') return SOA_KIND_RECT;
  return SOA_KIND_OTHER;
}

function fillColorOf(node: SceneNodeInput): number {
  const attrs = node.attrs || {};
  const fill = attrs.fill ?? attrs['fill-color'] ?? attrs.fillColor;
  return packCssColor(fill, 0xffc0c0c0);
}

/**
 * Slot fill color. For PATH: only closed + solid fill (0 = stroke-only —
 * paint must not fill with the stroke color when fill is transparent).
 */
function slotColorOf(node: SceneNodeInput): number {
  const kind = shapeKindOf(node);
  const attrs = node.attrs || {};
  if (kind === SOA_KIND_LINE) {
    const stroke =
      attrs.stroke ?? attrs['stroke-color'] ?? attrs.strokeColor ?? attrs.fill ?? attrs['fill-color'];
    return packCssColor(stroke, 0xff333333);
  }
  if (kind === SOA_KIND_PATH) {
    const d = String(attrs.path || '');
    const closed = pathDLooksClosed(d, attrs.closed);
    if (closed && pathAttrsHaveSolidFill(attrs)) {
      const fill = attrs.fill ?? attrs['fill-color'] ?? attrs.fillColor;
      return packCssColor(fill, 0xffc0c0c0);
    }
    return 0;
  }
  return fillColorOf(node);
}

function writeSlot(
  buf: SceneRenderBuffer,
  index: number,
  id: string,
  node: SceneNodeInput,
  document: SceneDocument | null | undefined
) {
  const { left, top } = nodeLeftTop(document, node);
  const o = index * POS_STRIDE;
  buf.positions[o] = Number(left) || 0;
  buf.positions[o + 1] = Number(top) || 0;
  buf.positions[o + 2] = Math.max(0.01, Number(node.width) || 1);
  buf.positions[o + 3] = Math.max(0.01, Number(node.height) || 1);
  const w = buf.positions[o + 2];
  const h = buf.positions[o + 3];
  const kind = shapeKindOf(node) & 0xff;
  const ro = index * RAD_STRIDE;
  if (kind === SOA_KIND_RECT) {
    const r = clampCornerRadii(radiiFromAttrs(node.attrs || {}), w, h);
    buf.radii[ro] = r.tl;
    buf.radii[ro + 1] = r.tr;
    buf.radii[ro + 2] = r.br;
    buf.radii[ro + 3] = r.bl;
  } else {
    buf.radii[ro] = 0;
    buf.radii[ro + 1] = 0;
    buf.radii[ro + 2] = 0;
    buf.radii[ro + 3] = 0;
  }
  buf.colors[index] = slotColorOf(node);
  buf.kinds[index] = kind;
  buf.strokeWidths[index] = slotStrokeWidth(node, kind);
  buf.strokeColors[index] = slotOutlineStrokeColor(node, kind) >>> 0;
  let flags = SOA_FLAG_DIRTY;
  if (!isNodeOverlayHidden(document, node)) flags |= SOA_FLAG_VISIBLE;
  if (Boolean(node.attrs?.locked)) flags |= SOA_FLAG_LOCKED;
  // BASIC_GEOM → SoA canvas ink. Text / media / non-basic stay off this flag.
  if (isSoaBasicGeomSufficient(node)) {
    flags |= SOA_FLAG_BASIC_GEOM | SOA_FLAG_CANVAS_IDLE;
  }
  buf.flags[index] = flags >>> 0;
  buf.ids[index] = id;
  buf.indexById.set(id, index);
  buf.pathStart[index] = -1;
  buf.pathLen[index] = 0;
  buf.pathClosed[index] = 0;
}

/**
 * Rebuild world-space path / poly polylines after slot sync.
 * Call after full or incremental document sync.
 */
export function rebuildSoaPathSamples(
  buf: SceneRenderBuffer,
  document: SceneDocument | null | undefined
) {
  for (let i = 0; i < buf.count; i += 1) {
    buf.pathStart[i] = -1;
    buf.pathLen[i] = 0;
    buf.pathClosed[i] = 0;
  }
  buf.pathXYCount = 0;
  if (!document?.deltaSetLike) return;

  let floatNeed = 0;
  const pending: Array<{
    index: number;
    pts: Array<{ x: number; y: number }>;
    closed: boolean;
  }> = [];
  for (let i = 0; i < buf.count; i += 1) {
    const kind = buf.kinds[i];
    const id = buf.ids[i];
    const node = id ? document.deltaSetLike[id] : null;
    if (!node) continue;
    if (kind === SOA_KIND_PATH) {
      const d = String(node.attrs?.path || '');
      const pts = sampleSoaPathPolyline(d, SOA_PATH_MAX_PTS);
      if (pts.length < 2) continue;
      pending.push({
        index: i,
        pts,
        closed: pathDLooksClosed(d, node.attrs?.closed),
      });
      floatNeed += pts.length * 2;
      continue;
    }
    if (kind === SOA_KIND_POLY) {
      const t = String(node.attrs?.shapeType || '').toLowerCase();
      const w = Math.max(0.01, buf.positions[i * POS_STRIDE + 2]);
      const h = Math.max(0.01, buf.positions[i * POS_STRIDE + 3]);
      const baseline = getShapeBaseline(
        {
          key: 'shape',
          width: w,
          height: h,
          attrs: { ...(node.attrs || {}), shapeType: t },
        } as SceneNodeInput,
        { width: w, height: h }
      );
      const d = String(baseline?.d || '').trim();
      if (!d) continue;
      const pts = sampleSoaPathPolyline(d, SOA_PATH_MAX_PTS);
      if (pts.length < 2) continue;
      pending.push({
        index: i,
        pts,
        closed: baseline?.closed !== false,
      });
      floatNeed += pts.length * 2;
      continue;
    }
  }
  ensurePathXYCapacity(buf, floatNeed);
  let cursor = 0;
  for (const item of pending) {
    const pointStart = cursor >> 1;
    const ox = buf.positions[item.index * POS_STRIDE];
    const oy = buf.positions[item.index * POS_STRIDE + 1];
    for (const p of item.pts) {
      buf.pathXY[cursor] = ox + p.x;
      buf.pathXY[cursor + 1] = oy + p.y;
      cursor += 2;
    }
    buf.pathStart[item.index] = pointStart;
    buf.pathLen[item.index] = item.pts.length;
    buf.pathClosed[item.index] = item.closed ? 1 : 0;
  }
  buf.pathXYCount = cursor;
}

/**
 * Full rebuild from document ROOT children (skip ROOT itself).
 * Prefer {@link syncSceneRenderBufferIncremental} after small patches.
 */
export function syncSceneRenderBufferFromDocument(
  buf: SceneRenderBuffer,
  document: SceneDocument | null | undefined
): SceneRenderBuffer {
  buf.indexById.clear();
  buf.count = 0;
  if (!document?.deltaSetLike) {
    buf.revision += 1;
    return buf;
  }
  const rootKids = document.deltaSetLike.ROOT?.children;
  const ids = Array.isArray(rootKids)
    ? rootKids.map(String).filter((id) => id && id !== 'ROOT')
    : Object.keys(document.deltaSetLike).filter((id) => id !== 'ROOT');
  ensureCapacity(buf, ids.length);
  let n = 0;
  for (const id of ids) {
    const node = document.deltaSetLike[id];
    if (!node) continue;
    writeSlot(buf, n, id, node, document);
    n += 1;
  }
  buf.count = n;
  buf.revision += 1;
  rebuildSoaPathSamples(buf, document);
  return buf;
}

/**
 * Reconcile SOA_FLAG_VISIBLE with overlay hide gates (workbench focus, precomp, …).
 * Document did not change — only module focus flags did — so incremental sync skips this.
 */
export function refreshSoaOverlayVisibilityFromDocument(
  buf: SceneRenderBuffer,
  document: SceneDocument | null | undefined
): number {
  if (!document?.deltaSetLike) return 0;
  let changed = 0;
  for (let i = 0; i < buf.count; i += 1) {
    const id = buf.ids[i];
    if (!id) continue;
    const node = document.deltaSetLike[id];
    if (!node) continue;
    const wantVisible = !isNodeOverlayHidden(document, node);
    const hasVisible = (buf.flags[i] & SOA_FLAG_VISIBLE) !== 0;
    if (wantVisible === hasVisible) continue;
    let flags = buf.flags[i];
    if (wantVisible) flags = (flags | SOA_FLAG_VISIBLE) >>> 0;
    else flags = (flags & ~SOA_FLAG_VISIBLE) >>> 0;
    buf.flags[i] = (flags | SOA_FLAG_DIRTY) >>> 0;
    changed += 1;
  }
  if (changed > 0) buf.revision += 1;
  return changed;
}

/** Patch existing slots or append; remove ids not listed when `removeMissing` is set. */
export function syncSceneRenderBufferIncremental(
  buf: SceneRenderBuffer,
  document: SceneDocument | null | undefined,
  patchedIds: readonly string[],
  opts?: { removeMissing?: boolean; allIds?: readonly string[] }
): SceneRenderBuffer {
  if (!document?.deltaSetLike) return syncSceneRenderBufferFromDocument(buf, document);
  for (const raw of patchedIds) {
    const id = String(raw || '');
    if (!id || id === 'ROOT') continue;
    const node = document.deltaSetLike[id];
    const existing = buf.indexById.get(id);
    if (!node) {
      if (existing != null) removeSlot(buf, existing);
      continue;
    }
    if (existing != null) {
      writeSlot(buf, existing, id, node, document);
    } else {
      ensureCapacity(buf, buf.count + 1);
      writeSlot(buf, buf.count, id, node, document);
      buf.count += 1;
    }
  }
  if (opts?.removeMissing && opts.allIds) {
    const keep = new Set(opts.allIds.map(String));
    for (let i = buf.count - 1; i >= 0; i -= 1) {
      const id = buf.ids[i];
      if (id && !keep.has(id)) removeSlot(buf, i);
    }
  }
  buf.revision += 1;
  rebuildSoaPathSamples(buf, document);
  return buf;
}

function removeSlot(buf: SceneRenderBuffer, index: number) {
  const last = buf.count - 1;
  const id = buf.ids[index];
  if (id) buf.indexById.delete(id);
  if (index !== last && last >= 0) {
    const o = index * POS_STRIDE;
    const lo = last * POS_STRIDE;
    buf.positions[o] = buf.positions[lo];
    buf.positions[o + 1] = buf.positions[lo + 1];
    buf.positions[o + 2] = buf.positions[lo + 2];
    buf.positions[o + 3] = buf.positions[lo + 3];
    const ro = index * RAD_STRIDE;
    const rlo = last * RAD_STRIDE;
    buf.radii[ro] = buf.radii[rlo];
    buf.radii[ro + 1] = buf.radii[rlo + 1];
    buf.radii[ro + 2] = buf.radii[rlo + 2];
    buf.radii[ro + 3] = buf.radii[rlo + 3];
    buf.colors[index] = buf.colors[last];
    buf.flags[index] = buf.flags[last];
    buf.kinds[index] = buf.kinds[last];
    buf.strokeWidths[index] = buf.strokeWidths[last];
    buf.strokeColors[index] = buf.strokeColors[last];
    buf.ids[index] = buf.ids[last];
    buf.pathStart[index] = buf.pathStart[last];
    buf.pathLen[index] = buf.pathLen[last];
    buf.pathClosed[index] = buf.pathClosed[last];
    const movedId = buf.ids[index];
    if (movedId) buf.indexById.set(movedId, index);
  }
  buf.count = Math.max(0, last);
}

export function getSoaBox(
  buf: SceneRenderBuffer,
  index: number
): { x: number; y: number; w: number; h: number } | null {
  if (index < 0 || index >= buf.count) return null;
  return resolveSoaPaintBox(buf, index);
}

/**
 * SoA slot box for paint/hit — gesture TransformPreview overrides document
 * positions (same contract as effectivePaintBox for SVG hosts).
 * Frame-local children re-read `nodeLeftTop` so a plate drag (live frame geom)
 * moves ink without rewriting every child x/y.
 */
export function resolveSoaPaintBox(
  buf: SceneRenderBuffer,
  index: number,
  doc?: SceneDocument | null
): { x: number; y: number; w: number; h: number; dx: number; dy: number } {
  const o = index * POS_STRIDE;
  let x = buf.positions[o];
  let y = buf.positions[o + 1];
  let w = buf.positions[o + 2];
  let h = buf.positions[o + 3];
  const baseX = x;
  const baseY = y;
  const id = buf.ids[index];
  const paintDoc = doc ?? soaPaintDocument;
  if (id && paintDoc && isFrameLocalCoordSpace(paintDoc)) {
    const node = paintDoc.deltaSetLike?.[id];
    if (node && String(node.attrs?.frameId || '').trim()) {
      const { left, top } = nodeLeftTop(paintDoc, node);
      x = left;
      y = top;
    }
  }
  if (id) {
    const preview = getNodeTransformPreview(id);
    if (preview) {
      if (Number.isFinite(preview.left)) x = preview.left;
      if (Number.isFinite(preview.top)) y = preview.top;
      if (Number.isFinite(preview.width)) w = Math.max(0.01, preview.width);
      if (Number.isFinite(preview.height)) h = Math.max(0.01, preview.height);
    }
  }
  return { x, y, w, h, dx: x - baseX, dy: y - baseY };
}

/**
 * Map a scene point into the slot's local box (origin top-left), undoing the
 * same center-rotate TransformPreview paint uses.
 */
export function soaPointToLocalBox(
  px: number,
  py: number,
  left: number,
  top: number,
  w: number,
  h: number,
  angleDeg: number
): { lx: number; ly: number } {
  const cx = left + w / 2;
  const cy = top + h / 2;
  let dx = px - cx;
  let dy = py - cy;
  if (Math.abs(angleDeg) > 0.5) {
    const rad = (-angleDeg * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const rx = dx * c - dy * s;
    const ry = dx * s + dy * c;
    dx = rx;
    dy = ry;
  }
  return { lx: dx + w / 2, ly: dy + h / 2 };
}

function soaLiveAngleDeg(nodeId: string | undefined): number {
  if (!nodeId) return 0;
  const a = getNodeTransformPreview(nodeId)?.angle;
  if (!Number.isFinite(a) || Math.abs(Number(a)) <= 0.5) return 0;
  return Number(a);
}

/** Local-space rounded rect hit (matches {@link fillSoaRoundedRect}). */
export function hitSoaRoundedRectLocal(
  lx: number,
  ly: number,
  w: number,
  h: number,
  tl: number,
  tr: number,
  br: number,
  bl: number
): boolean {
  if (lx < 0 || ly < 0 || lx >= w || ly >= h) return false;
  if (tl > 0 && lx < tl && ly < tl) {
    const dx = lx - tl;
    const dy = ly - tl;
    return dx * dx + dy * dy <= tl * tl;
  }
  if (tr > 0 && lx > w - tr && ly < tr) {
    const dx = lx - (w - tr);
    const dy = ly - tr;
    return dx * dx + dy * dy <= tr * tr;
  }
  if (br > 0 && lx > w - br && ly > h - br) {
    const dx = lx - (w - br);
    const dy = ly - (h - br);
    return dx * dx + dy * dy <= br * br;
  }
  if (bl > 0 && lx < bl && ly > h - bl) {
    const dx = lx - bl;
    const dy = ly - (h - bl);
    return dx * dx + dy * dy <= bl * bl;
  }
  return true;
}

/** Even-odd ray cast for a densified SoA polyline (closed fill). */
export function hitSoaPolylineFill(
  xy: Float32Array,
  startPoint: number,
  pointCount: number,
  odx: number,
  ody: number,
  px: number,
  py: number
): boolean {
  if (pointCount < 3) return false;
  const base = startPoint * 2;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let p = 0; p < pointCount; p += 1) {
    const fo = base + p * 2;
    const x = xy[fo] + odx;
    const y = xy[fo + 1] + ody;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    xs.push(x);
    ys.push(y);
  }
  const n = xs.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = xs[i];
    const yi = ys[i];
    const xj = xs[j];
    const yj = ys[j];
    const cross = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (cross) inside = !inside;
  }
  return inside;
}

function distPointToSeg(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-8) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Point hit against a single SoA slot (scene units). */
export function hitTestSoaSlot(
  buf: SceneRenderBuffer,
  index: number,
  x: number,
  y: number
): boolean {
  if (index < 0 || index >= buf.count) return false;
  const flags = buf.flags[index];
  if (!(flags & SOA_FLAG_VISIBLE)) return false;
  if (flags & SOA_FLAG_LOCKED) return false;
  const id = buf.ids[index];
  if (id && getNodeTransformPreview(id)?.hidden) return false;
  const { x: left, y: top, w, h, dx: odx, dy: ody } = resolveSoaPaintBox(buf, index);
  const kind = buf.kinds[index];
  const angle = soaLiveAngleDeg(id);

  if (kind === SOA_KIND_LINE) {
    const pickR = Math.max(2, soaStrokeWidth(buf, index) * 0.5 + 1);
    return distPointToSeg(x, y, left, top, left + w, top + h) <= pickR;
  }

  if (kind === SOA_KIND_PATH || kind === SOA_KIND_POLY) {
    const start = buf.pathStart[index];
    const len = buf.pathLen[index];
    if (start < 0 || len < 2) {
      const { lx, ly } = soaPointToLocalBox(x, y, left, top, w, h, angle);
      return lx >= 0 && lx < w && ly >= 0 && ly < h;
    }
    const thresh = Math.max(2, soaStrokeWidth(buf, index) * 0.5 + 1);
    const base = start * 2;
    let last = -1;
    for (let p = 0; p < len; p += 1) {
      const fo = base + p * 2;
      const px = buf.pathXY[fo] + odx;
      const py = buf.pathXY[fo + 1] + ody;
      if (!Number.isFinite(px) || !Number.isFinite(py)) {
        last = -1;
        continue;
      }
      if (last >= 0) {
        const ax = buf.pathXY[last] + odx;
        const ay = buf.pathXY[last + 1] + ody;
        if (distPointToSeg(x, y, ax, ay, px, py) <= thresh) return true;
      }
      last = fo;
    }
    if (buf.pathClosed[index]) {
      // Close the ring for stroke hit.
      if (len >= 2) {
        const fo0 = base;
        const foN = base + (len - 1) * 2;
        const ax = buf.pathXY[foN] + odx;
        const ay = buf.pathXY[foN + 1] + ody;
        const bx = buf.pathXY[fo0] + odx;
        const by = buf.pathXY[fo0 + 1] + ody;
        if (distPointToSeg(x, y, ax, ay, bx, by) <= thresh) return true;
      }
      // Interior hit only when the path has a solid fill (colors ≠ 0).
      if (buf.colors[index]) {
        return hitSoaPolylineFill(buf.pathXY, start, len, odx, ody, x, y);
      }
    }
    return false;
  }

  const { lx, ly } = soaPointToLocalBox(x, y, left, top, w, h, angle);
  if (kind === SOA_KIND_ELLIPSE) {
    const rx = w / 2;
    const ry = h / 2;
    if (rx <= 0 || ry <= 0) return false;
    const nx = (lx - rx) / rx;
    const ny = (ly - ry) / ry;
    return nx * nx + ny * ny <= 1;
  }

  // RECT (sharp or rounded)
  const ro = index * RAD_STRIDE;
  const tl = buf.radii[ro] || 0;
  const tr = buf.radii[ro + 1] || 0;
  const br = buf.radii[ro + 2] || 0;
  const bl = buf.radii[ro + 3] || 0;
  if (tl > 0.5 || tr > 0.5 || br > 0.5 || bl > 0.5) {
    return hitSoaRoundedRectLocal(lx, ly, w, h, tl, tr, br, bl);
  }
  return lx >= 0 && lx < w && ly >= 0 && ly < h;
}

/**
 * Hit test SoA slots in paint order (topmost first via `order`).
 * Only canvas-ink slots are considered — DOM hosts stay off this path.
 */
export function hitTestSoaBufferOrdered(
  buf: SceneRenderBuffer,
  x: number,
  y: number,
  order: readonly string[]
): string | null {
  for (const id of order) {
    const i = buf.indexById.get(id);
    if (i == null) continue;
    if (!(buf.flags[i] & SOA_FLAG_CANVAS_IDLE)) continue;
    if (hitTestSoaSlot(buf, i, x, y)) return buf.ids[i] || id;
  }
  return null;
}

/** Point hit against visible slots (linear reverse scan; prefer Ordered + spatial for large N). */
export function hitTestSoaBuffer(
  buf: SceneRenderBuffer,
  x: number,
  y: number
): string | null {
  for (let i = buf.count - 1; i >= 0; i -= 1) {
    if (hitTestSoaSlot(buf, i, x, y)) return buf.ids[i] || null;
  }
  return null;
}

/** Upsert every visible SoA AABB into a spatial index (cull / hit candidates). */
export function syncSpatialIndexFromSoaBuffer(
  buf: SceneRenderBuffer,
  index: { upsert: (item: { id: string; minX: number; minY: number; maxX: number; maxY: number }) => void }
) {
  for (let i = 0; i < buf.count; i += 1) {
    if (!(buf.flags[i] & SOA_FLAG_VISIBLE)) continue;
    const id = buf.ids[i];
    if (!id) continue;
    const { x, y, w, h } = resolveSoaPaintBox(buf, i);
    index.upsert({
      id,
      minX: Math.min(x, x + w),
      minY: Math.min(y, y + h),
      maxX: Math.max(x, x + w),
      maxY: Math.max(y, y + h),
    });
  }
}

/** Visit visible slots whose AABB intersects the view rect (scene units). */
export function forEachVisibleInRect(
  buf: SceneRenderBuffer,
  view: { minX: number; minY: number; maxX: number; maxY: number },
  visit: (index: number, id: string) => void
) {
  for (let i = 0; i < buf.count; i += 1) {
    if (!(buf.flags[i] & SOA_FLAG_VISIBLE)) continue;
    const id = buf.ids[i];
    if (!id) continue;
    const { x, y, w, h } = resolveSoaPaintBox(buf, i);
    const minX = Math.min(x, x + w);
    const minY = Math.min(y, y + h);
    const maxX = Math.max(x, x + w);
    const maxY = Math.max(y, y + h);
    if (maxX < view.minX || maxY < view.minY || minX > view.maxX || minY > view.maxY) {
      continue;
    }
    visit(i, id);
  }
}

function resolveSoaSlotCornerRadii(
  buf: SceneRenderBuffer,
  index: number,
  nodeId: string,
  node: SceneNodeInput | null | undefined,
  w: number,
  h: number
): { tl: number; tr: number; br: number; bl: number } {
  const live = nodeId ? getLiveCornerRadiusPreviewRadii(nodeId) : null;
  if (live) {
    return clampCornerRadii(live, w, h);
  }
  if (index >= 0) {
    const ro = index * RAD_STRIDE;
    return {
      tl: buf.radii[ro] || 0,
      tr: buf.radii[ro + 1] || 0,
      br: buf.radii[ro + 2] || 0,
      bl: buf.radii[ro + 3] || 0,
    };
  }
  return clampCornerRadii(radiiFromAttrs(node?.attrs), w, h);
}


function clipSoaIdleSlotToFrame(
  ctx: CanvasRenderingContext2D,
  doc: SceneDocument,
  id: string,
  node: SceneNodeInput,
  box: { x: number; y: number; w: number; h: number }
): boolean {
  // Selected / editing ink must match unclipped selection chrome.
  if (frameClipRevealsOverflow(id)) return false;
  const frame = findClippingFrameForNode(doc, {
    ...(node as Record<string, unknown>),
    id,
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
  });
  if (!frame) return false;
  const ox = Number(doc.x) || 0;
  const oy = Number(doc.y) || 0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    Number(frame.x) - ox,
    Number(frame.y) - oy,
    Math.max(1, Number(frame.width) || 1),
    Math.max(1, Number(frame.height) || 1)
  );
  ctx.clip();
  return true;
}

function soaPathOrPolyLineWidth(
  buf: SceneRenderBuffer,
  i: number,
  isPoly: boolean,
  outlineArgb: number,
  outlineW: number
): number {
  if (isPoly && outlineArgb && outlineW > 0) return outlineW;
  if (isPoly) return 0;
  return soaStrokeWidth(buf, i);
}

/** Paint one SoA idle slot (document z-order callers walk ids). */
export function paintSoaIdleSlot(
  ctx: CanvasRenderingContext2D,
  buf: SceneRenderBuffer,
  i: number,
  view: { left: number; top: number; right: number; bottom: number },
  doc: SceneDocument | null
): void {
  const flags = buf.flags[i];
  const id = buf.ids[i];
  const { x, y, w, h, dx: odx, dy: ody } = resolveSoaPaintBox(buf, i, doc);
  if (x + w < view.left || y + h < view.top || x > view.right || y > view.bottom) return;
  const kind = buf.kinds[i];
  let clipped = false;
  if (doc && id) {
    const node = doc.deltaSetLike?.[id] as SceneNodeInput | undefined;
    if (node) {
      clipped = clipSoaIdleSlotToFrame(ctx, doc, id, node, { x, y, w, h });
    }
  }
  try {
    if (kind === SOA_KIND_LINE) {
      ctx.strokeStyle = unpackCssColor(buf.colors[i]);
      ctx.lineWidth = soaStrokeWidth(buf, i);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + h);
      ctx.stroke();
      buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
      return;
    }
    if (kind === SOA_KIND_PATH || kind === SOA_KIND_POLY) {
      const start = buf.pathStart[i];
      const len = buf.pathLen[i];
      if (start < 0 || len < 2) return;
      const fillArgb = buf.colors[i] >>> 0;
      const closed = buf.pathClosed[i] !== 0;
      const outlineArgb = buf.strokeColors[i] >>> 0;
      const outlineW = buf.strokeWidths[i];
      const isPoly = kind === SOA_KIND_POLY;
      const nodeAttrs = id ? doc?.deltaSetLike?.[id]?.attrs : null;
      const solidFill =
        fillArgb !== 0 &&
        (!nodeAttrs || pathAttrsHaveSolidFill(nodeAttrs as Record<string, unknown>));
      // PATH: colors = fill (0 if transparent); strokeColors = stroke.
      // Never fill closed pens with the stroke color (looked black until select→SVG).
      const doFill = closed && solidFill;
      const strokeArgb = outlineArgb || (!doFill && !isPoly ? fillArgb : 0);
      if (doFill) ctx.fillStyle = unpackCssColor(fillArgb);
      ctx.strokeStyle = strokeArgb
        ? unpackCssColor(strokeArgb)
        : unpackCssColor(fillArgb || 0xff333333);
      ctx.lineWidth = soaPathOrPolyLineWidth(buf, i, isPoly, outlineArgb, outlineW);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const base = start * 2;
      let pending = false;
      const finishContour = () => {
        if (!pending) return;
        if (closed) ctx.closePath();
        if (doFill) ctx.fill();
        if (!isPoly || (outlineArgb && outlineW > 0)) {
          if (ctx.lineWidth > 0 && strokeArgb) ctx.stroke();
        }
        pending = false;
      };
      ctx.beginPath();
      for (let p = 0; p < len; p += 1) {
        const fo = base + p * 2;
        const px = buf.pathXY[fo] + odx;
        const py = buf.pathXY[fo + 1] + ody;
        if (!Number.isFinite(px) || !Number.isFinite(py)) {
          finishContour();
          ctx.beginPath();
          continue;
        }
        if (!pending) {
          ctx.moveTo(px, py);
          pending = true;
        } else {
          ctx.lineTo(px, py);
        }
      }
      finishContour();
      buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
      return;
    }
    if (kind !== SOA_KIND_RECT && kind !== SOA_KIND_ELLIPSE) return;
    ctx.fillStyle = unpackCssColor(buf.colors[i]);
    const outlineArgb = buf.strokeColors[i] >>> 0;
    const outlineW = buf.strokeWidths[i];
    const liveAngle = id ? getNodeTransformPreview(id)?.angle : undefined;
    const rot =
      Number.isFinite(liveAngle) && Math.abs(Number(liveAngle)) > 0.5
        ? Number(liveAngle)
        : 0;
    const nodeForRadii = id ? (doc?.deltaSetLike?.[id] as SceneNodeInput | undefined) : undefined;
    const cornerR = resolveSoaSlotCornerRadii(buf, i, id || '', nodeForRadii, w, h);
    const strokeOutline = () => {
      if (!(outlineArgb && outlineW > 0)) return;
      ctx.strokeStyle = unpackCssColor(outlineArgb);
      ctx.lineWidth = outlineW;
      ctx.lineJoin = 'miter';
      if (kind === SOA_KIND_ELLIPSE) {
        ctx.beginPath();
        ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        return;
      }
      const { tl, tr, br, bl } = cornerR;
      if (tl > 0 || tr > 0 || br > 0 || bl > 0) {
        pathSoaRoundedRect(ctx, 0, 0, w, h, tl, tr, br, bl);
      } else {
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
      }
      ctx.stroke();
    };
    const paintRectOrEllipse = () => {
      if (kind === SOA_KIND_ELLIPSE) {
        ctx.beginPath();
        ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        strokeOutline();
        return;
      }
      const { tl, tr, br, bl } = cornerR;
      if (tl > 0 || tr > 0 || br > 0 || bl > 0) {
        fillSoaRoundedRect(ctx, 0, 0, w, h, tl, tr, br, bl);
      } else {
        ctx.fillRect(0, 0, w, h);
      }
      strokeOutline();
    };
    if (rot) {
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.translate(-w / 2, -h / 2);
      paintRectOrEllipse();
      ctx.restore();
    } else if (kind === SOA_KIND_ELLIPSE) {
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      if (outlineArgb && outlineW > 0) {
        ctx.strokeStyle = unpackCssColor(outlineArgb);
        ctx.lineWidth = outlineW;
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      const { tl, tr, br, bl } = cornerR;
      if (tl > 0 || tr > 0 || br > 0 || bl > 0) {
        fillSoaRoundedRect(ctx, x, y, w, h, tl, tr, br, bl);
      } else {
        ctx.fillRect(x, y, w, h);
      }
      if (outlineArgb && outlineW > 0) {
        ctx.strokeStyle = unpackCssColor(outlineArgb);
        ctx.lineWidth = outlineW;
        ctx.lineJoin = 'miter';
        if (tl > 0 || tr > 0 || br > 0 || bl > 0) {
          pathSoaRoundedRect(ctx, x, y, w, h, tl, tr, br, bl);
        } else {
          ctx.beginPath();
          ctx.rect(x, y, w, h);
        }
        ctx.stroke();
      }
    }
    buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
  } finally {
    if (clipped) ctx.restore();
  }
}

/** Paint visible SoA idle slots that intersect the view (scene units). */
export function paintSoaBufferBasic(
  ctx: CanvasRenderingContext2D,
  buf: SceneRenderBuffer,
  view: {
    left?: number;
    top?: number;
    x?: number;
    y?: number;
    width: number;
    height: number;
  },
  opts?: {
    dirtyOnly?: boolean;
    /** When set, skip slots whose document node is not SoA-basic (rounded, stroke, …). */
    skipIndex?: (index: number) => boolean;
    /**
     * Clip each slot to its owning clipContent frame (live artboard aware).
     * Used while frame plates move so ink does not spill past the plate.
     */
    document?: SceneDocument | null;
  }
) {
  const dirtyOnly = opts?.dirtyOnly === true;
  const skipIndex = opts?.skipIndex;
  const doc = opts?.document ?? null;
  if (doc) setSoaPaintDocument(doc);
  // Frame clip is part of paint identity — not a gesture-only hint. Gating on
  // TransformPreview left idle SoA ink unclipped on 动画工作台 / artboards.
  const vl = view.left ?? view.x ?? 0;
  const vt = view.top ?? view.y ?? 0;
  const vr = vl + view.width;
  const vb = vt + view.height;
  // Buffer slot index follows ROOT.children, not stackOrder/frameOrder. Paint
  // back→front by document z so a later-created (or reordered) shape's fill
  // covers lower siblings' strokes — otherwise gray borders "ghost" on top.
  const paintOrder: number[] = [];
  for (let i = 0; i < buf.count; i += 1) {
    const flags = buf.flags[i];
    if (!(flags & SOA_FLAG_VISIBLE)) continue;
    if (!(flags & SOA_FLAG_CANVAS_IDLE)) continue;
    if (!(flags & SOA_FLAG_BASIC_GEOM)) continue;
    if (dirtyOnly && !(flags & SOA_FLAG_DIRTY)) continue;
    if (skipIndex?.(i)) continue;
    const id = buf.ids[i];
    if (doc && id && !doc.deltaSetLike?.[id]) {
      buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
      continue;
    }
    if (doc && id) {
      const paintNode = doc.deltaSetLike[id] as SceneNodeInput | undefined;
      if (paintNode && isNodeOverlayHidden(doc, paintNode)) {
        buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
        continue;
      }
    }
    const liveRadiusPreview = Boolean(id && getLiveCornerRadiusPreviewNodeId() === id);
    // DOM hosts own pixels — skip SoA paint (corner-radius drag stays on canvas).
    if (id && getShapeHost(id)?.el && !liveRadiusPreview) {
      buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
      continue;
    }
    if (id && getNodeTransformPreview(id)?.hidden) {
      buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
      continue;
    }
    paintOrder.push(i);
  }
  if (doc && paintOrder.length > 1) {
    paintOrder.sort((a, b) => {
      const idA = buf.ids[a] || '';
      const idB = buf.ids[b] || '';
      // Selection reveal: paint selected ink last so it sits above siblings
      // (Figma-like). Hit-test still uses true stackOrder.
      const raiseA = frameClipRevealsOverflow(idA) ? 1 : 0;
      const raiseB = frameClipRevealsOverflow(idB) ? 1 : 0;
      if (raiseA !== raiseB) return raiseA - raiseB;
      const za = stackZIndex(doc, 'node', idA);
      const zb = stackZIndex(doc, 'node', idB);
      return za - zb || a - b;
    });
  }
  for (const i of paintOrder) {
    paintSoaIdleSlot(ctx, buf, i, { left: vl, top: vt, right: vr, bottom: vb }, doc);
  }
}

/** World-space rounded rect path (tl/tr/br/bl) — shared by fill and outline stroke. */
export function pathSoaRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tl: number,
  tr: number,
  br: number,
  bl: number,
  opts?: { append?: boolean }
) {
  if (!opts?.append) ctx.beginPath();
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
}

/** World-space rounded rect fill (tl/tr/br/bl). */
export function fillSoaRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tl: number,
  tr: number,
  br: number,
  bl: number
) {
  pathSoaRoundedRect(ctx, x, y, w, h, tl, tr, br, bl);
  ctx.fill();
}

/** Mark all canvas-idle slots dirty (e.g. after full buffer sync). */
export function markAllSoaDirty(buf: SceneRenderBuffer) {
  for (let i = 0; i < buf.count; i += 1) {
    if (buf.flags[i] & SOA_FLAG_CANVAS_IDLE) {
      buf.flags[i] = (buf.flags[i] | SOA_FLAG_DIRTY) >>> 0;
    }
  }
}

/** Mark one slot dirty by index (no-op if out of range). */
export function markSoaDirty(buf: SceneRenderBuffer, index: number) {
  if (index < 0 || index >= buf.count) return;
  buf.flags[index] = (buf.flags[index] | SOA_FLAG_DIRTY) >>> 0;
}

/** Mark one slot dirty by node id. */
export function markSoaDirtyById(buf: SceneRenderBuffer, id: string) {
  const i = buf.indexById.get(id);
  if (i == null) return;
  markSoaDirty(buf, i);
}

/**
 * Update geometry for an existing slot (or no-op if missing).
 * Does not change kind/eligibility — use document sync for structural changes.
 */
export function upsertSoaGeom(
  buf: SceneRenderBuffer,
  id: string,
  geom: { x: number; y: number; w: number; h: number; color?: number }
): number {
  let index = buf.indexById.get(id);
  if (index == null) {
    ensureCapacity(buf, buf.count + 1);
    index = buf.count;
    buf.count += 1;
    buf.ids[index] = id;
    buf.indexById.set(id, index);
    buf.kinds[index] = SOA_KIND_RECT;
    buf.strokeWidths[index] = 0;
    buf.strokeColors[index] = 0;
    buf.flags[index] = (SOA_FLAG_VISIBLE | SOA_FLAG_CANVAS_IDLE | SOA_FLAG_BASIC_GEOM | SOA_FLAG_DIRTY) >>> 0;
    buf.pathStart[index] = -1;
    buf.pathLen[index] = 0;
    buf.pathClosed[index] = 0;
    const ro = index * RAD_STRIDE;
    buf.radii[ro] = 0;
    buf.radii[ro + 1] = 0;
    buf.radii[ro + 2] = 0;
    buf.radii[ro + 3] = 0;
  }
  const o = index * POS_STRIDE;
  buf.positions[o] = geom.x;
  buf.positions[o + 1] = geom.y;
  buf.positions[o + 2] = Math.max(0.01, geom.w);
  buf.positions[o + 3] = Math.max(0.01, geom.h);
  if (geom.color != null) buf.colors[index] = geom.color >>> 0;
  buf.flags[index] = (buf.flags[index] | SOA_FLAG_DIRTY) >>> 0;
  return index;
}

/**
 * Mark DOM hosts (editors / SoftGlow) off SoA canvas ink; BASIC_GEOM stays on canvas.
 */
export function applySoaHostInkFlags(
  buf: SceneRenderBuffer,
  hostIds: ReadonlySet<string> | readonly string[]
): number {
  const hosts = Array.isArray(hostIds)
    ? new Set(hostIds.filter(Boolean))
    : new Set(hostIds);
  let flipped = 0;
  for (let i = 0; i < buf.count; i += 1) {
    const id = buf.ids[i];
    if (!id) continue;
    const kind = buf.kinds[i];
    const shapeEligible =
      kind === SOA_KIND_RECT ||
      kind === SOA_KIND_ELLIPSE ||
      kind === SOA_KIND_LINE ||
      kind === SOA_KIND_PATH ||
      kind === SOA_KIND_POLY;
    if (!shapeEligible) continue;
    let flags = buf.flags[i];
    const wantInk = !hosts.has(id) && (flags & SOA_FLAG_BASIC_GEOM) !== 0;
    const isInk = (flags & SOA_FLAG_CANVAS_IDLE) !== 0;
    if (wantInk === isInk) continue;
    if (wantInk) flags = (flags | SOA_FLAG_CANVAS_IDLE) >>> 0;
    else flags = (flags & ~SOA_FLAG_CANVAS_IDLE) >>> 0;
    flags = (flags | SOA_FLAG_DIRTY) >>> 0;
    buf.flags[i] = flags;
    flipped += 1;
  }
  return flipped;
}

/** Module singleton used by the live stage. */
let sharedBuffer: SceneRenderBuffer | null = null;

export function getSharedSceneRenderBuffer(): SceneRenderBuffer {
  if (!sharedBuffer) sharedBuffer = createSceneRenderBuffer();
  return sharedBuffer;
}

export function resetSharedSceneRenderBuffer() {
  sharedBuffer = createSceneRenderBuffer();
  return sharedBuffer;
}
