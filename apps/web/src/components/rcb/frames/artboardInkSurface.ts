/**
 * Per-artboard ink surface — bound SoA idle on a FO canvas via shared WebGL
 * (same mesh path as world). Plate fill + edge stay on SVG (HtmlArtboardFrame);
 * painting them here too double-layers and bleeds past selection chrome.
 *
 * Backing tracks zoom: FO sits under SVG `scale(zoom)`, so scene×dpr alone mush.
 * Soft 8× soft-upscale path removed; MAX_EDGE still caps OOM.
 */
import { nodeOwnerFrameId } from '@/components/rcb/frames/frameNodeBinding';
import { frameClipRevealsOverflow } from '@/components/rcb/frames/frameContentClip';
import { getNodeTransformPreview } from '@/components/rcb/core/transformPreview';
import { readDevicePixelRatio } from '@/components/rcb/core/dpr';
import { buildNodeStackZMap } from '@/components/rcb/scene/document/sceneDocument';
import type { SceneDocument, SceneNodeInput } from '@/components/rcb/sceneNode';
import type { ArtboardFrame } from '@/components/rcb/frames/types';
import {
  artboardWebglInkAvailable,
  paintArtboardWebglInk,
  releaseArtboardWebglTarget,
} from '@/components/rcb/frames/artboardWebglInk';
import {
  getSharedSceneRenderBuffer,
  paintSoaIdleSlot,
  SOA_FLAG_CANVAS_IDLE,
  SOA_FLAG_FREE,
  SOA_FLAG_VISIBLE,
  setSoaPaintDocument,
  type SceneRenderBuffer,
} from '@/components/rcb/render/sceneRenderBuffer';

/**
 * Soft cap on zoom×dpr for a single full-plate ink bitmap.
 * Raised so MAX_EDGE is the practical OOM guard (no permanent mush at 8×).
 */
export const ARTBOARD_INK_MAX_SCALE = 64;
/** Longest backing edge (px) so huge plates at high zoom do not OOM. */
export const ARTBOARD_INK_MAX_EDGE = 4096;

export type ArtboardInkPaintFrame = Pick<
  ArtboardFrame,
  'id' | 'x' | 'y' | 'width' | 'height'
> & {
  backgroundColor?: string;
  backgroundOpacity?: number;
};

type SurfaceEntry = {
  canvas: HTMLCanvasElement;
  frameId: string;
  getFrame: () => ArtboardInkPaintFrame;
  getDocument: () => SceneDocument | null;
  selected: boolean;
  highlighted: boolean;
  zoom: number;
};

const surfaces = new Map<string, SurfaceEntry>();
let paintRaf = 0;

function clampZoom(zoom: number | undefined): number {
  return Math.max(0.05, Number(zoom) || 1);
}

/** Device pixels per scene unit for artboard FO ink (under camera scale(zoom)). */
export function artboardInkScale(zoom: number, dpr = 1): number {
  const z = clampZoom(zoom);
  const ratio = Math.max(1, Number(dpr) || 1);
  return Math.min(ARTBOARD_INK_MAX_SCALE, z * ratio);
}

/** True when zoom×dpr exceeds the full-plate cap (display would soft-upscale). */
export function artboardInkBackingInsufficient(zoom: number, dpr = 1): boolean {
  const z = clampZoom(zoom);
  const ratio = Math.max(1, Number(dpr) || 1);
  return z * ratio > ARTBOARD_INK_MAX_SCALE + 1e-6;
}

/**
 * Size the FO canvas so CSS scene size × camera zoom maps ~1:1 to device pixels
 * (up to {@link ARTBOARD_INK_MAX_SCALE} / {@link ARTBOARD_INK_MAX_EDGE}).
 * Returns the effective scene→backing scale for paint transforms.
 */
function resizeInkCanvas(
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
  scale: number
): number {
  let bw = Math.max(1, Math.round(w * scale));
  let bh = Math.max(1, Math.round(h * scale));
  let effective = scale;
  const edge = Math.max(bw, bh);
  if (edge > ARTBOARD_INK_MAX_EDGE) {
    const t = ARTBOARD_INK_MAX_EDGE / edge;
    bw = Math.max(1, Math.round(bw * t));
    bh = Math.max(1, Math.round(bh * t));
    effective = Math.min(bw / w, bh / h);
  }
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  return effective;
}

function collectBoundIdleIndices(
  buf: SceneRenderBuffer,
  doc: SceneDocument,
  frameId: string
): number[] {
  const indices: number[] = [];
  for (let i = 0; i < buf.count; i += 1) {
    const flags = buf.flags[i];
    if (flags & SOA_FLAG_FREE) continue;
    if (!(flags & SOA_FLAG_VISIBLE) || !(flags & SOA_FLAG_CANVAS_IDLE)) continue;
    const id = buf.ids[i];
    if (!id) continue;
    // Selected / editing: paint on raised SVG host / world ink (not FO).
    // Dual FO+world paint left a clipped ghost in the plate while the live
    // drag drew outside — and world WebGL cannot cover the plate fill.
    if (frameClipRevealsOverflow(id)) continue;
    const node = doc.deltaSetLike?.[id] as SceneNodeInput | undefined;
    if (!node || nodeOwnerFrameId(node) !== frameId) continue;
    if (getNodeTransformPreview(id)?.hidden) continue;
    indices.push(i);
  }
  if (indices.length <= 1) return indices;
  const zMap = buildNodeStackZMap(
    doc,
    indices.map((i) => buf.ids[i] || '').filter(Boolean)
  );
  indices.sort((a, b) => (zMap.get(buf.ids[a] || '') ?? 0) - (zMap.get(buf.ids[b] || '') ?? 0));
  return indices;
}

/** Canvas2D survival path when shared artboard WebGL is unavailable. */
function paintArtboardInkSurface2d(entry: SurfaceEntry, frame: ArtboardInkPaintFrame, effective: number): void {
  const w = Math.max(1, Number(frame.width) || 1);
  const h = Math.max(1, Number(frame.height) || 1);
  const ctx = entry.canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(effective, 0, 0, effective, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const doc = entry.getDocument();
  if (!doc) return;
  setSoaPaintDocument(doc);
  const buf = getSharedSceneRenderBuffer();
  const fx = Number(frame.x) || 0;
  const fy = Number(frame.y) || 0;
  const indices = collectBoundIdleIndices(buf, doc, String(frame.id));
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.translate(-fx, -fy);
  const view = { left: fx, top: fy, right: fx + w, bottom: fy + h };
  for (const i of indices) paintSoaIdleSlot(ctx, buf, i, view, doc);
  ctx.restore();
}

/** Register a display canvas for continuous artboard ink. */
export function registerArtboardInkSurface(
  entry: Omit<SurfaceEntry, 'selected' | 'highlighted' | 'zoom'> & {
    selected?: boolean;
    highlighted?: boolean;
    zoom?: number;
  }
): () => void {
  const id = String(entry.frameId || '').trim();
  if (!id) return () => undefined;
  const full: SurfaceEntry = {
    canvas: entry.canvas,
    frameId: id,
    getFrame: entry.getFrame,
    getDocument: entry.getDocument,
    selected: Boolean(entry.selected),
    highlighted: Boolean(entry.highlighted),
    zoom: clampZoom(entry.zoom),
  };
  surfaces.set(id, full);
  scheduleArtboardInkPaint(id);
  return () => {
    if (surfaces.get(id) === full) {
      surfaces.delete(id);
      releaseArtboardWebglTarget(id);
    }
  };
}

/** Update plate chrome flags without remounting the foreignObject canvas. */
export function updateArtboardInkChrome(
  frameId: string,
  opts: { selected?: boolean; highlighted?: boolean; zoom?: number }
): void {
  const entry = surfaces.get(String(frameId || '').trim());
  if (!entry) return;
  if (opts.selected != null) entry.selected = Boolean(opts.selected);
  if (opts.highlighted != null) entry.highlighted = Boolean(opts.highlighted);
  if (opts.zoom != null) entry.zoom = clampZoom(opts.zoom);
  scheduleArtboardInkPaint(frameId);
}

/**
 * Repaint one plate sync, or coalesce a full restamp on the next frame.
 * Calling with an id does not also schedule a global RAF (avoids double paint).
 */
export function scheduleArtboardInkPaint(frameId?: string): void {
  if (frameId) {
    const one = surfaces.get(String(frameId).trim());
    if (one) paintArtboardInkSurface(one);
    return;
  }
  if (paintRaf) return;
  paintRaf = requestAnimationFrame(() => {
    paintRaf = 0;
    for (const entry of surfaces.values()) paintArtboardInkSurface(entry);
  });
}

export function paintArtboardInkSurface(entry: SurfaceEntry): void {
  const frame = entry.getFrame();
  const w = Math.max(1, Number(frame.width) || 1);
  const h = Math.max(1, Number(frame.height) || 1);
  const dpr = Math.max(1, readDevicePixelRatio() || 1);
  const scale = artboardInkScale(entry.zoom, dpr);
  const effective = resizeInkCanvas(entry.canvas, w, h, scale);

  const doc = entry.getDocument();
  if (
    doc &&
    artboardWebglInkAvailable() &&
    paintArtboardWebglInk({
      targetCanvas: entry.canvas,
      frameId: String(frame.id),
      frame: {
        x: Number(frame.x) || 0,
        y: Number(frame.y) || 0,
        width: w,
        height: h,
      },
      document: doc,
      effectiveScale: effective,
      dpr,
    })
  ) {
    return;
  }

  // Transparent clear + optional 2D idle — SVG fill/edge own the plate.
  paintArtboardInkSurface2d(entry, frame, effective);
}

/** True when a SoA slot belongs to an artboard (painted on ArtboardLayer, not world ink). */
export function soaSlotIsFrameBound(
  buf: SceneRenderBuffer,
  index: number,
  doc: SceneDocument | null | undefined
): boolean {
  if (!doc) return false;
  const id = buf.ids[index];
  if (!id) return false;
  const node = doc.deltaSetLike?.[id] as SceneNodeInput | undefined;
  return Boolean(nodeOwnerFrameId(node));
}
