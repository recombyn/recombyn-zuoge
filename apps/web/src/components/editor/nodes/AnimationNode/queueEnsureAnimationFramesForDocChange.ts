/**
 * Queue timeline bake when 动画工作台 child membership changes.
 * Geometry commits often use skipHistory patches (no ensure); create/move-out
 * then left the layer list stale until an unrelated drag keyed the host.
 */
import type { SceneDocument } from '@/components/rcb/sceneNode';
import { queueEnsureAnimationFrame } from '@/components/editor/sceneEvents';
import { getAnimationWorkbenchTimelineFocus } from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';
import { resolveAnimationFrameId } from '@/components/editor/nodes/AnimationNode/resolveAnimationFrameId';

function frameChildKey(doc: SceneDocument | null | undefined, frameId: string): string {
  if (!doc?.deltaSetLike || !frameId) return '';
  const ids: string[] = [];
  for (const [id, node] of Object.entries(doc.deltaSetLike)) {
    if (id === 'ROOT' || !node) continue;
    if (String(node.attrs?.frameId || '').trim() === frameId) ids.push(id);
  }
  ids.sort();
  return ids.join('\0');
}

/**
 * Ensure every animation frame whose bound children changed between `before`
 * and `after`. Always includes the open timeline focus frame when membership
 * of that frame changed (or when `forceFocus` is set).
 */
export function queueEnsureAnimationFramesForDocChange(
  before: SceneDocument | null | undefined,
  after: SceneDocument | null | undefined,
  opts?: {
    /** Limit scan to these node ids (and their before/after frameIds). */
    nodeIds?: readonly string[];
    /** Refresh focused timeline even when child set looks unchanged. */
    forceFocus?: boolean;
    skipHistory?: boolean;
  }
): void {
  if (!after) return;
  const frames = new Set<string>();
  const focus = String(getAnimationWorkbenchTimelineFocus() || '').trim();
  if (focus) frames.add(focus);

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
    const changed = frameChildKey(before, fid) !== frameChildKey(after, fid);
    if (!changed && !(opts?.forceFocus && fid === focus)) continue;
    queueEnsureAnimationFrame(fid, { skipHistory });
  }
}
