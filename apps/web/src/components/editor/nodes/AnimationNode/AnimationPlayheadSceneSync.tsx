/**
 * Scrub playhead → live-update 动画工作台 scene children
 * (pos / scale / rotation / opacity / skew / roundness).
 * Frame-host lottie-web is hidden; children are the visible ink.
 *
 * Host = timeline panel OR undocked play session → full geometry pose.
 * Playing a non-workbench plate must not scrub other workbenches.
 * No host: ink in/out at Redux playhead; do **not** seek(0) — pause / end
 * must leave the playhead where it is.
 */
import { useLayoutEffect, useEffect, useRef, type ReactNode, memo } from 'react';
import { flushSync } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { isAnimationFrameHostNode } from '@/components/rcb/scene/document/nodeCapabilities';
import {
  applyAnimationPlayheadScenePose,
  collectPrecompSessionDocumentPatches,
} from '@/components/editor/nodes/AnimationNode/animationPlayheadSceneApply';
import {
  setAnimationWorkbenchPlayheadSec,
} from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';
import { resolveLottiePlayheadHostId } from '@/components/editor/nodes/AnimationNode/resolveLottiePlayheadHostId';
import { patchDocumentNodes } from '@/store/modules/editor';
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
  const dispatch = useDispatch();
  const playhead = useSelector((s: any) => Number(s.editor.lottiePlayheadSec) || 0);
  const playing = useSelector((s: any) => Boolean(s.editor.lottiePlaying));
  const playingHostId = useSelector((s: any) =>
    String(s.editor.lottiePlayingHostId || '').trim()
  );
  const selectedNodeIds = useSelector(
    (s: any) => (s.editor.selectedNodeIds as string[]) || []
  );
  const precompEdit = useSelector(
    (s: any) =>
      s.editor.lottiePrecompEdit as null | {
        sessionNodeIds?: string[];
      }
  );
  const hostNodeId = useSelector((s: any) => resolveLottiePlayheadHostId(s.editor));
  const host = hostNodeId ? document?.deltaSetLike?.[hostNodeId] : null;
  const primaryActive =
    Boolean(host) &&
    host?.key === 'lottie' &&
    isAnimationFrameHostNode(host, document);

  const lastAppliedRef = useRef('');
  const lastDocSyncSigRef = useRef('');
  const prevSelectedRef = useRef<string[]>([]);

  // Module playhead always mirrors Redux — hit-test uses the same gate open or closed.
  useEffect(() => {
    setAnimationWorkbenchPlayheadSec(playhead);
  }, [playhead]);

  useLayoutEffect(() => {
    if (primaryActive && hostNodeId) {
      lastAppliedRef.current = applyAnimationPlayheadScenePose({
        document,
        hostNodeId,
        playheadSec: playhead,
        applyGeometry: true,
      });
      // Freeze sibling workbenches at document geometry (do not scrub with this playhead).
      for (const id of listAnimationFrameHostIds(document)) {
        if (id === hostNodeId) continue;
        applyAnimationPlayheadScenePose({
          document,
          hostNodeId: id,
          playheadSec: 0,
          applyGeometry: false,
        });
      }

      // LOT tab: keep document poses aligned with the playhead so selecting another
      // shape cannot repaint siblings from materialize-time geometry.
      if (!playing && precompEdit?.sessionNodeIds?.length) {
        const selectionChanged =
          selectedNodeIds.join('\0') !== prevSelectedRef.current.join('\0');
        prevSelectedRef.current = selectedNodeIds;
        const patches = collectPrecompSessionDocumentPatches({
          document,
          hostNodeId,
          playheadSec: playhead,
        });
        const sig = patches
          .map(
            (p) =>
              `${p.nodeId}:${p.patch.x},${p.patch.y},${p.patch.width},${p.patch.height},${String(p.patch.attrs?.angle)}`
          )
          .join('|');
        if (patches.length && (sig !== lastDocSyncSigRef.current || selectionChanged)) {
          lastDocSyncSigRef.current = sig;
          flushSync(() => {
            dispatch(
              patchDocumentNodes({
                patches,
                skipHistory: true,
              })
            );
          });
        } else if (!sig) {
          lastDocSyncSigRef.current = '';
        }
      } else {
        prevSelectedRef.current = selectedNodeIds;
      }
      return;
    }

    lastDocSyncSigRef.current = '';

    // Playing a free LOT / non-frame host: keep workbench poses resting.
    const playingNode = playingHostId ? document?.deltaSetLike?.[playingHostId] : null;
    const foreignPlay =
      playing &&
      playingHostId &&
      playingNode?.key === 'lottie' &&
      !isAnimationFrameHostNode(playingNode, document);

    const hosts = listAnimationFrameHostIds(document);
    let last = '';
    for (const id of hosts) {
      last = applyAnimationPlayheadScenePose({
        document,
        hostNodeId: id,
        playheadSec: foreignPlay ? 0 : playhead,
        applyGeometry: false,
      });
    }
    lastAppliedRef.current = last;
  }, [
    primaryActive,
    document,
    hostNodeId,
    playhead,
    playing,
    playingHostId,
    selectedNodeIds,
    precompEdit?.sessionNodeIds,
    dispatch,
  ]);

  return null;
}

export default memo(AnimationPlayheadSceneSync);
