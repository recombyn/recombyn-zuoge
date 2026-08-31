/**
 * Shared playhead RAF — same path whether the timeline dock is open or not.
 * Dock UI only seeks/toggles; this advances `lottiePlayheadSec` while playing.
 */
import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useDispatch, useSelector } from '@/store';
import { parseLottieAnimationData } from '@/components/rcb/scene/document/nodeFactories';
import { isAnimationFrameHostNode } from '@/components/rcb/scene/document/nodeCapabilities';
import { getLottieHost } from '@/components/editor/nodes/AnimationNode/AnimationNodeOverlay';
import {
  buildLottieTimelineScenes,
  frameToSec,
  snapSecToFrame,
} from '@/components/editor/nodes/AnimationNode/animationTimelineModel';
import { resolveAnimationFrameId } from '@/components/editor/nodes/AnimationNode/resolveAnimationFrameId';
import { setLottiePlayhead, setLottiePlaying } from '@/store/modules/editor';
import { resolveLottiePlayheadHostId } from '@/components/editor/nodes/AnimationNode/resolveLottiePlayheadHostId';
import {
  useAnimationPlayheadSec,
  useAnimationPlaying,
} from '@/components/editor/nodes/AnimationNode/animationTransport';

export { resolveLottiePlayheadHostId };

function AnimationPlayheadTransport({
  document,
}: {
  document: any;
}): ReactNode {
  const dispatch = useDispatch();
  const playhead = useAnimationPlayheadSec();
  const playing = useAnimationPlaying();
  const timelineOpen = useSelector((s: any) => Boolean(s.editor.lottieTimelinePanel?.nodeId));
  const hostNodeId = useSelector((s: any) => resolveLottiePlayheadHostId(s.editor));

  const node = hostNodeId ? document?.deltaSetLike?.[hostNodeId] : null;
  // Dock owns its RAF while open — avoid double-advancing the playhead.
  const active =
    !timelineOpen &&
    Boolean(node) &&
    node?.key === 'lottie' &&
    isAnimationFrameHostNode(node, document);

  const loop = !(
    node?.attrs?.lottieLoop === false ||
    node?.attrs?.lottieLoop === 'false' ||
    node?.attrs?.lottieLoop === 0 ||
    node?.attrs?.lottieLoop === '0'
  );

  const bounds = useMemo(() => {
    const animationData = parseLottieAnimationData(node?.attrs?.animationData);
    const scenes = buildLottieTimelineScenes(
      animationData,
      String(node?.attrs?.name || 'Lottie'),
      { includeEmptyProps: true }
    );
    const scene = scenes[0] || null;
    const fps = Math.max(1, scene?.fr || 30);
    const workInSec = scene ? frameToSec(scene.ip, fps) : 0;
    const workOutSec = scene
      ? frameToSec(scene.op, fps)
      : Math.max(1, workInSec + 1);
    const frameId = resolveAnimationFrameId(document, node);
    const plate = frameId
      ? (Array.isArray(document?.frames) ? document.frames : []).find(
          (f: any) => String(f?.id) === frameId
        )
      : null;
    const frameSpan = Math.max(0.5, Number(plate?.durationSec) || 0);
    const duration = Math.max(0.1, workOutSec, frameSpan, workInSec + 0.5, 1);
    return { fps, workInSec, workOutSec, duration };
  }, [document, node]);

  const playheadRef = useRef(playhead);
  // While playing, ref holds continuous time (must not reset from snapped Redux).
  useEffect(() => {
    if (playing) playheadRef.current = playhead;
    // Seed only when play starts — not on every snapped tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [playing]);
  useEffect(() => {
    if (!playing) playheadRef.current = playhead;
  }, [playhead, playing]);
  const loopRef = useRef(loop);
  loopRef.current = loop;

  useEffect(() => {
    if (!playing || !active || !hostNodeId) return;
    const { fps, workInSec, workOutSec, duration } = bounds;
    let raf = 0;
    let lastTs = performance.now();
    let missingHost = 0;
    const tick = (now: number) => {
      const host = getLottieHost(hostNodeId);
      let t: number;
      if (host && !host.isPaused()) {
        missingHost = 0;
        lastTs = now;
        t = host.getCurrentTime();
      } else {
        const speed = Math.max(0.05, Number(host?.getSpeed?.()) || 1);
        const dt = Math.max(0, (now - lastTs) / 1000) * speed;
        lastTs = now;
        // Continuous ref — snapped Redux time must not feed back or we stall
        // one frame before workOut when the host has already paused.
        t = playheadRef.current + dt;
        if (host) {
          if (missingHost < 8) {
            host.playFrom(t);
            missingHost += 1;
          } else {
            host.seek(t);
          }
        } else {
          missingHost = 0;
        }
      }

      if (t >= workOutSec - 1e-3) {
        if (loopRef.current) {
          t = workInSec;
          host?.playFrom(t);
          playheadRef.current = t;
          dispatch(setLottiePlayhead(snapSecToFrame(t, fps, duration)));
          raf = requestAnimationFrame(tick);
          return;
        }
        playheadRef.current = workOutSec;
        dispatch(setLottiePlayhead(workOutSec));
        host?.seek(workOutSec);
        host?.pause();
        dispatch(setLottiePlaying({ playing: false, hostNodeId }));
        return;
      }

      playheadRef.current = t;
      dispatch(
        setLottiePlayhead(
          snapSecToFrame(Math.max(workInSec, Math.min(duration, t)), fps, duration)
        )
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, active, hostNodeId, bounds, dispatch]);

  return null;
}

export default memo(AnimationPlayheadTransport);
