/**
 * Workbench sessions for Lottie 合成台 — quick-edit composer on the plate.
 * Timeline UI lives in LottieTimelineDock (bottom canvas dock).
 */
import { memo, useEffect, useMemo, type ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import LottieQuickEditComposer from '@/components/editor/nodes/LottieNode/LottieQuickEditComposer';
import { findFrameLottieMediaId } from '@/components/editor/nodes/LottieNode/resolveLottieFrameId';
import { ensureLottieFrameMedia } from '@/store/modules/editor';

function LottieFrameWorkbenchHost({
  document,
  hidden = false,
}: {
  document: SceneDocument;
  hidden?: boolean;
}): ReactNode {
  const dispatch = useDispatch();
  const panel = useSelector(
    (s: any) =>
      s.editor.lottieFramePanel as null | { frameId: string; kind: 'quickEdit' | 'timeline' }
  );

  const frames = Array.isArray(document?.frames) ? document.frames : [];
  const frame = panel ? frames.find((f: any) => String(f?.id) === panel.frameId) : null;

  useEffect(() => {
    if (!panel?.frameId || panel.kind !== 'quickEdit') return;
    dispatch(ensureLottieFrameMedia({ frameId: panel.frameId }));
  }, [dispatch, panel?.frameId, panel?.kind]);

  const mediaId = useMemo(
    () => (panel ? findFrameLottieMediaId(document, panel.frameId) : null),
    [document, panel]
  );

  if (hidden || !panel || !frame || panel.kind !== 'quickEdit') return null;
  if (!mediaId) return null;

  const box = {
    left: Number(frame.x) || 0,
    top: Number(frame.y) || 0,
    width: Math.max(1, Number(frame.width) || 1),
    height: Math.max(1, Number(frame.height) || 1),
  };
  return <LottieQuickEditComposer document={document} nodeId={mediaId} box={box} />;
}

export default memo(LottieFrameWorkbenchHost);
