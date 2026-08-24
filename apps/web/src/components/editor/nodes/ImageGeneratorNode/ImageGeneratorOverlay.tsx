import { useMemo, type ReactNode, memo } from 'react';
import { useSelector } from 'react-redux';
import {
  isImageGeneratorNode,
  shouldShowGeneratorComposer,
} from '@/components/rcb/scene/document/nodeCapabilities';
import { nodeLeftTop } from '@/components/rcb/scene/paint/sceneToSvg';
import ImageGeneratorCard from '@/components/editor/nodes/ImageGeneratorNode/ImageGeneratorCard';
import { EMPTY_ID_LIST, isCanvasAttachForNode } from '@/store/modules/editor';
import type { SceneDocument } from '@/components/rcb/sceneNode';

export type ImageGenGeomOverride = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * World-layer Image Generator composers (same lattice as the control box).
 * SVG keeps the hit target; the title row comes from the shared selection label.
 * `geometryOverrides` keeps the plate glued to chrome while Redux is still on
 * the pre-gesture document.
 */
function ImageGeneratorOverlay({
  document,
  readOnly,
  geometryOverrides = null,
}: {
  document: SceneDocument;
  readOnly?: boolean;
  geometryOverrides?: Record<string, ImageGenGeomOverride> | null;
}): ReactNode {
  const selectedNodeIds: string[] = useSelector(
    (state: any) => (state.editor.selectedNodeIds as string[]) ?? EMPTY_ID_LIST
  );
  const canvasAttachPick = useSelector(
    (state: any) => state.editor.canvasAttachPick as null | { target: string }
  );
  const pendingCanvasAttach = useSelector(
    (state: any) =>
      state.editor.pendingCanvasAttach as null | { target: string; payload: string | string[] }
  );
  const ids = useMemo(() => {
    const children: string[] = document?.deltaSetLike?.ROOT?.children || [];
    return children.filter((id) => isImageGeneratorNode(document?.deltaSetLike?.[id]));
  }, [document]);

  if (!ids.length) return null;

  return (
    <div>
      {ids.map((nodeId) => {
        const node = document?.deltaSetLike?.[nodeId];
        if (!node) return null;
        const { left, top } = nodeLeftTop(document, node);
        const ov = geometryOverrides?.[nodeId];
        const width = Math.max(1, ov ? ov.width : Number(node.width) || 1);
        const height = Math.max(1, ov ? ov.height : Number(node.height) || 1);
        return (
          <ImageGeneratorCard
            key={nodeId}
            nodeId={nodeId}
            sceneBox={{
              x: ov ? ov.left : left,
              y: ov ? ov.top : top,
              width,
              height,
            }}
            showComposer={shouldShowGeneratorComposer({
              node,
              selected: selectedNodeIds.length === 1 && selectedNodeIds[0] === nodeId,
              attachPickActive: isCanvasAttachForNode(
                nodeId,
                canvasAttachPick,
                pendingCanvasAttach
              ),
            })}
            disabled={readOnly}
          />
        );
      })}
    </div>
  );
}

export default memo(ImageGeneratorOverlay);
