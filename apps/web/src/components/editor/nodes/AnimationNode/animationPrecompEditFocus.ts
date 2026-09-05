/**
 * Precomp isolation focus — LOT tab unlocks layer/timeline edit.
 * Paint stays on the same nested-lot LottiePlate as 主场景 (no explode).
 */
import { isPrecompEditSessionNode } from '@/components/editor/nodes/AnimationNode/animationPrecompSession';

let precompEditLotNodeId: string | null = null;
let precompEditActive = false;
/** Legacy: true only when an old session exploded JSON into scene shapes. */
let precompEditSessionMaterialized = false;

export function setLottiePrecompEditFocus(opts: {
  active: boolean;
  lotNodeId?: string | null;
  sessionMaterialized?: boolean;
}) {
  precompEditActive = Boolean(opts.active);
  if (!opts.active) {
    precompEditLotNodeId = null;
    precompEditSessionMaterialized = false;
    return;
  }
  const lotId = String(opts.lotNodeId || '').trim();
  precompEditLotNodeId = lotId || null;
  precompEditSessionMaterialized = Boolean(opts.sessionMaterialized);
}

export function getLottiePrecompEditFocus(): {
  active: boolean;
  lotNodeId: string | null;
  sessionMaterialized: boolean;
} {
  return {
    active: precompEditActive,
    lotNodeId: precompEditLotNodeId,
    sessionMaterialized: precompEditSessionMaterialized,
  };
}

/** True → skip paint / hit for this node under precomp edit isolation. */
export function isHiddenByLottiePrecompEditFocus(
  nodeId: string,
  node: { attrs?: Record<string, unknown> | null; key?: string } | null | undefined
): boolean {
  if (!precompEditActive) return false;
  if (isPrecompEditSessionNode(node)) return false;
  // Same nested lot LottiePlate as 主场景 — never remove from the SVG tree.
  if (precompEditLotNodeId && nodeId === precompEditLotNodeId) return false;
  // Lightweight LOT tab: do not isolate-hide siblings (that path remounted hosts
  // and blanked preview). Legacy materialized sessions still isolate.
  if (!precompEditSessionMaterialized) return false;
  if (String(node?.attrs?.frameId || '').trim()) return true;
  return false;
}
