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
  _nodeId: string,
  _node: { attrs?: Record<string, unknown> | null; key?: string } | null | undefined
): boolean {
  if (!precompEditActive) return false;
  // Overlay owns the board + layer picks — hide every scene node (incl. lot plate).
  // Nested lot stays unmovable while on the LOT tab (cannot drag out).
  return true;
}

/** Hide live Lottie ink while precomp edit is open (static overlay replaces it). */
export function shouldHideLottieInkForPrecompEdit(_nodeId: string): boolean {
  return precompEditActive;
}
