import type { ImageMarkPin } from '@/store/modules/editor';

/** Normalize legacy single-pin storage to an array. */
export function markPinsForNode(
  pins: Record<string, ImageMarkPin | ImageMarkPin[]>,
  nodeId: string
): ImageMarkPin[] {
  const raw = pins[nodeId];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}
