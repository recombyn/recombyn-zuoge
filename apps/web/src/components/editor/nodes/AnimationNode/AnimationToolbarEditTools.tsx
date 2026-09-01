/**
 * Shared — ——playback strip — — —/ transport / speed.
 * Export lives at the end of AnimationFrameContextToolbar (not mid-strip).
 */
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSelector } from '@/store';
import { useEditorDocumentOnCommit } from '@/store/editorSelectors';
import { useTranslation } from 'react-i18next';
import { Dropdown } from '@/components/base';
import type { MenuItemType } from '@/components/base/dropdown';
import Tooltip from '@/components/base/tooltip';
import { imageToolBtn, ImageToolSep } from '@/components/editor/nodes/ImageNode/imageToolbarShared';
import { getLottieHost } from '@/components/editor/nodes/AnimationNode/AnimationNodeOverlay';
import AnimationTransportControls from '@/components/editor/nodes/AnimationNode/AnimationTransportControls';
import { resolveAnimationFrameId } from '@/components/editor/nodes/AnimationNode/resolveAnimationFrameId';
import {
  useAnimationPlayheadSec,
  useAnimationPlaying,
} from '@/components/editor/nodes/AnimationNode/animationTransport';
import { parseLottieAnimationData } from '@/components/rcb/scene/document/nodeFactories';
import {
  buildLottieTimelineScenes,
  frameToSec,
  snapSecToFrame,
} from '@/components/editor/nodes/AnimationNode/animationTimelineModel';
import { animationHasPlayableContent } from '@/components/editor/nodes/AnimationNode/animationFrameSync';
import { isAnimationArtboardKind } from '@/components/rcb/frames/types';
import {
  openLottieTimelinePanel,
  patchDocumentNode,
  setLottiePlayhead,
  setLottiePlaying,
} from '@/store/modules/editor';
import { cn } from '@/utils/classnames';

const TOOL_ICON_SLOT =
  'pointer-events-none inline-flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:block [&>svg]:h-full [&>svg]:w-full';

function ToolIconSlot({ children }: { children: ReactNode }) {
  return <span className={TOOL_ICON_SLOT}>{children}</span>;
}

function Tool({
  label,
  onClick,
  children,
  active,
  tip,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  active?: boolean;
  tip?: string;
}) {
  const btn = (
    <button
      type="button"
      className={cn(imageToolBtn, active && 'bg-[var(--accent-soft)]')}
      onClick={onClick}
    >
      <ToolIconSlot>{children}</ToolIconSlot>
      <span>{label}</span>
    </button>
  );
  if (!tip) return btn;
  return (
    <Tooltip tip={tip} placement="top">
      {btn}
    </Tooltip>
  );
}

function AnimationToolbarEditTools({
  nodeId,
  loop,
  speed,
}: {
  nodeId: string;
  loop: boolean;
  speed: number;
}) {
  const { t } = useTranslation();
  const document = useEditorDocumentOnCommit();
  const playhead = useAnimationPlayheadSec();
  const [playbackReady, setPlaybackReady] = useState(false);
  const timelinePanelNodeId = useSelector(
    (s: any) => String(s.editor.lottieTimelinePanel?.nodeId || '').trim()
  );
  const lottiePlaying = useAnimationPlaying();

  const node = document?.deltaSetLike?.[nodeId];
  const animationFrameId = useMemo(
    () => resolveAnimationFrameId(document, node),
    [document, node]
  );
  const workbenchFrame = useMemo(() => {
    if (!animationFrameId || !document) return null;
    const frames = Array.isArray(document.frames) ? document.frames : [];
    const fr = frames.find((f: any) => String(f?.id) === animationFrameId);
    return fr && isAnimationArtboardKind(fr.kind) ? fr : null;
  }, [animationFrameId, document]);
  const hasPlayableContent = useMemo(
    () => animationHasPlayableContent(node?.attrs?.animationData),
    [node?.attrs?.animationData]
  );
  const animationIntent = Boolean(animationFrameId);

  // Dock owns — —+ transport whenever edit mode is open (any plate selected).
  const timelineOpen = Boolean(timelinePanelNodeId);

  const bounds = useMemo(() => {
    const animationData = parseLottieAnimationData(node?.attrs?.animationData);
    const scenes = buildLottieTimelineScenes(
      animationData,
      String(node?.attrs?.name || 'Lottie'),
      { includeEmptyProps: true }
    );
    const scene = scenes[0] || null;
    const fps = Math.max(1, scene?.fr || Number(workbenchFrame?.fps) || 30);
    const workInSec = scene ? frameToSec(scene.ip, fps) : 0;
    const workOutSec = scene
      ? frameToSec(scene.op, fps)
      : Math.max(1, Number(workbenchFrame?.durationSec) || workInSec + 1);
    const frameSpan = Math.max(0.5, Number(workbenchFrame?.durationSec) || 0);
    const duration = Math.max(0.1, workOutSec, frameSpan, workInSec + 0.5, 1);
    return { fps, workInSec, workOutSec, duration };
  }, [node?.attrs?.animationData, node?.attrs?.name, workbenchFrame]);

  useEffect(() => {
    const sync = () => {
      // Empty — ——still has a plate + host — only enable when layers exist.
      setPlaybackReady(hasPlayableContent && Boolean(getLottieHost(nodeId)));
    };
    sync();
    const id = window.setInterval(sync, 400);
    return () => window.clearInterval(id);
  }, [nodeId, hasPlayableContent]);

  useEffect(() => {
    if (hasPlayableContent || !lottiePlaying) return;
    setLottiePlaying(false);
    getLottieHost(nodeId)?.pause();
  }, [hasPlayableContent, lottiePlaying, nodeId]);

  const speedItems: MenuItemType[] = [
    { key: '0.5', label: '0.5×' },
    { key: '1', label: '1×' },
    { key: '1.5', label: '1.5×' },
    { key: '2', label: '2×' },
  ];

  const bindHost = () => {
    setLottiePlaying({ playing: lottiePlaying, hostNodeId: nodeId });
  };

  const seekPlayhead = (tSec: number, opts?: { play?: boolean }) => {
    const { fps, workInSec, workOutSec, duration } = bounds;
    const next = snapSecToFrame(
      Math.max(workInSec, Math.min(workOutSec, duration, tSec)),
      fps,
      duration
    );
    setLottiePlayhead(next);
    getLottieHost(nodeId)?.seek(next);
    if (opts?.play) {
      getLottieHost(nodeId)?.playFrom(next);
      setLottiePlaying({ playing: true, hostNodeId: nodeId });
    } else {
      getLottieHost(nodeId)?.pause();
      setLottiePlaying({ playing: false, hostNodeId: nodeId });
    }
  };

  const onTogglePlay = () => {
    if (!hasPlayableContent) return;
    const { workInSec, workOutSec } = bounds;
    if (workbenchFrame || animationIntent) {
      if (lottiePlaying) {
        getLottieHost(nodeId)?.pause();
        setLottiePlaying({ playing: false, hostNodeId: nodeId });
        return;
      }
      // At / past out — restart from in; otherwise continue from the editor store playhead.
      const start =
        playhead >= workOutSec - 1e-3 || playhead < workInSec - 1e-3
          ? workInSec
          : playhead;
      seekPlayhead(start, { play: true });
      return;
    }
    const host = getLottieHost(nodeId);
    if (!host) return;
    if (host.isPaused()) {
      host.play();
      setLottiePlaying({ playing: true, hostNodeId: nodeId });
    } else {
      host.pause();
      setLottiePlaying({ playing: false, hostNodeId: nodeId });
    }
  };

  const onStepFrame = (dir: -1 | 1) => {
    const { fps, workInSec, workOutSec, duration } = bounds;
    const step = 1 / fps;
    const next = Math.max(
      workInSec,
      Math.min(workOutSec, duration, playhead + dir * step)
    );
    seekPlayhead(next);
  };

  const onSeekEdge = (toEnd: boolean) => {
    const { workInSec, workOutSec } = bounds;
    seekPlayhead(toEnd ? workOutSec : workInSec);
  };

  const onToggleLoop = () => {
    const next = !loop;
    patchDocumentNode({ nodeId, patch: { attrs: { lottieLoop: next ? 'true' : 'false' } } });
    getLottieHost(nodeId)?.setLoop(next);
    bindHost();
  };

  const onSpeed = (key: string) => {
    const next = Number(key) || 1;
    patchDocumentNode({ nodeId, patch: { attrs: { lottieSpeed: next } } });
    getLottieHost(nodeId)?.setSpeed(next);
  };

  const speedLabel = `${Number.isFinite(speed) && speed > 0 ? speed : 1}`;

  const transport = (
    <>
      <AnimationTransportControls
        playing={lottiePlaying}
        ready={playbackReady}
        loop={loop}
        onPlayPause={onTogglePlay}
        onStepFrame={onStepFrame}
        onSeekEdge={onSeekEdge}
        onToggleLoop={onToggleLoop}
      />
      <Dropdown
        trigger="click"
        placement="top"
        strategy="fixed"
        items={speedItems}
        onClick={(key) => onSpeed(String(key))}
        floatingClassName="z-[520]"
        referenceClassName="inline-flex"
      >
        <button type="button" className={imageToolBtn}>
          <span className="tabular-nums">{speedLabel}</span>
        </button>
      </Dropdown>
    </>
  );

  // Timeline dock owns — —— free LOT preview under focus still needs transport
  // (otherwise only the export download chip remains under the plate).
  if (timelineOpen) return transport;

  return (
    <>
      <Tool
        label={t('editor.lottieToolbar.timeline')}
        tip={t('editor.lottieToolbar.timelineTip')}
        onClick={() => {
          openLottieTimelinePanel({ nodeId });
        }}
      >
        <span
          aria-hidden
          className="block h-2.5 w-2.5 shrink-0 rotate-45 border-[1.5px] border-current bg-transparent"
        />
      </Tool>
      <ImageToolSep />
      {transport}
    </>
  );
}

export default memo(AnimationToolbarEditTools);
