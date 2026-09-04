/**
 * Per-artboard ink surface — plate fill + bound SoA idle nodes on a small canvas.
 * Lives inside the frame's stack SVG layer (data-z) so FO hosts can interleave
 * with other artboards. World WebGL skips frame-bound slots (see skipFrameBound).
 */
import type { ArtboardFrame } from '@/components/rcb/frames/types';
import {
  FRAME_HIGHLIGHT_STROKE,
  FRAME_PLATE_STROKE,
  framePlateStrokeSceneWidth,
} from '@/components/rcb/frames/types';
import {
  getSharedSceneRenderBuffer,
  paintSoaIdleSlot,
  SOA_FLAG_CANVAS_IDLE,
  SOA_FLAG_FREE,
  SOA_FLAG_VISIBLE,
  setSoaPaintDocument,
  type SceneRenderBuffer,
} from '@/components/rcb/render/sceneRenderBuffer';
import { buildNodeStackZMap } from '@/components/rcb/scene/document/sceneDocument';
import type { SceneDocument, SceneNodeInput } from '@/components/rcb/sceneNode';
import { getNodeTransformPreview } from '@/components/rcb/core/transformPreview';
import { readDevicePixelRatio } from '@/components/rcb/core/dpr';
import { nodeOwnerFrameId } from '@/components/rcb/frames/frameNodeBinding';

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

function plateFillCss(frame: ArtboardInkPaintFrame): { css: string; alpha: number } {
  const raw = frame.backgroundColor;
  const css = raw && raw !== 'transparent' ? String(raw) : '#FFFFFF';
  const alpha = Math.max(0, Math.min(100, Number(frame.backgroundOpacity ?? 100))) / 100;
  return { css, alpha };
}

function resizeInkCanvas(canvas: HTMLCanvasElement, w: number, h: number, dpr: number): void {
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
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
    const node = doc.deltaSetLike?.[id] as SceneNodeInput | undefined;
    if (!node || nodeOwnerFrameId(node) !== frameId) continue;
    if (getNodeTransformPreview(id)?.hidden) continue;
    indices.push(i);
  }
  if (indices.length <= 1) return indices;
  const zMap = buildNodeStackZMap(doc);
  indices.sort((a, b) => (zMap.get(buf.ids[a] || '') ?? 0) - (zMap.get(buf.ids[b] || '') ?? 0));
  return indices;
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
    if (surfaces.get(id) === full) surfaces.delete(id);
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
  resizeInkCanvas(entry.canvas, w, h, dpr);

  const ctx = entry.canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const { css, alpha } = plateFillCss(frame);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;

  const doc = entry.getDocument();
  if (doc) {
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

  paintPlateStroke(ctx, w, h, entry);
}

function paintPlateStroke(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  entry: SurfaceEntry
): void {
  if (entry.selected) return;
  const sw = framePlateStrokeSceneWidth(clampZoom(entry.zoom));
  ctx.strokeStyle = entry.highlighted ? FRAME_HIGHLIGHT_STROKE : FRAME_PLATE_STROKE;
  ctx.lineWidth = sw;
  ctx.strokeRect(sw / 2, sw / 2, Math.max(0, w - sw), Math.max(0, h - sw));
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
