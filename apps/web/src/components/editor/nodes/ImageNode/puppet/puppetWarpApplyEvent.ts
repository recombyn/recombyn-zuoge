/**
 * Imperative puppet warp apply (event, not a document watcher).
 * Always deferred — safe to call from Redux reducers (no getState during reduce).
 */
export const RCB_PUPPET_WARP_APPLY = 'rcb-puppet-warp-apply';

export function requestPuppetWarpApply(opts?: { afterPaint?: boolean }) {
  if (typeof window === 'undefined') return;
  const fire = () => {
    window.dispatchEvent(new CustomEvent(RCB_PUPPET_WARP_APPLY));
  };
  queueMicrotask(fire);
  if (opts?.afterPaint) {
    queueMicrotask(() => window.requestAnimationFrame(fire));
  }
}
