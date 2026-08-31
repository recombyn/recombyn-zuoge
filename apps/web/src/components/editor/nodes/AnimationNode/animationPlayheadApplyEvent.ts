/**
 * Imperative playhead → scene apply (event, not a document watcher).
 * Always deferred — safe to call from Redux reducers (no getState during reduce).
 */
export const RCB_ANIMATION_PLAYHEAD_APPLY = 'rcb-animation-playhead-apply';

/** Fire after playhead / LOT-tab enter — optional one rAF for SVG remount. */
export function requestPlayheadSceneApply(opts?: { afterPaint?: boolean }) {
  if (typeof window === 'undefined') return;
  const fire = () => {
    window.dispatchEvent(new CustomEvent(RCB_ANIMATION_PLAYHEAD_APPLY));
  };
  // Never sync: listeners call store.getState(); Redux forbids that mid-reduce.
  queueMicrotask(fire);
  if (opts?.afterPaint) {
    queueMicrotask(() => window.requestAnimationFrame(fire));
  }
}
