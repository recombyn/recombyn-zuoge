/**
 * Shared chrome for editor / home asset-card inline media (video + audio).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HiOutlinePause, HiOutlinePlay } from 'react-icons/hi2';
import VideoPlaybackBar, {
  VIDEO_PLAYBACK_BAR_H,
  type VideoMediaControl,
} from '@/components/editor/nodes/VideoNode/VideoPlaybackBar';

/** Center play/pause — visible on card hover only (matches video idle UX). */
export function AssetCardHoverMediaButton({
  showPause,
  playLabel,
  pauseLabel,
  onToggle,
}: {
  showPause: boolean;
  playLabel: string;
  pauseLabel: string;
  onToggle: () => void;
}): ReactNode {
  return (
    <div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
      <button
        type="button"
        aria-label={showPause ? pauseLabel : playLabel}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onToggle();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-[var(--ink)] shadow-sm ring-1 ring-black/10 transition hover:bg-white/95"
      >
        {showPause ? (
          <HiOutlinePause className="h-4 w-4" strokeWidth={2} />
        ) : (
          <HiOutlinePlay className="h-4 w-4 translate-x-[1px]" strokeWidth={2} />
        )}
      </button>
    </div>
  );
}

/** Video-style bottom bar scaled for small square asset tiles. */
export function AssetCardPlaybackBar({
  media,
  knownDuration,
  visible = true,
}: {
  media: VideoMediaControl | null;
  knownDuration?: number;
  visible?: boolean;
}): ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [chromeFit, setChromeFit] = useState({ layoutW: 240, fit: 1 });

  useEffect(() => {
    const el = hostRef.current?.parentElement;
    if (!el) return undefined;
    const sync = () => {
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      const layoutW = 240;
      const fit = Math.min(1, w / layoutW, h / VIDEO_PLAYBACK_BAR_H);
      setChromeFit({
        layoutW,
        fit: Math.max(fit, w / layoutW),
      });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-[2]">
      <div
        className="pointer-events-none absolute bottom-0 left-0 overflow-visible"
        style={{
          width: chromeFit.layoutW,
          height: VIDEO_PLAYBACK_BAR_H,
          transform: `scale(${chromeFit.fit})`,
          transformOrigin: '0 100%',
        }}
      >
        <VideoPlaybackBar
          media={media}
          visible={visible}
          knownDuration={knownDuration}
          scale={1}
          className="pointer-events-auto absolute inset-x-0 bottom-0"
        />
      </div>
    </div>
  );
}
