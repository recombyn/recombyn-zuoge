/**
 * Precomp isolation focus — while editing a lot precomp, only that node paints.
 */

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
  if (!node) return true;
  const lotId = precompEditLotNodeId;
  // Prefer showing the linked lot plate only.
  if (lotId) {
    return String(nodeId) !== lotId;
  }
  // No linked node (imported precomp): hide non-host lottie plates; keep frame host
  // invisible anyway. Hide everything except animation frame hosts so overlay can draw.
  if (
    node.attrs?.animationFrameHost === true ||
    node.attrs?.animationFrameHost === 'true' ||
    node.attrs?.lottieFrameHost === true
  ) {
    return false;
  }
  return true;
}

/** Hide live Lottie ink while precomp edit is open (static overlay replaces it). */
export function shouldHideLottieInkForPrecompEdit(_nodeId: string): boolean {
  return precompEditActive;
}
