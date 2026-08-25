import { rcbSceneToScreen, type RcbCamera } from '@/components/rcb';
import { nodeLeftTop } from '@/components/rcb/scene/paint/sceneToSvg';
import { isImageGeneratorNode } from '@/components/rcb/scene/document/nodeCapabilities';
import type { SceneDocument, SceneNodeInput } from '@/components/rcb/sceneNode';
import type { MarkRegion } from './MarkRegionOverlay';

export type SceneBox = { left: number; top: number; width: number; height: number };

export type MarkSessionTarget = {
  nodeId: string;
  box: SceneBox;
  node: SceneNodeInput;
  /** True → overlay present but box drawing blocked (not-allowed cursor only). */
  blocked: boolean;
};

const MARK_BLOCKED_MEDIA = new Set(['video', 'audio', 'lottie']);

export function isMarkBlockedMediaKey(key: unknown): boolean {
  return MARK_BLOCKED_MEDIA.has(String(key || ''));
}

export function nodeSceneBox(
  document: SceneDocument,
  node: SceneNodeInput | null | undefined
): SceneBox | null {
  if (!node) return null;
  const { left, top } = nodeLeftTop(document, node);
  return {
    left,
    top,
    width: Math.max(1, Number(node.width) || 1),
    height: Math.max(1, Number(node.height) || 1),
  };
}

export function listCanvasImageNodes(
  document: SceneDocument
): Array<{ nodeId: string; box: SceneBox; node: SceneNodeInput }> {
  return listMarkSessionTargets(document)
    .filter((t) => !t.blocked)
    .map(({ nodeId, box, node }) => ({ nodeId, box, node }));
}

function imageMarkBlocked(node: SceneNodeInput): boolean | null {
  if (String(node.attrs?.processStatus || '') === 'running') return true;
  const hasSrc = Boolean(String(node.attrs?.src || '').trim());
  if (hasSrc) return false;
  return isImageGeneratorNode(node) ? true : null;
}

/** Image plates + non-image media in mark mode.
 * Images: markable or blocked (processing / empty generator).
 * Video / audio / lottie: always blocked.
 */
export function listMarkSessionTargets(document: SceneDocument): MarkSessionTarget[] {
  const out: MarkSessionTarget[] = [];
  const dsl = document?.deltaSetLike || {};

  for (const nodeId of Object.keys(dsl)) {
    const node = dsl[nodeId];
    if (!node) continue;
    const key = String(node.key || '');
    const box = nodeSceneBox(document, node);
    if (!box) continue;

    if (isMarkBlockedMediaKey(key)) {
      out.push({ nodeId, box, node, blocked: true });
      continue;
    }
    if (key !== 'image') continue;

    const blocked = imageMarkBlocked(node);
    if (blocked == null) continue;
    out.push({ nodeId, box, node, blocked });
  }
  return out;
}

export function markPromptFixedStyle(
  camera: RcbCamera,
  box: SceneBox,
  region: Pick<MarkRegion, 'x' | 'y' | 'w'>
) {
  const center = rcbSceneToScreen(
    camera,
    box.left + region.x + region.w / 2,
    box.top + region.y
  );
  return {
    position: 'fixed' as const,
    left: center.x,
    top: Math.max(72, center.y - 52),
    transform: 'translate(-50%, -100%)',
    zIndex: 9998,
  };
}
