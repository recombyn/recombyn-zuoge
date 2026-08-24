import { useMemo, type ReactNode, memo } from 'react';
import { useSelector } from 'react-redux';
import {
  isAudioGeneratorNode,
  shouldShowGeneratorComposer,
} from '@/components/rcb/scene/document/nodeCapabilities';
import { nodeLeftTop } from '@/components/rcb/scene/paint/sceneToSvg';
import AudioGeneratorCard from '@/components/editor/nodes/AudioGeneratorNode/AudioGeneratorCard';
import { EMPTY_ID_LIST } from '@/store/modules/editor';
import type { SceneDocument } from '@/components/rcb/sceneNode';

export type AudioGenGeomOverride = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * World-layer Audio Generator composers (same lattice as video / Lottie generators).
 */
function AudioGeneratorOverlay({
  document,
  readOnly,
  geometryOverrides = null,
}: {
  document: SceneDocument;
  readOnly?: boolean;
  geometryOverrides?: Record<string, AudioGenGeomOverride> | null;
}): ReactNode {
  const selectedNodeIds: string[] = useSelector(
    (state: any) => (state.editor.selectedNodeIds as string[]) ?? EMPTY_ID_LIST
  );
  const ids = useMemo(() => {
    const children: string[] = document?.deltaSetLike?.ROOT?.children || [];
    return children.filter((id) => isAudioGeneratorNode(document?.deltaSetLike?.[id]));
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
          <AudioGeneratorCard
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
            })}
            disabled={readOnly}
          />
        );
      })}
    </div>
  );
}

export default memo(AudioGeneratorOverlay);
