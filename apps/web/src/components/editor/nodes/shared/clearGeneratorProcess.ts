import type { Dispatch } from '@/store';
import { clearImageProcess } from '@/store/modules/editor';

/** Drop SoftGlow on a node (always bumps scene remount so overlay cannot stick). */
export function clearGeneratorProcessOverlay(
  dispatch: Dispatch,
  _document: unknown,
  nodeId: string
): void {
  if (!nodeId) return;
  dispatch(clearImageProcess({ nodeId }));
}

/** After generate attempt: if SoftGlow is still on, force-clear it. */
export function ensureGeneratorProcessCleared(
  dispatch: Dispatch,
  document: { deltaSetLike?: Record<string, { attrs?: Record<string, unknown> }> } | null | undefined,
  nodeId: string
): boolean {
  if (!document || !nodeId) return false;
  const node = document.deltaSetLike?.[nodeId];
  if (String(node?.attrs?.processStatus || '') !== 'running') return false;
  dispatch(clearImageProcess({ nodeId }));
  return true;
}
