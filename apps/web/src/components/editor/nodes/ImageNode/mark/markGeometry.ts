import { rcbSceneToScreen, type RcbCamera } from '@/components/rcb';
import { nodeLeftTop } from '@/components/rcb/scene/paint/sceneToSvg';
import type { SceneDocument, SceneNodeInput } from '@/components/rcb/sceneNode';
import type { MarkRegion } from './MarkRegionOverlay';

export type SceneBox = { left: number; top: number; width: number; height: number };

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
  const out: Array<{ nodeId: string; box: SceneBox; node: SceneNodeInput }> = [];
  const dsl = document?.deltaSetLike || {};
  for (const nodeId of Object.keys(dsl)) {
    const node = dsl[nodeId];
    if (node?.key !== 'image') continue;
    if (!String(node.attrs?.src || '').trim()) continue;
    const box = nodeSceneBox(document, node);
    if (!box) continue;
    out.push({ nodeId, box, node });
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
