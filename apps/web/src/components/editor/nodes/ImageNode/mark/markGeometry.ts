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

/** All image plates in mark mode — markable nodes + blocked overlays (processing / generator). */
export function listMarkSessionTargets(document: SceneDocument): MarkSessionTarget[] {
  const out: MarkSessionTarget[] = [];
  const dsl = document?.deltaSetLike || {};
  for (const nodeId of Object.keys(dsl)) {
    const node = dsl[nodeId];
    if (node?.key !== 'image') continue;
    const box = nodeSceneBox(document, node);
    if (!box) continue;

    const processing = String(node?.attrs?.processStatus || '') === 'running';
    const hasSrc = Boolean(String(node?.attrs?.src || '').trim());

    if (processing) {
      out.push({ nodeId, box, node, blocked: true });
      continue;
    }

    if (!hasSrc) {
      if (isImageGeneratorNode(node)) {
        out.push({ nodeId, box, node, blocked: true });
      }
      continue;
    }

    out.push({ nodeId, box, node, blocked: false });
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
