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

/**
 * World-layer Image Generator composers (same lattice as the control box).
 * SVG keeps the hit target; the title row comes from the shared selection label.
 */
function ImageGeneratorOverlay({
  document,
  hidden,
  readOnly,
}: {
  document: SceneDocument;
  /** Hide while move / resize / rotate is in progress. */
  hidden?: boolean;
  readOnly?: boolean;
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

  // Keep cards mounted while transforming — local + attr state must survive hide.
  return (
    <div
      className={hidden ? 'pointer-events-none invisible' : undefined}
      aria-hidden={hidden || undefined}
    >
      {ids.map((nodeId) => {
        const node = document?.deltaSetLike?.[nodeId];
        if (!node) return null;
        const { left, top } = nodeLeftTop(document, node);
        const width = Math.max(1, Number(node.width) || 1);
        const height = Math.max(1, Number(node.height) || 1);
        return (
          <ImageGeneratorCard
            key={nodeId}
            nodeId={nodeId}
            sceneBox={{ x: left, y: top, width, height }}
            showComposer={shouldShowGeneratorComposer({
              node,
              hidden,
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
