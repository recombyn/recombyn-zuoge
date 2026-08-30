/**
 * Precomp isolation focus — LOT tab shows session shapes; hide lot plate + host ink.
 */
import { isPrecompEditSessionNode } from '@/components/editor/nodes/AnimationNode/animationPrecompSession';

let precompEditLotNodeId: string | null = null;
let precompEditActive = false;

export function setLottiePrecompEditFocus(opts: {
  active: boolean;
  lotNodeId?: string | null;
}) {
  precompEditActive = Boolean(opts.active);
  precompEditLotNodeId = opts.active
    ? String(opts.lotNodeId || '').trim() || null
    : null;
}

export function getLottiePrecompEditFocus(): {
  active: boolean;
  lotNodeId: string | null;
} {
  return { active: precompEditActive, lotNodeId: precompEditLotNodeId };
}

/** True → skip paint / hit for this node under precomp edit isolation. */
export function isHiddenByLottiePrecompEditFocus(
  nodeId: string,
  node: { attrs?: Record<string, unknown> | null; key?: string } | null | undefined
): boolean {
  if (!precompEditActive) return false;
  // Real JSON shapes for this LOT tab stay visible + editable.
  if (isPrecompEditSessionNode(node)) return false;
  // Hide the nested lot plate (ink replaced by session shapes).
  if (precompEditLotNodeId && nodeId === precompEditLotNodeId) return true;
  // Hide frame host + other workbench children while editing insides.
  if (String(node?.attrs?.frameId || '').trim()) return true;
  return false;
}

/** Hide live Lottie ink while precomp edit is open (session shapes replace it). */
export function shouldHideLottieInkForPrecompEdit(_nodeId: string): boolean {
  return precompEditActive;
}
