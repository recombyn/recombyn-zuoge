import type { Dispatch } from '@reduxjs/toolkit';
import { removeImageMarkPin } from '@/store/modules/editor';

/** `mark:{nodeId}:{regionId}:{ts}` */
export function parseMarkChipKey(key: string): { nodeId: string; regionId: string } | null {
  const parts = String(key || '').split(':');
  if (parts[0] !== 'mark' || parts.length < 3) return null;
  const nodeId = parts[1]?.trim();
  const regionId = parts[2]?.trim();
  if (!nodeId || !regionId) return null;
  return { nodeId, regionId };
}

export function isMarkContextKey(key: string): boolean {
  return parseMarkChipKey(key) != null;
}

export function syncMarkPinRemoved(dispatch: Dispatch, key: string): void {
  const parsed = parseMarkChipKey(key);
  if (!parsed) return;
  dispatch(removeImageMarkPin({ nodeId: parsed.nodeId, pinId: parsed.regionId }));
}
