import type { ImageMarkPin } from '@/store/modules/editor';
import type { MarkRegion } from './MarkRegionOverlay';

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
  sink: 'agent' | 'quickEdit'
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
