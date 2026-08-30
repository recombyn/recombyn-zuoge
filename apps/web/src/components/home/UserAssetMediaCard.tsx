/**
 * Shared user AI-asset card — Me profile Assets tab + editor Assets dock.
 * Natural aspect (plaza-style waterfall); click to preview or batch-select on home.
 */
import {
  memo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineCheck,
  HiOutlinePause,
  HiOutlinePhoto,
  HiOutlinePlay,
  HiOutlineXMark,
} from 'react-icons/hi2';
import { LuAudioLines, LuFilm } from 'react-icons/lu';
import lottie, { type AnimationItem } from 'lottie-web';
import Image from '@/components/base/image';
import { SoftGlowSurface } from '@/components/base';
import VideoJsPlayer, {
  usePlayableVideoSrc,
} from '@/components/editor/nodes/VideoNode/VideoJsPlayer';
import {
  AssetCardHoverMediaButton,
} from '@/components/home/assetCardMediaChrome';
import { AudioAssetCardMedia, AssetAudioIdleThumb } from '@/components/home/AssetAudioPlayerSurface';
import { VideoFullscreenPreview } from '@/components/editor/nodes/VideoNode/VideoFullscreenPreviewButton';
import type { VideoMediaControl } from '@/components/editor/nodes/VideoNode/VideoPlaybackBar';
import type { UserAsset } from '@/models/assets';
import { FLOW_ITEM_CLASS, FLOW_SKELETON_COUNT } from '@/components/home/FlowScrollSection';
import {
  parseLottieAnimationData,
} from '@/components/rcb/scene/document/nodeFactories';
import { cn } from '@/utils/classnames';
import { toDisplayMediaUrl } from '@/utils/uploadImage';

/** Varied aspects for flow skeletons (same rhythm as plaza). */
const ASSET_SKELETON_RATIOS = ['3 / 4', '4 / 5', '1 / 1', '4 / 3', '5 / 6', '2 / 3', '5 / 4'] as const;

// --- pure helpers ----------------------------------------------------------

function formatAssetVideoDuration(seconds: number | undefined): string | null {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function aspectFromAsset(asset: UserAsset): string | null {
  const w = Number(asset.width);
  const h = Number(asset.height);
  if (w > 0 && h > 0) return `${w} / ${h}`;
  return null;
}

function defaultFrameAspect(kind: string): string {
  if (kind === 'video') return '16 / 9';
  return kind === 'audio' || kind === 'lottie' ? '1 / 1' : '3 / 4';
}

function assetDurationSeconds(asset: UserAsset): number | undefined {
  const fromMeta = Number((asset.meta as { duration?: unknown } | null)?.duration);
  if (Number.isFinite(fromMeta) && fromMeta > 0) return fromMeta;
  return undefined;
}

function cloneLottieData(data: Record<string, unknown>): Record<string, unknown> {
  const cloned =
    typeof structuredClone === 'function'
      ? structuredClone(data)
      : (JSON.parse(JSON.stringify(data)) as Record<string, unknown>);
  // Drop exporter plate color — host uses theme CSS instead.
  delete cloned.bg;
  delete (cloned as { background?: unknown }).background;
  return cloned;
}

function lottieHostHasInk(host: HTMLElement): boolean {
  return host.querySelectorAll('path, ellipse, circle, rect, polygon').length > 0;
}

function markAssetCardDragging(el: HTMLElement | null) {
  const card = el?.closest('[data-asset-card]');
  if (!(card instanceof HTMLElement)) return;
  card.setAttribute('data-dragging', '');
  card.offsetWidth;
}

function clearAssetCardDragging(el: HTMLElement | null) {
  const card = el?.closest('[data-asset-card]');
  if (card instanceof HTMLElement) card.removeAttribute('data-dragging');
}

/** Prefer list-inlined ``animationData``; never refetch `.json` when present. */
function resolveAssetLottieData(asset: UserAsset): Record<string, unknown> | null {
  const embedded = asset.animationData ?? asset.meta?.animationData;
  return parseLottieAnimationData(embedded);
}

function mountLottieOnHost(
  host: HTMLElement,
  data: Record<string, unknown>
): AnimationItem {
  host.innerHTML = '';
  return lottie.loadAnimation({
    container: host,
    renderer: 'svg',
    loop: true,
    autoplay: true,
    animationData: cloneLottieData(data),
    rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
  });
}

// --- hooks -----------------------------------------------------------------

/** Display URL as-is (bare storage keys → /api/v1/uploads/files/…). */
function useDisplayMediaSrc(
  url: string,
  uploadKey: string | undefined,
  _fileName?: string,
  enabled = true
): string {
  if (!enabled || !url) return '';
  return toDisplayMediaUrl(url, uploadKey);
}

function useEscapeToClose(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
}

// --- thumbnails ------------------------------------------------------------

function PlaceholderThumb({ kind }: { kind: string }): ReactNode {
  if (kind === 'audio') return <LuAudioLines className="h-6 w-6" strokeWidth={1.75} />;
  if (kind === 'video') return <LuFilm className="h-6 w-6" strokeWidth={1.75} />;
  return <HiOutlinePhoto className="h-6 w-6" strokeWidth={1.75} />;
}

function ImageThumb({
  src,
  onNatural,
}: {
  src: string;
  onNatural: (w: number, h: number) => void;
}): ReactNode {
  return (
    // onLoad reports natural size for aspect ratio — not an interactive handler.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <img
      src={src}
      alt=""
      className="pointer-events-none h-full w-full object-cover"
      loading="lazy"
      draggable={false}
      onLoad={(e) => {
        const img = e.currentTarget;
        onNatural(img.naturalWidth, img.naturalHeight);
      }}
    />
  );
}

function VideoAssetCardMedia({
  asset,
  active,
  onActiveChange,
  onNaturalAspect,
}: {
  asset: UserAsset;
  active: boolean;
  onActiveChange: (active: boolean) => void;
  onNaturalAspect?: (aspect: string) => void;
}): ReactNode {
  const { t } = useTranslation();
  const url = String(asset.url || '').trim();
  const uploadKey = String(asset.objectKey || '').trim() || undefined;
  const thumbSrc = useDisplayMediaSrc(url, uploadKey, 'user-asset-video-thumb.bin');
  const playSrc = usePlayableVideoSrc(url, uploadKey);
  const knownDuration = assetDurationSeconds(asset);
  const [probedDuration, setProbedDuration] = useState<number | undefined>();
  const [paused, setPaused] = useState(false);
  const mediaRef = useRef<VideoMediaControl | null>(null);
  const unbindMediaRef = useRef<(() => void) | null>(null);
  const durationLabel = formatAssetVideoDuration(knownDuration ?? probedDuration);
  const playLabel = t('agent.previewPlay', { defaultValue: '播放' });
  const pauseLabel = t('agent.previewPause', { defaultValue: '暂停' });

  const reportNatural = (w: number, h: number) => {
    if (w > 0 && h > 0) onNaturalAspect?.(`${w} / ${h}`);
  };

  useEffect(() => {
    if (!active) {
      setPaused(false);
      unbindMediaRef.current?.();
      unbindMediaRef.current = null;
      mediaRef.current = null;
    }
  }, [active]);

  useEffect(
    () => () => {
      unbindMediaRef.current?.();
      unbindMediaRef.current = null;
    },
    []
  );

  const bindMedia = (media: VideoMediaControl) => {
    mediaRef.current = media;
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    media.on('play', onPlay);
    media.on('pause', onPause);
    setPaused(media.isPaused());
    return () => {
      media.off('play', onPlay);
      media.off('pause', onPause);
    };
  };

  const togglePlayback = () => {
    if (!active) {
      onActiveChange(true);
      return;
    }
    const media = mediaRef.current;
    if (!media) return;
    if (media.isPaused()) media.play();
    else media.pause();
  };

  if (active && playSrc) {
    return (
      <div
        className="absolute inset-0 flex items-center justify-center bg-black"
        data-asset-video-inline-player
      >
        <VideoJsPlayer
          src={playSrc}
          layout="fill"
          objectFit="contain"
          controlsMode="always"
          compactChrome
          autoplay
          muted
          knownDuration={knownDuration}
          className="h-full w-full"
          onReady={(media) => {
            unbindMediaRef.current?.();
            unbindMediaRef.current = bindMedia(media);
          }}
          onMediaSize={({ width, height }) => reportNatural(width, height)}
        />
        <AssetCardHoverMediaButton
          showPause={!paused}
          playLabel={playLabel}
          pauseLabel={pauseLabel}
          onToggle={togglePlayback}
        />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black">
      {thumbSrc ? (
        <video
          src={thumbSrc}
          className="max-h-full max-w-full object-contain"
          muted
          playsInline
          preload="metadata"
          draggable={false}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            reportNatural(v.videoWidth, v.videoHeight);
            const d = Number(v.duration);
            if (Number.isFinite(d) && d > 0) setProbedDuration(d);
          }}
        />
      ) : (
        <span className="inline-flex h-full w-full items-center justify-center bg-[var(--canvas)] text-[var(--muted)]">
          <LuFilm className="h-6 w-6" strokeWidth={1.75} />
        </span>
      )}
      {durationLabel ? (
        <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1 py-0.5 text-[10px] font-medium tabular-nums leading-none text-white">
          {durationLabel}
        </span>
      ) : null}
      <AssetCardHoverMediaButton
        showPause={false}
        playLabel={playLabel}
        pauseLabel={pauseLabel}
        onToggle={togglePlayback}
      />
    </div>
  );
}

function VideoThumb({
  src,
  duration,
  onNatural,
}: {
  src: string;
  duration?: number;
  onNatural: (w: number, h: number) => void;
}): ReactNode {
  const [probedDuration, setProbedDuration] = useState<number | undefined>();
  const durationLabel = formatAssetVideoDuration(duration ?? probedDuration);

  return (
    <span className="pointer-events-none relative block h-full w-full">
      <video
        src={src}
        className="h-full w-full object-cover"
        muted
        playsInline
        preload="metadata"
        draggable={false}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          onNatural(v.videoWidth, v.videoHeight);
          const d = Number(v.duration);
          if (Number.isFinite(d) && d > 0) setProbedDuration(d);
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white shadow-sm ring-1 ring-white/25">
          <HiOutlinePlay className="h-4 w-4 translate-x-[1px]" strokeWidth={2} />
        </span>
      </span>
      {durationLabel ? (
        <span className="absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1 py-0.5 text-[10px] font-medium tabular-nums leading-none text-white">
          {durationLabel}
        </span>
      ) : null}
    </span>
  );
}

function LottieAssetThumb({
  asset,
  onNaturalAspect,
}: {
  asset: UserAsset;
  onNaturalAspect?: (aspect: string) => void;
}): ReactNode {
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const lottieData = resolveAssetLottieData(asset);

  useEffect(() => {
    const aspect = aspectFromAsset(asset);
    if (aspect) onNaturalAspect?.(aspect);
  }, [asset.width, asset.height, onNaturalAspect, asset]);

  useEffect(() => {
    if (!hostEl) return undefined;
    if (!lottieData) {
      setFailed(true);
      return undefined;
    }
    let cancelled = false;
    let anim: AnimationItem | null = null;
    setFailed(false);
    const aw = Number(lottieData.w);
    const ah = Number(lottieData.h);
    if (aw > 0 && ah > 0) onNaturalAspect?.(`${aw} / ${ah}`);
    try {
      anim = mountLottieOnHost(hostEl, lottieData);
      requestAnimationFrame(() => {
        if (cancelled || !hostEl.isConnected) return;
        if (!lottieHostHasInk(hostEl)) setFailed(true);
      });
    } catch {
      setFailed(true);
    }
    return () => {
      cancelled = true;
      anim?.destroy();
      hostEl.innerHTML = '';
    };
  }, [hostEl, lottieData, onNaturalAspect]);

  return (
    <span className="pointer-events-none relative block h-full w-full overflow-hidden bg-[var(--canvas)]">
      <div
        ref={setHostEl}
        className="h-full w-full bg-transparent [&_svg]:bg-transparent"
      />
      {failed ? (
        <span className="pointer-events-none absolute inset-0 inline-flex items-center justify-center text-[var(--muted)]">
          <LuFilm className="h-6 w-6" strokeWidth={1.75} />
        </span>
      ) : null}
    </span>
  );
}

function UserAssetThumb({
  asset,
  onNaturalAspect,
  editorMediaPreview = false,
}: {
  asset: UserAsset;
  onNaturalAspect?: (aspect: string) => void;
  editorMediaPreview?: boolean;
}): ReactNode {
  const url = String(asset.url || '').trim();
  const uploadKey = String(asset.objectKey || '').trim() || undefined;
  const thumbSrc = useDisplayMediaSrc(url, uploadKey, 'user-asset-thumb.bin');

  const reportNatural = (w: number, h: number) => {
    if (w > 0 && h > 0) onNaturalAspect?.(`${w} / ${h}`);
  };

  if (asset.kind === 'audio') {
    return <AssetAudioIdleThumb asset={asset} />;
  }
  if (asset.kind === 'lottie') {
    return (
      <LottieAssetThumb
        asset={asset}
        onNaturalAspect={onNaturalAspect}
      />
    );
  }
  if (asset.kind === 'image' && thumbSrc) {
    return <ImageThumb src={thumbSrc} onNatural={reportNatural} />;
  }
  if (asset.kind === 'video' && thumbSrc) {
    return (
      <VideoThumb
        src={thumbSrc}
        duration={assetDurationSeconds(asset)}
        onNatural={reportNatural}
      />
    );
  }
  return (
    <span className="inline-flex h-full w-full items-center justify-center text-[var(--muted)]">
      <PlaceholderThumb kind={String(asset.kind || 'image')} />
    </span>
  );
}

// --- card chrome -----------------------------------------------------------

function UserAssetCardSkeleton({
  index = 0,
  dense = false,
}: {
  index?: number;
  dense?: boolean;
}): ReactNode {
  const ratio = ASSET_SKELETON_RATIOS[index % ASSET_SKELETON_RATIOS.length];
  return (
    <div
      className={cn(dense ? 'mb-1.5 min-w-0 break-inside-avoid' : 'min-w-0')}
      aria-busy="true"
      aria-hidden
    >
      <SoftGlowSurface
        seed={index}
        className="block w-full rounded-[8px] shadow-none"
        style={{ aspectRatio: ratio }}
      />
    </div>
  );
}

type UserAssetCardProps = {
  asset: UserAsset;
  /** Editor dock — tighter spacing + grab cursor when draggable. */
  dense?: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  onActivate?: (asset: UserAsset) => void;
  /** When set, card body is HTML5-draggable (Assets → canvas). */
  onDragStart?: (e: ReactDragEvent<HTMLElement>, asset: UserAsset) => void;
  onDragEnd?: () => void;
  /** Editor panel — smaller inline media previews (video/audio/lottie). */
  editorMediaPreview?: boolean;
};

function handleAssetCardActivate(
  asset: UserAsset,
  url: string,
  onActivate: (asset: UserAsset) => void
) {
  if (!url && asset.kind !== 'audio') return;
  onActivate(asset);
}

function closePreviewOnBackdropClick(
  e: ReactMouseEvent<HTMLElement>,
  onClose: () => void
) {
  if (e.target === e.currentTarget) onClose();
}

function UserAssetCard({
  asset,
  dense = false,
  selectMode = false,
  selected = false,
  onToggle,
  onActivate,
  onDragStart,
  onDragEnd,
  editorMediaPreview = false,
}: UserAssetCardProps): ReactNode {
  const { t } = useTranslation();
  const url = String(asset.url || '').trim();
  const uploadKey = String(asset.objectKey || '').trim() || undefined;
  const lottieDragData = asset.kind === 'lottie' ? resolveAssetLottieData(asset) : null;
  const canDrag = Boolean(onDragStart && !selectMode && (url || uploadKey || lottieDragData));
  const [videoActive, setVideoActive] = useState(false);
  const [audioActive, setAudioActive] = useState(false);
  const [naturalAspect, setNaturalAspect] = useState<string | null>(() =>
    aspectFromAsset(asset)
  );
  const isVideoAsset = asset.kind === 'video' && Boolean(url);
  const isAudioAsset = asset.kind === 'audio' && Boolean(url || uploadKey);
  const isLottieAsset =
    asset.kind === 'lottie' && Boolean(resolveAssetLottieData(asset) || url);
  const videoInlineEnabled = editorMediaPreview && isVideoAsset && !selectMode;
  const audioInlineEnabled = isAudioAsset && !selectMode;
  const lottieInlineEnabled = editorMediaPreview && isLottieAsset && !selectMode;

  useEffect(() => {
    setVideoActive(false);
    setAudioActive(false);
  }, [asset.id]);

  useEffect(() => {
    if (!videoActive && !audioActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setVideoActive(false);
      setAudioActive(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [videoActive, audioActive]);

  useEffect(() => {
    setNaturalAspect(aspectFromAsset(asset));
  }, [asset]);

  const frameStyle: CSSProperties = {
    aspectRatio:
      isAudioAsset || (editorMediaPreview && (isVideoAsset || isLottieAsset))
        ? '1 / 1'
        : naturalAspect || defaultFrameAspect(String(asset.kind || '')),
  };

  const onBodyDragStart = (e: ReactDragEvent<HTMLElement>) => {
    if (!canDrag) return;
    setVideoActive(false);
    setAudioActive(false);
    markAssetCardDragging(e.currentTarget);
    onDragStart?.(e, asset);
  };

  const onBodyDragEnd = (e: ReactDragEvent<HTMLElement>) => {
    clearAssetCardDragging(e.currentTarget);
    onDragEnd?.();
  };

  const onPrimary = () => {
    if (selectMode) {
      onToggle?.();
      return;
    }
    // Chat / agent: clicking a Lottie card places onto 动画工作台.
    if (lottieInlineEnabled && onActivate) {
      onActivate(asset);
      return;
    }
    if (lottieInlineEnabled || videoInlineEnabled || audioInlineEnabled) return;
    if (onActivate) handleAssetCardActivate(asset, url, onActivate);
  };

  const isInteractive = selectMode || Boolean(onActivate) || canDrag;

  return (
    <>
      <div
        data-asset-card
        className={cn(
          dense ? 'mb-1.5 min-w-0 break-inside-avoid' : 'min-w-0',
          'group relative overflow-hidden rounded-[8px] border border-[var(--line)] bg-[var(--rail)] transition',
          selected && 'shadow-[0_0_0_2px_rgba(91,141,239,0.35)]',
          videoActive && 'ring-1 ring-[var(--ink)]/20',
          audioActive && 'ring-1 ring-[var(--ink)]/20'
        )}
      >
      {videoInlineEnabled ? (
        <div
          draggable={canDrag}
          onDragStart={canDrag ? onBodyDragStart : undefined}
          onDragEnd={onBodyDragEnd}
          className={cn(
            'relative block w-full',
            canDrag && 'cursor-grab active:cursor-grabbing'
          )}
        >
          <div
            className="relative w-full overflow-hidden bg-black"
            style={frameStyle}
          >
            <VideoAssetCardMedia
              asset={asset}
              active={videoActive}
              onActiveChange={setVideoActive}
              onNaturalAspect={setNaturalAspect}
            />
          </div>
        </div>
      ) : audioInlineEnabled ? (
        <div
          draggable={canDrag}
          onDragStart={canDrag ? onBodyDragStart : undefined}
          onDragEnd={onBodyDragEnd}
          className={cn(
            'relative block w-full',
            canDrag && 'cursor-grab active:cursor-grabbing'
          )}
        >
          <div
            className="relative w-full overflow-hidden"
            style={frameStyle}
          >
            <AudioAssetCardMedia
              asset={asset}
              active={audioActive}
              onActiveChange={setAudioActive}
            />
          </div>
        </div>
      ) : lottieInlineEnabled ? (
        <button
          type="button"
          draggable={canDrag}
          onDragStart={canDrag ? onBodyDragStart : undefined}
          onDragEnd={onBodyDragEnd}
          onClick={onPrimary}
          className={cn(
            'relative block w-full appearance-none border-0 bg-transparent p-0 text-left',
            canDrag && 'cursor-grab active:cursor-grabbing',
            onActivate && 'cursor-pointer'
          )}
        >
          <div className="relative w-full overflow-hidden" style={frameStyle}>
            <LottieAssetThumb asset={asset} onNaturalAspect={setNaturalAspect} />
          </div>
        </button>
      ) : (
      <button
        type="button"
        draggable={canDrag}
        onDragStart={canDrag ? onBodyDragStart : undefined}
        onDragEnd={onBodyDragEnd}
        onClick={onPrimary}
        className={cn(
          'relative block w-full appearance-none border-0 bg-transparent p-0 text-left',
          canDrag && 'cursor-grab active:cursor-grabbing',
          !isInteractive && 'cursor-default'
        )}
      >
        <div className="relative w-full overflow-hidden" style={frameStyle}>
          <div className="absolute inset-0">
            <UserAssetThumb
              asset={asset}
              onNaturalAspect={setNaturalAspect}
              editorMediaPreview={editorMediaPreview}
            />
          </div>
        </div>
      </button>
      )}
      {selectMode ? (
        <button
          type="button"
          aria-label={t('home.batchSelect')}
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.();
          }}
          className={cn(
            'absolute left-1.5 top-1.5 z-20 flex h-3.5 w-3.5 items-center justify-center rounded-[2px] border transition',
            dense && 'left-1 top-1',
            selected
              ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--on-brand)]'
              : 'border-[var(--line)] bg-[var(--surface)]/90 text-transparent'
          )}
        >
          <HiOutlineCheck className="h-2.5 w-2.5" strokeWidth={3} />
        </button>
      ) : null}
      </div>
    </>
  );
}

const MemoizedUserAssetCard = memo(UserAssetCard);
const MemoizedUserAssetCardSkeleton = memo(UserAssetCardSkeleton);

// --- previews --------------------------------------------------------------
function ImageAssetLightbox({
  asset,
  onClose,
}: {
  asset: UserAsset;
  onClose: () => void;
}): ReactNode {
  const url = String(asset.url || '').trim();
  const uploadKey = String(asset.objectKey || '').trim() || undefined;
  const src = useDisplayMediaSrc(url, uploadKey, 'user-asset-preview.bin');
  if (!src) return null;
  return (
    <Image
      src={src}
      alt=""
      lazy={false}
      preview={{
        open: true,
        onOpenChange: (open) => {
          if (!open) onClose();
        },
        previewOnClick: false,
      }}
      className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0"
      imgClassName="!hidden"
    />
  );
}

function LottieAssetPreview({
  open,
  asset,
  onClose,
}: {
  open: boolean;
  asset: UserAsset;
  onClose: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const lottieData = resolveAssetLottieData(asset);
  useEscapeToClose(open, onClose);

  useEffect(() => {
    if (!open || !hostEl || !lottieData) return undefined;
    let anim: AnimationItem | null = null;
    try {
      anim = mountLottieOnHost(hostEl, lottieData);
    } catch {
      /* empty */
    }
    return () => {
      anim?.destroy();
      hostEl.innerHTML = '';
    };
  }, [open, hostEl, lottieData]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[800] flex items-center justify-center bg-black/45 p-6"
      data-asset-media-preview
      onClick={(e) => closePreviewOnBackdropClick(e, onClose)}
      role="presentation"
    >
      <button
        type="button"
        aria-label={t('common.close', { defaultValue: '关闭' })}
        onClick={onClose}
        className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
      >
        <HiOutlineXMark className="h-5 w-5" strokeWidth={1.75} />
      </button>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('editor.assets.preview', { defaultValue: '预览' })}
        className="relative flex h-[min(72vh,560px)] w-[min(72vw,560px)] items-center justify-center overflow-hidden rounded-xl bg-[var(--canvas)]"
      >
        <div
          ref={setHostEl}
          className="h-full w-full p-3 [&_svg]:bg-transparent"
        />
      </div>
    </div>,
    document.body
  );
}

/** Image lightbox / video fullscreen / lottie dialog — Me + editor Assets. */
function UserAssetMediaPreview({
  asset,
  onClose,
}: {
  asset: UserAsset | null;
  onClose: () => void;
}): ReactNode {
  if (!asset) return null;

  const url = String(asset.url || '').trim();

  return (
    <>
      {asset.kind === 'image' && (
        <ImageAssetLightbox asset={asset} onClose={onClose} />
      )}
      <VideoFullscreenPreview
        open={asset.kind === 'video' && Boolean(url)}
        onClose={onClose}
        src={url}
        uploadKey={asset.objectKey}
        aspectWidth={asset.width || undefined}
        aspectHeight={asset.height || undefined}
        duration={assetDurationSeconds(asset)}
      />
      <LottieAssetPreview
        open={asset.kind === 'lottie' && Boolean(resolveAssetLottieData(asset) || url)}
        asset={asset}
        onClose={onClose}
      />
    </>
  );
}

const MemoizedUserAssetMediaPreview = memo(UserAssetMediaPreview);

export {
  MemoizedUserAssetCard as UserAssetCard,
  MemoizedUserAssetCardSkeleton as UserAssetCardSkeleton,
  MemoizedUserAssetMediaPreview as UserAssetMediaPreview,
  FLOW_SKELETON_COUNT as USER_ASSET_SKELETON_COUNT,
};
