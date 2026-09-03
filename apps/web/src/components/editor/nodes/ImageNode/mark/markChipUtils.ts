import type { ImageMarkPin } from '@/store/modules/editor';
import type { MarkRegion } from './MarkRegionOverlay';

const MARK_REGION_RE =
  /region:\s*#(\d+)\((\w+)@([\d.]+),([\d.]+),([\d.]+)x([\d.]+)\)/;

/** Rebuild a canvas pin from a saved mark chip payload (edit / restore). */
export function parseMarkPinFromChip(
  chipKey: string,
  payload: string,
  nodeW: number,
  nodeH: number,
  sink: 'agent' | 'quickEdit' | 'imageGen' | 'videoGen' = 'agent'
): ImageMarkPin | null {
  const parts = String(chipKey || '').split(':');
  if (parts[0] !== 'mark' || parts.length < 3) return null;
  const nodeId = parts[1]?.trim();
  const regionId = parts[2]?.trim();
  if (!nodeId || !regionId) return null;
  const m = String(payload || '').match(MARK_REGION_RE);
  if (!m) return null;
  const index = Number(m[1]);
  const tag = m[2];
  const nx = Number(m[3]);
  const ny = Number(m[4]);
  const nw = Number(m[5]);
  const nh = Number(m[6]);
  if (![index, nx, ny, nw, nh].every((n) => Number.isFinite(n))) return null;
  const w = Math.max(1, nodeW);
  const h = Math.max(1, nodeH);
  const labelLine = String(payload || '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('label:'));
  const label = labelLine ? labelLine.slice('label:'.length).trim() : undefined;
  let kind: MarkRegion['kind'] = 'manual';
  if (tag === 'text') kind = 'text';
  else if (tag === 'subject') kind = 'image';
  return {
    nodeId,
    id: regionId,
    index,
    x: Math.round(nx * w),
    y: Math.round(ny * h),
    w: Math.max(1, Math.round(nw * w)),
    h: Math.max(1, Math.round(nh * h)),
    kind,
    label,
    sink,
  };
}

/** Next 1-based badge index — accounts for committed pins and in-session regions. */
export function nextMarkRegionIndex(
  pins: ImageMarkPin[],
  regions: Array<Pick<MarkRegion, 'index'>>
): number {
  let max = 0;
  for (const p of pins) max = Math.max(max, Number(p.index) || 0);
  for (const r of regions) max = Math.max(max, Number(r.index) || 0);
  return max + 1;
}

/** Chip label in composer — `[1] 区域` / `[1] 中秋团圆`. */
export function markComposerChipLabel(region: {
  index: number;
  kind?: string;
  label?: string;
}): string {
  if (region.kind === 'text') {
    const quoted = region.label?.match(/"([^"]+)"/)?.[1];
    const text = quoted || region.label?.replace(/^\d+\s*/, '').trim();
    if (text && text !== '文字') return `[${region.index}] ${text}`;
  }
  return `[${region.index}] 区域`;
}

export function buildMarkChipPayload(
  nodeId: string,
  region: Pick<MarkRegion, 'index' | 'x' | 'y' | 'w' | 'h' | 'kind' | 'label'>,
  nodeW: number,
  nodeH: number
): string {
  const nx = (region.x / nodeW).toFixed(3);
  const ny = (region.y / nodeH).toFixed(3);
  const nw = (region.w / nodeW).toFixed(3);
  const nh = (region.h / nodeH).toFixed(3);
  const tag = region.kind === 'text' ? 'text' : 'subject';
  return [
    '[Marked image region — edit this area on the referenced image]',
    `node_id: ${nodeId}`,
    `region: #${region.index}(${tag}@${nx},${ny},${nw}x${nh})`,
    `label: ${region.label || `区域 ${region.index}`}`,
  ].join('\n');
}

export function regionToMarkPin(
  nodeId: string,
  region: MarkRegion,
  sink: 'agent' | 'quickEdit' | 'imageGen' | 'videoGen'
): ImageMarkPin {
  return {
    nodeId,
    id: region.id,
    index: region.index,
    x: region.x,
    y: region.y,
    w: region.w,
    h: region.h,
    kind: region.kind,
    label: region.label,
    sink,
  };
}

export function markPinToRegion(pin: ImageMarkPin): MarkRegion {
  return {
    id: pin.id,
    index: pin.index,
    x: pin.x,
    y: pin.y,
    w: pin.w,
    h: pin.h,
    kind: pin.kind,
    label: pin.label,
    selected: true,
  };
}
