import type { ImageMarkPin, ImageToolPanelState } from '@/store/modules/editor';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import { nodeSceneBox, type SceneBox } from './markGeometry';

export type VisibleMarkPin = {
  nodeId: string;
  pin: ImageMarkPin;
  box: SceneBox;
};

export function listVisibleMarkPins(
  document: SceneDocument,
  pins: Record<string, ImageMarkPin>,
  panel: ImageToolPanelState | null | undefined,
  selectedIds: string[]
): VisibleMarkPin[] {
  const out: VisibleMarkPin[] = [];
  for (const nodeId of selectedIds) {
    if (panel?.nodeId === nodeId && panel?.kind === 'mark') continue;
    const pin = pins[nodeId];
    if (!pin) continue;
    const node = document?.deltaSetLike?.[nodeId];
    if (!node || node.key !== 'image') continue;
    const box = nodeSceneBox(document, node);
    if (!box) continue;
    out.push({ nodeId, pin, box });
  }
  return out;
}
