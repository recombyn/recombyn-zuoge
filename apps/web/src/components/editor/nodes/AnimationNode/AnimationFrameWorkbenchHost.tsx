/**
 * 动画工作台 session host — ensure playback media on explicit request.
 * Timeline opens only via explicit UI. Drawing tools stay on the bottom
 * EditorToolStrip. AI edits use the right-side Agent chat.
 *
 * The ensure listener must stay registered during selection transforms.
 * Hiding/tearing it down dropped `queueEnsureAnimationFrame` microtasks from
 * draw/drop/bind commits, so 「图层」 only caught up after the next drag.
 *
 * Do NOT re-ensure on every `document` identity change — open/playhead/patch
 * all swap the document ref, and ensure serializes the full host JSON. That
 * loop is what froze the page on Keyframes open for large LOT plates.
 */
import { memo, useEffect, type ReactNode } from 'react';

import type { SceneDocument } from '@/components/rcb/sceneNode';
import { ensureAnimationFrameMedia, patchDocumentNode } from '@/store/modules/editor';
import {
  RCB_ENSURE_ANIMATION_FRAME,
  RCB_IDLE_ANIMATION_HOST_JSON,
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
  const frameIds = [
    ...selectedFrameIds.map(String),
    ...(activeFrameId ? [activeFrameId] : []),
  ];
  for (const id of frameIds) {
    const frame = frames.find((f: any) => String(f?.id) === id);
    if (frame && isAnimationArtboardKind(frame.kind)) return id;
  }
  const selectedNodeIds = (editor.selectedNodeIds as string[]) || [];
  for (const nodeId of selectedNodeIds) {
    const fid = resolveAnimationFrameId(document, document?.deltaSetLike?.[nodeId]);
    if (fid) return fid;
  }
  return null;
}

function onEnsureAnimationFrame(e: Event) {
  const detail = (e as CustomEvent<{ frameId?: string; skipHistory?: boolean }>).detail;
  const frameId = String(detail?.frameId || '').trim();
  if (!frameId) return;
  ensureAnimationFrameMedia({
    frameId,
    skipHistory: Boolean(detail?.skipHistory),
  });
}

function onIdleAnimationHostJson(e: Event) {
  const detail = (
    e as CustomEvent<{ hostId?: string; animationJson?: string }>
  ).detail;
  const hostId = String(detail?.hostId || '').trim();
  const animationJson = String(detail?.animationJson || '');
  if (!hostId || !animationJson) return;
  patchDocumentNode({
    nodeId: hostId,
    patch: { attrs: { animationData: animationJson } },
    skipHistory: true,
    skipHostReload: true,
  });
}

function AnimationFrameWorkbenchHost({
  hidden = false,
}: {
  /** Kept for call-site compatibility; host reads live doc from the store. */
  document?: SceneDocument;
  hidden?: boolean;
}): ReactNode {
  // Process-lifetime listener — never gate on `hidden` / selectionTransforming.
  useEffect(() => {
    window.addEventListener(RCB_ENSURE_ANIMATION_FRAME, onEnsureAnimationFrame);
    window.addEventListener(RCB_IDLE_ANIMATION_HOST_JSON, onIdleAnimationHostJson);
    return () => {
      window.removeEventListener(RCB_ENSURE_ANIMATION_FRAME, onEnsureAnimationFrame);
      window.removeEventListener(RCB_IDLE_ANIMATION_HOST_JSON, onIdleAnimationHostJson);
    };
  }, []);

  // Only when the host becomes visible again (selection transform ends).
  // Membership bake is owned by queueEnsureAnimationFramesForDocChange /
  // openLottieTimelinePanel — not by watching every document swap.
  useEffect(() => {
    if (hidden) return;
    const initial = resolveWorkbenchFrameIdFromStore();
    if (initial) requestEnsureAnimationFrame(initial, { skipHistory: true });
  }, [hidden]);

  return null;
}

export default memo(AnimationFrameWorkbenchHost);
