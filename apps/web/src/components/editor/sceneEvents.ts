/**
 * Imperative editor scene events — prefer dispatching these over useEffect([state]).
 * Hosts bind once with addEventListener; producers call request* at the action site.
 *
 * All fires are deferred (queueMicrotask) so mutators can call them safely —
 * listeners often read store.getState(), which must not run mid-write.
 */

export const RCB_ENSURE_ANIMATION_FRAME = 'rcb-ensure-animation-frame';
export const RCB_SYNC_NESTED_LOT_HOSTS = 'rcb-sync-nested-lot-hosts';
export const RCB_PRECOMP_CAMERA_FIT = 'rcb-precomp-camera-fit';
export const RCB_PRECOMP_CAMERA_RELEASE = 'rcb-precomp-camera-release';
export const RCB_MOCKUP_BAKE_COMPOSITE = 'rcb-mockup-bake-composite';
export const RCB_TIMELINE_CAMERA_FIT = 'rcb-timeline-camera-fit';
export const RCB_TIMELINE_CAMERA_RELEASE = 'rcb-timeline-camera-release';
/** AI transaction commit — sync SoA buffer + invalidate bake + idle paint. */
export const RCB_SOA_AI_FLUSH = 'rcb-soa-ai-flush';

function defer(fn: () => void) {
  if (typeof window === 'undefined') return;
  queueMicrotask(fn);
}

export function requestEnsureAnimationFrame(
  frameId: string,
  opts?: { skipHistory?: boolean }
) {
  const id = String(frameId || '').trim();
  if (!id || typeof window === 'undefined') return;
  defer(() => {
    window.dispatchEvent(
      new CustomEvent(RCB_ENSURE_ANIMATION_FRAME, {
        detail: { frameId: id, skipHistory: Boolean(opts?.skipHistory) },
      })
    );
  });
}

/** Alias — ensure is always deferred. */
export function queueEnsureAnimationFrame(
  frameId: string,
  opts?: { skipHistory?: boolean }
) {
  requestEnsureAnimationFrame(frameId, opts);
}

export function requestSyncNestedLotHosts(opts?: {
  frameHostId?: string;
  timeSec?: number;
  afterPaint?: boolean;
}) {
  if (typeof window === 'undefined') return;
  const fire = () =>
    window.dispatchEvent(
      new CustomEvent(RCB_SYNC_NESTED_LOT_HOSTS, {
        detail: {
          frameHostId: String(opts?.frameHostId || '').trim() || undefined,
          timeSec: Number(opts?.timeSec) || 0,
        },
      })
    );
  defer(fire);
  if (opts?.afterPaint) defer(() => window.requestAnimationFrame(fire));
}

export function requestPrecompCameraFit(opts?: { afterPaint?: boolean }) {
  if (typeof window === 'undefined') return;
  const fire = () => window.dispatchEvent(new CustomEvent(RCB_PRECOMP_CAMERA_FIT));
  defer(fire);
  if (opts?.afterPaint) defer(() => window.requestAnimationFrame(fire));
}

export function requestPrecompCameraRelease() {
  defer(() => window.dispatchEvent(new CustomEvent(RCB_PRECOMP_CAMERA_RELEASE)));
}

export function requestMockupBakeComposite(nodeId: string, opts?: { delayMs?: number }) {
  const id = String(nodeId || '').trim();
  if (!id || typeof window === 'undefined') return;
  defer(() => {
    window.dispatchEvent(
      new CustomEvent(RCB_MOCKUP_BAKE_COMPOSITE, {
        detail: { nodeId: id, delayMs: opts?.delayMs },
      })
    );
  });
}

export function requestTimelineCameraFit(opts?: { afterPaint?: boolean }) {
  if (typeof window === 'undefined') return;
  const fire = () => window.dispatchEvent(new CustomEvent(RCB_TIMELINE_CAMERA_FIT));
  defer(fire);
  if (opts?.afterPaint) defer(() => window.requestAnimationFrame(fire));
}

export function requestTimelineCameraRelease() {
  defer(() => window.dispatchEvent(new CustomEvent(RCB_TIMELINE_CAMERA_RELEASE)));
}

/** After AI DesignTransaction commit — one SoA + Canvas flush (not per tool_op). */
export function requestSoaAiFlush() {
  defer(() => window.dispatchEvent(new CustomEvent(RCB_SOA_AI_FLUSH)));
}
