
import { clearImageProcess } from '@/store/modules/editor';

/** Drop SoftGlow on a node (always bumps scene remount so overlay cannot stick). */
export function clearGeneratorProcessOverlay(
  _document: unknown,
  nodeId: string
): void {
  if (!nodeId) return;
  clearImageProcess({ nodeId });
}

/** After generate attempt: if SoftGlow is still on, force-clear it. */
export function ensureGeneratorProcessCleared(
  document: { deltaSetLike?: Record<string, { attrs?: Record<string, unknown> }> } | null | undefined,
  nodeId: string
): boolean {
  if (!document || !nodeId) return false;
  const node = document.deltaSetLike?.[nodeId];
  if (String(node?.attrs?.processStatus || '') !== 'running') return false;
  clearImageProcess({ nodeId });
  return true;
}
