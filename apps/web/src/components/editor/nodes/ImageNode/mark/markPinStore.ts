import type { ImageMarkPin } from '@/store/modules/editor';

export function markPinsForNode(
  pins: Record<string, ImageMarkPin[]>,
  nodeId: string
): ImageMarkPin[] {
  const raw = pins[nodeId];
  return Array.isArray(raw) ? raw : [];
}
