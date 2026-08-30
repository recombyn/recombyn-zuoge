/**
 * Scrub playhead → live-update 动画工作台 scene children
 * (pos / scale / rotation / opacity / skew / roundness).
 * Frame-host lottie-web is hidden; children are the visible ink.
 *
 * Host = timeline panel OR undocked play session → full geometry pose.
 * No host: ink in/out at Redux playhead; do **not** seek(0) — pause / end
 * must leave the playhead where it is.
 */
import { useEffect, useRef, type ReactNode, memo } from 'react';
import { useSelector } from 'react-redux';
import { isAnimationFrameHostNode } from '@/components/rcb/scene/document/nodeCapabilities';
import { applyAnimationPlayheadScenePose } from '@/components/editor/nodes/AnimationNode/animationPlayheadSceneApply';
import {
  setAnimationWorkbenchPlayheadSec,
} from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';
import { resolveLottiePlayheadHostId } from '@/components/editor/nodes/AnimationNode/resolveLottiePlayheadHostId';
import type { SceneDocument } from '@/components/rcb/sceneNode';

function listAnimationFrameHostIds(document: SceneDocument | null | undefined): string[] {
  const out: string[] = [];
  const map = document?.deltaSetLike;
  if (!map) return out;
  for (const id of Object.keys(map)) {
    if (id === 'ROOT') continue;
    const node = map[id];
    if (node?.key === 'lottie' && isAnimationFrameHostNode(node, document)) {
      out.push(id);
    }
  }
  return out;
}

function AnimationPlayheadSceneSync({
  document,
}: {
  document: SceneDocument;
}): ReactNode {
  const playhead = useSelector((s: any) => Number(s.editor.lottiePlayheadSec) || 0);
  const hostNodeId = useSelector((s: any) => resolveLottiePlayheadHostId(s.editor));
  const host = hostNodeId ? document?.deltaSetLike?.[hostNodeId] : null;
  const primaryActive =
    Boolean(host) &&
    host?.key === 'lottie' &&
    isAnimationFrameHostNode(host, document);

  const lastAppliedRef = useRef('');

  // Module playhead always mirrors Redux — hit-test uses the same gate open or closed.
  useEffect(() => {
    setAnimationWorkbenchPlayheadSec(playhead);
  }, [playhead]);

  useEffect(() => {
    if (primaryActive && hostNodeId) {
      lastAppliedRef.current = applyAnimationPlayheadScenePose({
        document,
        hostNodeId,
        playheadSec: playhead,
        applyGeometry: true,
      });
      return;
    }

    // Resting / no session host: ink at current playhead, geometry from document.
    // Never seek hosts to 0 here — that made pause/end jump to the start.
    const hosts = listAnimationFrameHostIds(document);
    let last = '';
    for (const id of hosts) {
      last = applyAnimationPlayheadScenePose({
        document,
        hostNodeId: id,
        playheadSec: playhead,
        applyGeometry: false,
      });
    }
    lastAppliedRef.current = last;
  }, [primaryActive, document, hostNodeId, playhead]);

  return null;
}

export default memo(AnimationPlayheadSceneSync);
