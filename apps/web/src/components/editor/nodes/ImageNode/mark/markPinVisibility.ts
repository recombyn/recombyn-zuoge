import type { ImageMarkPin, ImageToolPanelState } from '@/store/modules/editor';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import { nodeSceneBox, type SceneBox } from './markGeometry';
import { markPinsForNode } from './markPinStore';

export type VisibleMarkPin = {
  nodeId: string;
  pin: ImageMarkPin;
  box: SceneBox;
};

export function listVisibleMarkPins(
  document: SceneDocument,
  pins: Record<string, ImageMarkPin | ImageMarkPin[]>,
  panel: ImageToolPanelState | null | undefined,
  selectedIds: string[],
  hidden = false
): VisibleMarkPin[] {
  if (hidden) return [];
  const out: VisibleMarkPin[] = [];
  for (const nodeId of selectedIds) {
    const list = markPinsForNode(pins, nodeId);
    if (!list.length) continue;
    const node = document?.deltaSetLike?.[nodeId];
    if (!node || node.key !== 'image') continue;
    const box = nodeSceneBox(document, node);
    if (!box) continue;
    for (const pin of list) {
      out.push({ nodeId, pin, box });
    }
  }
  return out;
}
