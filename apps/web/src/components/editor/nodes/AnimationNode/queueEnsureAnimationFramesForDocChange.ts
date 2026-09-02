/**
 * Queue timeline bake when 动画工作台 child membership / bake-relevant
 * geometry changes. Geometry commits often use skipHistory patches (no store
 * ensure); create/move-out then left the layer list stale until an unrelated
 * drag keyed the host.
 *
 * Do not blind-force ensure on every focused-timeline document write — large
 * LOT JSON serialize freezes the page. Gate on a bake signature instead.
 */
import type { SceneDocument } from '@/components/rcb/sceneNode';
import { queueEnsureAnimationFrame } from '@/components/editor/sceneEvents';
import { getAnimationWorkbenchTimelineFocus } from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';
import { resolveAnimationFrameId } from '@/components/editor/nodes/AnimationNode/resolveAnimationFrameId';
import { isAnimationFrameHostNode } from '@/components/rcb/scene/document/nodeCapabilities';

/** Attrs that do not change timeline layer bake / clip JSON. */
const BAKE_IGNORE_ATTR_KEYS = new Set([
  'processStatus',
  'processKind',
  'processLabel',
  'processProgress',
  'processError',
  'processJobId',
  'processSourceId',
  'processTargetWidth',
  'processTargetHeight',
  'lottieInkRevision',
]);

function roundBake(n: unknown): number {
  return Math.round(Number(n) || 0);
}

/** Stable per-child fingerprint for timeline host sync. */
function childBakePart(
  id: string,
  node: {
    key?: unknown;
    x?: unknown;
    y?: unknown;
    width?: unknown;
    height?: unknown;
    attrs?: Record<string, unknown> | null;
  }
): string {
  const a = node.attrs || {};
  return [
    id,
    String(node.key || ''),
    roundBake(node.x),
    roundBake(node.y),
    roundBake(node.width),
    roundBake(node.height),
    String(a.name || ''),
    String(a.src || ''),
    String(a['fill-color'] || ''),
    String(a.angle || ''),
    String(a.opacity || ''),
    String(a.skewX ?? a.skew ?? ''),
    String(a.skewAxis ?? a.skewY ?? ''),
    String(a.cornerRadius || ''),
    String(a.anchorPreset || ''),
    String(a.blendMode || ''),
    String(a.lockAspect || ''),
    String(a.frameOrder ?? ''),
    String(a.lottieInFrame ?? ''),
    String(a.lottieOutFrame ?? ''),
    String(a.puppetEnabled || ''),
    String(a.puppetDensity || ''),
    // Nested LOT ink — length only (full JSON already owned by the child plate).
    String(a.animationData || '').length,
  ].join(':');
}

/**
 * Membership + geometry + style signature for one 动画工作台.
 * Host node is included so create/delete of the invisible media plate is seen.
 */
export function frameBakeSignature(
  doc: SceneDocument | null | undefined,
  frameId: string
): string {
  const wanted = String(frameId || '').trim();
  if (!doc?.deltaSetLike || !wanted) return '';
  const parts: string[] = [];
  for (const [id, node] of Object.entries(doc.deltaSetLike)) {
    if (id === 'ROOT' || !node) continue;
    if (String(node.attrs?.frameId || '').trim() !== wanted) continue;
    parts.push(childBakePart(id, node));
  }
  parts.sort();
  return parts.join('|');
}

/**
 * True when a node patch should refresh the workbench host animationData.
 * Host `animationData` writes are bake *output* — never re-ensure those.
 */
export function nodePatchNeedsTimelineBake(
  patch: unknown,
  node?: { key?: unknown; attrs?: Record<string, unknown> | null } | null,
  document?: SceneDocument | null
): boolean {
  if (!patch || typeof patch !== 'object') return false;
  if (
    node &&
    document &&
    isAnimationFrameHostNode(
      { key: String(node.key || ''), attrs: node.attrs || undefined },
      document
    )
  ) {
    const p = patch as Record<string, unknown>;
    const attrs = p.attrs;
    const attrKeys =
      attrs && typeof attrs === 'object' ? Object.keys(attrs as object) : [];
    const onlyHostInk =
      attrKeys.length > 0 &&
      attrKeys.every((k) => k === 'animationData' || BAKE_IGNORE_ATTR_KEYS.has(k)) &&
      !('x' in p) &&
      !('y' in p) &&
      !('width' in p) &&
      !('height' in p) &&
      !('key' in p);
    if (onlyHostInk) return false;
  }
  const p = patch as Record<string, unknown>;
  if ('x' in p || 'y' in p || 'width' in p || 'height' in p || 'key' in p) return true;
  const attrs = p.attrs;
  if (!attrs || typeof attrs !== 'object') return false;
  for (const key of Object.keys(attrs as Record<string, unknown>)) {
    if (BAKE_IGNORE_ATTR_KEYS.has(key)) continue;
    return true;
  }
  return false;
}

/**
 * Ensure every animation frame whose bake signature changed between `before`
 * and `after`. `includeFocus` only adds the open timeline frame to the scan
 * set — it does **not** force a bake when the signature is unchanged.
 */
export function queueEnsureAnimationFramesForDocChange(
  before: SceneDocument | null | undefined,
  after: SceneDocument | null | undefined,
  opts?: {
    /** Limit scan to these node ids (and their before/after frameIds). */
    nodeIds?: readonly string[];
    /**
     * Include the open timeline focus frame in the candidate set.
     * Bake still requires a signature change.
     */
    includeFocus?: boolean;
    skipHistory?: boolean;
  }
): void {
  if (!after) return;
  const frames = new Set<string>();
  const focus = String(getAnimationWorkbenchTimelineFocus() || '').trim();
  if (opts?.includeFocus && focus) frames.add(focus);

  if (opts?.nodeIds?.length) {
    for (const raw of opts.nodeIds) {
      const id = String(raw || '').trim();
      if (!id) continue;
      const b = resolveAnimationFrameId(before, before?.deltaSetLike?.[id]);
      const a = resolveAnimationFrameId(after, after?.deltaSetLike?.[id]);
      if (b) frames.add(b);
      if (a) frames.add(a);
    }
  } else {
    for (const doc of [before, after]) {
      if (!doc?.deltaSetLike) continue;
      for (const [id, node] of Object.entries(doc.deltaSetLike)) {
        if (id === 'ROOT') continue;
        const fid = resolveAnimationFrameId(doc, node);
        if (fid) frames.add(fid);
      }
    }
  }

  const skipHistory = opts?.skipHistory !== false;
  for (const fid of frames) {
    if (frameBakeSignature(before, fid) === frameBakeSignature(after, fid)) continue;
    queueEnsureAnimationFrame(fid, { skipHistory });
  }
}
