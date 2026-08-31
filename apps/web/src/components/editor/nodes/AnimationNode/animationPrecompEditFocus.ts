/**
 * Precomp isolation focus — LOT tab shows session shapes; hide lot plate + host ink.
 */
import { isPrecompEditSessionNode } from '@/components/editor/nodes/AnimationNode/animationPrecompSession';

let precompEditLotNodeId: string | null = null;
let precompEditActive = false;
/** True when LOT tab exploded JSON into real scene shapes (hide lot ink). */
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
  // Real JSON shapes for this LOT tab stay visible + editable.
  if (isPrecompEditSessionNode(node)) return false;
  // Nested lot must stay in the SVG tree so 主场景 can remount ink after tab
  // switch. Overlay hides its lottie-web while session shapes are up.
  if (precompEditLotNodeId && nodeId === precompEditLotNodeId) return false;
  // Hide frame host + other workbench children while editing insides.
  if (String(node?.attrs?.frameId || '').trim()) return true;
  return false;
}
