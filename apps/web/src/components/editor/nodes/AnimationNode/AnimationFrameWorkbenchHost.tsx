/**
 * 动画工作—session host — ensure playback media on explicit request.
 * Timeline opens only via explicit UI. Drawing tools stay on the bottom
 * EditorToolStrip. AI edits use the right-side Agent chat.
 */
import { memo, useEffect, type ReactNode } from 'react';
import { useDispatch } from '@/store';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import { ensureAnimationFrameMedia } from '@/store/modules/editor';
import {
  RCB_ENSURE_ANIMATION_FRAME,
  requestEnsureAnimationFrame,
} from '@/components/editor/sceneEvents';
import { isAnimationArtboardKind } from '@/components/rcb/frames/types';
import { resolveAnimationFrameId } from '@/components/editor/nodes/AnimationNode/resolveAnimationFrameId';
import store from '@/store';

function resolveWorkbenchFrameIdFromStore(): string | null {
  const editor = (store.getState() as { editor?: any }).editor;
  const document = editor?.document as SceneDocument | null | undefined;
  if (!document) return null;
  const frames = Array.isArray(document.frames) ? document.frames : [];
  const selectedFrameIds = (editor.selectedFrameIds as string[]) || [];
  const activeFrameId = String(editor.document?.activeFrameId || '');
  const selectedNodeIds = (editor.selectedNodeIds as string[]) || [];
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
}

function AnimationFrameWorkbenchHost({
  hidden = false,
}: {
  document: SceneDocument;
  hidden?: boolean;
}): ReactNode {
  const dispatch = useDispatch();

  useEffect(() => {
    if (hidden) return;
    const onEnsure = (e: Event) => {
      const detail = (e as CustomEvent<{ frameId?: string; skipHistory?: boolean }>).detail;
      const frameId = String(detail?.frameId || '').trim();
      if (!frameId) return;
      dispatch(
        ensureAnimationFrameMedia({
          frameId,
          skipHistory: Boolean(detail?.skipHistory),
        })
      );
    };
    window.addEventListener(RCB_ENSURE_ANIMATION_FRAME, onEnsure);
    // Initial apply for current selection (same pattern as playhead sync).
    const initial = resolveWorkbenchFrameIdFromStore();
    if (initial) requestEnsureAnimationFrame(initial);
    return () => window.removeEventListener(RCB_ENSURE_ANIMATION_FRAME, onEnsure);
  }, [dispatch, hidden]);

  return null;
}

export default memo(AnimationFrameWorkbenchHost);
