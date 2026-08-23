import type { Dispatch } from '@reduxjs/toolkit';
import { removeImageMarkPin, setImageMarkPin } from '@/store/modules/editor';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import { parseMarkPinFromChip } from './markChipUtils';

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

export function syncMarkPinRestored(
  dispatch: Dispatch,
  opts: {
    key: string;
    payload?: string;
    document: SceneDocument;
    sink?: 'agent' | 'quickEdit';
  }
): void {
  const parsed = parseMarkChipKey(opts.key);
  if (!parsed || !opts.payload?.trim()) return;
  const node = opts.document?.deltaSetLike?.[parsed.nodeId];
  if (!node) return;
  const pin = parseMarkPinFromChip(
    opts.key,
    opts.payload,
    Math.max(1, Number(node.width) || 1),
    Math.max(1, Number(node.height) || 1),
    opts.sink || 'agent'
  );
  if (pin) dispatch(setImageMarkPin(pin));
}
