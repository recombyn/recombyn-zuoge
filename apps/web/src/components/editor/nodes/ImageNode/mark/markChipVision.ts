import type { ComposerContext } from '@/components/editor/panels/AgentComposerInput';
import { imageSrcToFile } from '@/utils/uploadImage';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import { isMarkContextKey } from './markChipSync';
import { parseMarkPinFromChip } from './markChipUtils';

const CHIP_THUMB_MAX = 96;

async function loadImageElement(
  src: string,
  uploadKey?: string | null
): Promise<{ img: HTMLImageElement; revoke: () => void }> {
  const file = await imageSrcToFile(src, 'mark-region.png', { uploadKey });
  const blobUrl = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error('image load failed'));
    };
    el.src = blobUrl;
  });
  return { img, revoke: () => URL.revokeObjectURL(blobUrl) };
}

function cropToCanvas(
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  maxSide?: number
): string {
  let dw = Math.max(1, Math.round(sw));
  let dh = Math.max(1, Math.round(sh));
  if (maxSide && Math.max(dw, dh) > maxSide) {
    const scale = maxSide / Math.max(dw, dh);
    dw = Math.max(1, Math.round(dw * scale));
    dh = Math.max(1, Math.round(dh * scale));
  }
  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unsupported');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  return canvas.toDataURL('image/png');
}

/** Crop a marked image region to PNG data URLs for agent vision + chip preview. */
export async function rasterizeMarkRegionToDataUrl(
  document: SceneDocument,
  chip: Pick<ComposerContext, 'key' | 'payload'>
): Promise<{ dataUrl: string; thumbUrl: string } | null> {
  if (!isMarkContextKey(chip.key)) return null;
  const payload = String(chip.payload || '').trim();
  if (!payload) return null;
  const parts = String(chip.key).split(':');
  const nodeId = parts[1]?.trim();
  if (!nodeId) return null;
  const node = document?.deltaSetLike?.[nodeId];
  if (!node || String(node.key || '') !== 'image') return null;
  const src = String(node.attrs?.src || '').trim();
  if (!src) return null;
  const nodeW = Math.max(1, Number(node.width) || 1);
  const nodeH = Math.max(1, Number(node.height) || 1);
  const pin = parseMarkPinFromChip(chip.key, payload, nodeW, nodeH, 'agent');
  if (!pin) return null;
  const uploadKey = String(node.attrs?.uploadKey || '').trim() || null;

  const { img, revoke } = await loadImageElement(src, uploadKey);
  try {
    const nw = Math.max(1, img.naturalWidth || img.width || 1);
    const nh = Math.max(1, img.naturalHeight || img.height || 1);
    const sx = (pin.x / nodeW) * nw;
    const sy = (pin.y / nodeH) * nh;
    const sw = Math.max(1, (pin.w / nodeW) * nw);
    const sh = Math.max(1, (pin.h / nodeH) * nh);
    const dataUrl = cropToCanvas(img, sx, sy, sw, sh);
    const thumbUrl = cropToCanvas(img, sx, sy, sw, sh, CHIP_THUMB_MAX);
    return { dataUrl, thumbUrl };
  } finally {
    revoke();
  }
}

/** Best-effort vision raster for a mark chip (keeps payload-only chip shape at create time). */
export async function enrichMarkComposerContext(
  document: SceneDocument | null | undefined,
  ctx: ComposerContext
): Promise<ComposerContext> {
  if (!document || !isMarkContextKey(ctx.key)) return ctx;
  if (String(ctx.dataUrl || '').trim()) return ctx;
  try {
    const raster = await rasterizeMarkRegionToDataUrl(document, ctx);
    if (!raster) return ctx;
    return {
      ...ctx,
      dataUrl: raster.dataUrl,
      thumbUrl: String(ctx.thumbUrl || '').trim() || raster.thumbUrl,
    };
  } catch {
    return ctx;
  }
}

/** Ensure mark chips carry cropped region pixels for agent vision send bag. */
export async function enrichChipsForAgentVision(
  document: SceneDocument | null | undefined,
  chips: ComposerContext[]
): Promise<ComposerContext[]> {
  if (!document || !chips.length) return chips;
  const hasMark = chips.some((c) => isMarkContextKey(c.key) && !String(c.dataUrl || '').trim());
  if (!hasMark) return chips;
  return Promise.all(chips.map((c) => enrichMarkComposerContext(document, c)));
}
