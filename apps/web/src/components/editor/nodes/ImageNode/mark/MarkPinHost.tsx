import { useMemo, type ReactNode, memo } from 'react';
import { useSelector } from 'react-redux';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import type { ImageMarkPin, ImageToolPanelState } from '@/store/modules/editor';
import MarkPinOverlay from './MarkPinOverlay';
import { listVisibleMarkPins } from './markPinVisibility';

function MarkPinHost({
  document,
  hidden = false,
}: {
  document: SceneDocument;
  hidden?: boolean;
}): ReactNode {
  const pins = useSelector(
    (s: any) =>
      (s.editor.imageMarkPins || {}) as Record<string, ImageMarkPin | ImageMarkPin[]>
  );
  const panel = useSelector(
    (s: any) => s.editor.imageToolPanel as ImageToolPanelState | null
  );
  const selectedIds = useSelector(
    (s: any) => (s.editor.selectedNodeIds || []) as string[]
  );

  const visible = useMemo(
    () => listVisibleMarkPins(document, pins, panel, selectedIds, hidden),
    [document, pins, panel, selectedIds, hidden]
  );

  if (!visible.length) return null;

  return (
    <>
      {visible.map(({ nodeId, pin, box }) => (
        <MarkPinOverlay key={`${nodeId}:${pin.id}`} nodeId={nodeId} pin={pin} imageBox={box} />
      ))}
    </>
  );
}

export default memo(MarkPinHost);
