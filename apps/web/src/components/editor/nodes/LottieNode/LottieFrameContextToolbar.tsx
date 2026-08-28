/**
 * Lottie 合成台 workbench toolbar — quick edit / timeline / playback + plate chrome.
 */
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineEye,
  HiOutlineEyeSlash,
  HiOutlineLockClosed,
  HiOutlineLockOpen,
  HiOutlineQueueList,
} from 'react-icons/hi2';
import { ColorPanelPopover, FILL_ALPHA_PRESETS } from '@/components/base/colorPanel';
import { Dropdown } from '@/components/base';
import type { MenuItemType } from '@/components/base/dropdown';
import Tooltip from '@/components/base/tooltip';
import AppLogo from '@/components/base/AppLogo';
import { ExportSelectionPopover } from '@/components/editor/panels/ExportSelectionPanel';
import { imageToolBtn, ImageToolSep } from '@/components/editor/nodes/ImageNode/imageToolbarShared';
import { getLottieHost } from '@/components/editor/nodes/LottieNode/LottieNodeOverlay';
import LottieTransportControls from '@/components/editor/nodes/LottieNode/LottieTransportControls';
import { findFrameLottieMediaId } from '@/components/editor/nodes/LottieNode/resolveLottieFrameId';
import {
  closeLottieFramePanel,
  closeLottieTimelinePanel,
  ensureLottieFrameMedia,
  openLottieFramePanel,
  openLottieTimelinePanel,
  patchDocumentNode,
  setLottiePlayhead,
  updateArtboardFrame,
  type ArtboardFrame,
} from '@/store/modules/editor';
import store from '@/store';
import { SEL_ICON_BTN, SEL_SIZE_INPUT } from '@/components/rcb/selection/chrome/ToolbarValueSlider';
import { SelectionToolbarShell } from '@/components/rcb/selection/chrome/SelectionToolbarShell';
import { cn } from '@/utils/classnames';

type Props = {
  frame: ArtboardFrame;
  box?: { left: number; top: number; width: number; height: number };
};

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

function LottieFrameContextToolbar({ frame, box }: Props) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const document = useSelector((s: any) => s.editor.document);
  const framePanel = useSelector(
    (s: any) =>
      s.editor.lottieFramePanel as null | { frameId: string; kind: 'quickEdit' | 'timeline' }
  );
  const timelinePanel = useSelector(
    (s: any) => s.editor.lottieTimelinePanel as null | { nodeId: string }
  );
  const mediaId = useMemo(
    () => findFrameLottieMediaId(document, frame.id),
    [document, frame.id]
  );
  const mediaNode = mediaId ? document?.deltaSetLike?.[mediaId] : null;
  const loop = !(
    mediaNode?.attrs?.lottieLoop === false ||
    mediaNode?.attrs?.lottieLoop === 'false' ||
    mediaNode?.attrs?.lottieLoop === 0 ||
    mediaNode?.attrs?.lottieLoop === '0'
  );
  const speed = Math.max(0.25, Number(mediaNode?.attrs?.lottieSpeed) || 1);
  const [paused, setPaused] = useState(false);

  const canvasLocked = Boolean(frame.locked);
  const clipContent = Boolean(frame.clipContent);
  const quickEditOpen = framePanel?.frameId === frame.id && framePanel.kind === 'quickEdit';
  const timelineOpen = Boolean(mediaId && timelinePanel?.nodeId === mediaId);

  useEffect(() => {
    if (!mediaId) {
      setPaused(false);
      return;
    }
    const sync = () => setPaused(Boolean(getLottieHost(mediaId)?.isPaused()));
    sync();
    const id = window.setInterval(sync, 400);
    return () => window.clearInterval(id);
  }, [mediaId]);

  // Mirror image quick-edit: hide plate chrome while the composer is open.
  if (quickEditOpen) return null;

  const patch = (next: Partial<ArtboardFrame>) => {
    dispatch(updateArtboardFrame({ id: frame.id, patch: next }));
  };

  const resolveMediaId = () => {
    dispatch(ensureLottieFrameMedia({ frameId: frame.id }));
    const doc = store.getState()?.editor?.document;
    return findFrameLottieMediaId(doc, frame.id) || mediaId;
  };

  const fill = frame.backgroundColor || '#FFFFFF';
  const fillHex = fill === 'transparent' ? '#FFFFFF' : fill;
  const fillOpacity =
    fill === 'transparent'
      ? 0
      : Math.max(0, Math.min(100, Number(frame.backgroundOpacity ?? 100)));
  const resolveFrameColorForOpacity = (opacity: number) => {
    if (opacity <= 0) return 'transparent';
    if (frame.backgroundColor === 'transparent') return '#FFFFFF';
    return frame.backgroundColor || '#FFFFFF';
  };

  const speedItems: MenuItemType[] = [
    { key: '0.5', label: '0.5×' },
    { key: '1', label: '1×' },
    { key: '1.5', label: '1.5×' },
    { key: '2', label: '2×' },
  ];

  const onQuickEdit = () => {
    resolveMediaId();
    if (quickEditOpen) dispatch(closeLottieFramePanel());
    else dispatch(openLottieFramePanel({ frameId: frame.id, kind: 'quickEdit' }));
  };

  const onTimeline = () => {
    if (timelineOpen) {
      dispatch(closeLottieTimelinePanel());
      return;
    }
    const id = resolveMediaId();
    if (!id) return;
    dispatch(closeLottieFramePanel());
    dispatch(openLottieTimelinePanel({ nodeId: id }));
  };

  const onTogglePlay = () => {
    const id = resolveMediaId();
    if (!id) return;
    const tryToggle = (attempt: number) => {
      const host = getLottieHost(id);
      if (!host) {
        if (attempt < 8) window.setTimeout(() => tryToggle(attempt + 1), 50);
        return;
      }
      if (host.isPaused()) {
        host.play();
        setPaused(false);
      } else {
        host.pause();
        setPaused(true);
      }
    };
    tryToggle(0);
  };

  const withHost = (fn: (host: NonNullable<ReturnType<typeof getLottieHost>>) => void) => {
    const id = resolveMediaId();
    if (!id) return;
    const tryDo = (attempt: number) => {
      const host = getLottieHost(id);
      if (!host) {
        if (attempt < 8) window.setTimeout(() => tryDo(attempt + 1), 50);
        return;
      }
      fn(host);
    };
    tryDo(0);
  };

  const fps = Math.max(1, Math.round(Number(frame.fps) || 30));

  const onStepFrame = (dir: -1 | 1) => {
    withHost((host) => {
      host.pause();
      setPaused(true);
      const next = Math.max(
        0,
        Math.min(host.getDurationSec(), host.getCurrentTime() + dir / fps)
      );
      host.seek(next);
      dispatch(setLottiePlayhead(next));
    });
  };

  const onSeekEdge = (toEnd: boolean) => {
    withHost((host) => {
      host.pause();
      setPaused(true);
      const next = toEnd ? host.getDurationSec() : 0;
      host.seek(next);
      dispatch(setLottiePlayhead(next));
    });
  };

  const onToggleLoop = () => {
    const id = resolveMediaId();
    if (!id) return;
    const next = !loop;
    dispatch(
      patchDocumentNode({
        nodeId: id,
        patch: { attrs: { lottieLoop: next ? 'true' : 'false' } },
      })
    );
    getLottieHost(id)?.setLoop(next);
  };

  const onSpeed = (key: string) => {
    const id = resolveMediaId();
    if (!id) return;
    const next = Number(key) || 1;
    dispatch(patchDocumentNode({ nodeId: id, patch: { attrs: { lottieSpeed: next } } }));
    getLottieHost(id)?.setSpeed(next);
  };

  const speedLabel = `${Number.isFinite(speed) && speed > 0 ? speed : 1}×`;

  return (
    <SelectionToolbarShell
      box={box || { left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
      hasTitleLabel
      isFrameToolbar
      zIndexClassName="z-[30]"
    >
      <Tool
        label={t('editor.imageToolbar.chat', { defaultValue: '快速编辑' })}
        tip={t('editor.lottieToolbar.quickEditTip', {
          defaultValue: '在合成台内用对话生成 / 改动画',
        })}
        active={quickEditOpen}
        onClick={onQuickEdit}
      >
        <AppLogo size={16} />
      </Tool>
      <ColorPanelPopover
        value={fillHex}
        opacity={fillOpacity}
        showAlpha
        presets={FILL_ALPHA_PRESETS}
        onChange={(hex) => {
          if (hex === 'transparent') {
            patch({ backgroundColor: 'transparent', backgroundOpacity: 0 });
            return;
          }
          patch({
            backgroundColor: hex,
            backgroundOpacity: fillOpacity > 0 ? fillOpacity : 100,
          });
        }}
        onOpacityChange={(opacity) => {
          const nextOpacity = Math.max(0, Math.min(100, Math.round(opacity)));
          const nextColor = resolveFrameColorForOpacity(nextOpacity);
          patch({ backgroundColor: nextColor, backgroundOpacity: nextOpacity });
        }}
        title={t('editor.frameToolbar.canvasColor', { defaultValue: '颜色' })}
        placement="bottom-start"
        className={SEL_ICON_BTN}
      >
        <span
          className="relative inline-flex h-4 w-4 overflow-hidden rounded-full ring-1 ring-[var(--line)]"
          style={{ background: fill === 'transparent' ? undefined : fill }}
        >
          {fill === 'transparent' ? (
            <span
              aria-hidden
              className="absolute inset-0"
              style={{
                backgroundImage:
                  'linear-gradient(45deg,#9ca3af 25%,transparent 25%,transparent 75%,#9ca3af 75%),linear-gradient(45deg,#9ca3af 25%,transparent 25%,transparent 75%,#9ca3af 75%)',
                backgroundSize: '6px 6px',
                backgroundPosition: '0 0, 3px 3px',
              }}
            />
          ) : null}
        </span>
      </ColorPanelPopover>
      <Tool
        label={t('editor.lottieToolbar.timeline', { defaultValue: '时间轴' })}
        tip={t('editor.lottieToolbar.timelineTip', {
          defaultValue: '从底部打开时间轴：图层与关键帧',
        })}
        active={timelineOpen}
        onClick={onTimeline}
      >
        <HiOutlineQueueList className="h-4 w-4" strokeWidth={1.75} />
      </Tool>
      <ImageToolSep />
      <LottieTransportControls
        playing={!paused}
        loop={loop}
        onPlayPause={onTogglePlay}
        onStepFrame={onStepFrame}
        onSeekEdge={onSeekEdge}
        onToggleLoop={onToggleLoop}
      />
      <Dropdown
        trigger="click"
        placement="bottom"
        strategy="fixed"
        floatingClassName="z-[520]"
        items={speedItems}
        onClick={onSpeed}
      >
        <button type="button" className={imageToolBtn}>
          <span>{speedLabel}</span>
        </button>
      </Dropdown>
      <ImageToolSep />
      <label className="inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-[11px] text-[var(--muted)]">
        FPS
        <input
          type="number"
          min={1}
          step={1}
          className={SEL_SIZE_INPUT}
          value={fps}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            patch({ fps: Math.max(1, Math.round(n)) });
          }}
        />
      </label>
      <ImageToolSep />
      <button
        type="button"
        className={SEL_ICON_BTN}
        title={
          canvasLocked
            ? t('editor.unlock', { defaultValue: '解锁' })
            : t('editor.lock', { defaultValue: '锁定' })
        }
        onClick={() => patch({ locked: !canvasLocked })}
      >
        {canvasLocked ? (
          <HiOutlineLockClosed className="h-4 w-4" />
        ) : (
          <HiOutlineLockOpen className="h-4 w-4" />
        )}
      </button>
      <button
        type="button"
        className={SEL_ICON_BTN}
        title={
          clipContent
            ? t('editor.frame.unclip', { defaultValue: '取消裁剪' })
            : t('editor.frame.clip', { defaultValue: '裁剪内容' })
        }
        onClick={() => patch({ clipContent: !clipContent })}
      >
        {clipContent ? (
          <HiOutlineEyeSlash className="h-4 w-4" />
        ) : (
          <HiOutlineEye className="h-4 w-4" />
        )}
      </button>
      <ExportSelectionPopover
        crop={{
          x: frame.x,
          y: frame.y,
          width: frame.width,
          height: frame.height,
          backgroundColor: frame.backgroundColor,
        }}
        baseName={frame.name || 'Lottie'}
      />
    </SelectionToolbarShell>
  );
}

export default memo(LottieFrameContextToolbar);
