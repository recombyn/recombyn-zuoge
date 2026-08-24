import { useMemo, type ReactNode, memo } from 'react';
import { useSelector } from 'react-redux';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import {
  isQuickEditMarkPanel,
  type ImageToolPanelState,
} from '@/store/modules/editor';
import ImageQuickEditComposer from './ImageQuickEditComposer';
import { nodeSceneBox } from './mark/markGeometry';

/**
 * Image quick-edit composer — lives in stage world so mark box drags cannot
 * unmount it when selection chrome briefly clears.
 */
function ImageQuickEditSessionHost({
  document,
  hidden = false,
}: {
  document: SceneDocument;
  hidden?: boolean;
}): ReactNode {
  const panel = useSelector(
    (s: any) => s.editor.imageToolPanel as ImageToolPanelState | null
  );
  const nodeId = panel?.nodeId;
  const node = nodeId ? document?.deltaSetLike?.[nodeId] : null;
  const kind = node?.key || 'shape';

  const open = useMemo(() => {
    if (!panel || !nodeId || kind !== 'image') return false;
    if (panel.kind === 'quickEdit') return true;
    return isQuickEditMarkPanel(panel, nodeId, kind);
  }, [panel, nodeId, kind]);

  const nodeProcessing = String(node?.attrs?.processStatus || '') === 'running';

  const box = useMemo(
    () => (open && node ? nodeSceneBox(document, node) : null),
    [document, node, open]
  );

  if (!open || !nodeId || !box || hidden || nodeProcessing) return null;

  return (
    <ImageQuickEditComposer document={document} nodeId={nodeId} box={box} />
  );
}

export default memo(ImageQuickEditSessionHost);
