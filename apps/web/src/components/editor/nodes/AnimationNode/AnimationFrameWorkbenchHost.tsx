/**
 * 动画工作台 session host — ensure playback media exists while the board
 * (or its children) is selected. Timeline opens only via explicit UI.
 * Drawing tools stay on the bottom EditorToolStrip (same as artboards).
 * AI edits use the right-side Agent chat (no on-canvas quick-edit composer).
 */
import { memo, useEffect, useMemo, type ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import { isAnimationArtboardKind } from '@/components/rcb/frames/types';
import {
  resolveAnimationFrameId,
} from '@/components/editor/nodes/AnimationNode/resolveAnimationFrameId';
import { ensureAnimationFrameMedia } from '@/store/modules/editor';

function AnimationFrameWorkbenchHost({
  document,
  hidden = false,
}: {
  document: SceneDocument;
  hidden?: boolean;
}): ReactNode {
  const dispatch = useDispatch();
  const activeFrameId = useSelector((s: any) =>
    String(s.editor.document?.activeFrameId || '')
  );
  const selectedFrameIds = useSelector(
    (s: any) => (s.editor.selectedFrameIds as string[]) || []
  );
  const selectedNodeIds = useSelector(
    (s: any) => (s.editor.selectedNodeIds as string[]) || []
  );

  const frames = Array.isArray(document?.frames) ? document.frames : [];

  /** Animation board in context: frame selected, or a child node on that board. */
  const workbenchFrameId = useMemo(() => {
    const frameIds = [
      ...selectedFrameIds.map(String),
      ...(activeFrameId ? [activeFrameId] : []),
    ];
    for (const id of frameIds) {
      const frame = frames.find((f: any) => String(f?.id) === id);
      if (frame && isAnimationArtboardKind(frame.kind)) return id;
    }
    for (const nodeId of selectedNodeIds) {
      const fid = resolveAnimationFrameId(document, document?.deltaSetLike?.[nodeId]);
      if (fid) return fid;
    }
    return null;
  }, [activeFrameId, document, frames, selectedFrameIds, selectedNodeIds]);

  useEffect(() => {
    if (hidden || !workbenchFrameId) return;
    dispatch(ensureAnimationFrameMedia({ frameId: workbenchFrameId }));
  }, [dispatch, hidden, workbenchFrameId]);

  return null;
}

export default memo(AnimationFrameWorkbenchHost);
