/**
 * Compact playback transport: to-start / prev / play / next / to-end / loop.
 * Loop toggles between repeat and repeat-off icons (no text label).
 */
import { memo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlinePause, HiOutlinePlay } from 'react-icons/hi2';
import {
  TbPlayerSkipBack,
  TbPlayerSkipForward,
  TbPlayerTrackNext,
  TbPlayerTrackPrev,
  TbRepeat,
  TbRepeatOff,
} from 'react-icons/tb';
import Tooltip from '@/components/base/tooltip';
import { cn } from '@/utils/classnames';

type Props = {
  playing: boolean;
  loop: boolean;
  /** When false, transport looks idle (play icon) and play/seek controls are disabled. */
  ready?: boolean;
  onPlayPause: () => void;
  onStepFrame: (dir: -1 | 1) => void;
  onSeekEdge: (toEnd: boolean) => void;
  onToggleLoop: () => void;
  className?: string;
};

const BTN =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--ink)] hover:bg-[var(--accent-soft)] disabled:pointer-events-none disabled:opacity-40 disabled:hover:bg-transparent';

function IconBtn({
  tip,
  onClick,
  children,
  active,
  muted,
  disabled,
}: {
  tip: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  muted?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tooltip tip={tip} placement="top">
      <button
        type="button"
        className={cn(
          BTN,
          active && 'bg-[var(--accent-soft)]',
          muted && 'text-[var(--muted)]'
        )}
        aria-label={tip}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function AnimationTransportControls({
  playing,
  loop,
  ready = true,
  onPlayPause,
  onStepFrame,
  onSeekEdge,
  onToggleLoop,
  className,
}: Props) {
  const { t } = useTranslation();
  const showPlaying = ready && playing;
  return (
    <div className={cn('inline-flex items-center gap-0.5', className)} role="group">
      <IconBtn
        tip={t('editor.lottieToolbar.toStart')}
        onClick={() => onSeekEdge(false)}
        disabled={!ready}
      >
        <TbPlayerSkipBack className="h-3.5 w-3.5" strokeWidth={1.75} />
      </IconBtn>
      <IconBtn
        tip={t('editor.lottieToolbar.prevFrame')}
        onClick={() => onStepFrame(-1)}
        disabled={!ready}
      >
        <TbPlayerTrackPrev className="h-3.5 w-3.5" strokeWidth={1.75} />
      </IconBtn>
      <IconBtn
        tip={
          !ready
            ? t('editor.lottieToolbar.playUnavailable')
            : showPlaying
              ? t('editor.lottieToolbar.pause')
              : t('editor.lottieToolbar.play')
        }
        onClick={onPlayPause}
        disabled={!ready}
      >
        {showPlaying ? (
          <HiOutlinePause className="h-3.5 w-3.5" strokeWidth={1.75} />
        ) : (
          <HiOutlinePlay className="h-3.5 w-3.5" strokeWidth={1.75} />
        )}
      </IconBtn>
      <IconBtn
        tip={t('editor.lottieToolbar.nextFrame')}
        onClick={() => onStepFrame(1)}
        disabled={!ready}
      >
        <TbPlayerTrackNext className="h-3.5 w-3.5" strokeWidth={1.75} />
      </IconBtn>
      <IconBtn
        tip={t('editor.lottieToolbar.toEnd')}
        onClick={() => onSeekEdge(true)}
        disabled={!ready}
      >
        <TbPlayerSkipForward className="h-3.5 w-3.5" strokeWidth={1.75} />
      </IconBtn>
      <IconBtn
        tip={
          loop
            ? t('editor.lottieToolbar.loopOn')
            : t('editor.lottieToolbar.loopOff')
        }
        onClick={onToggleLoop}
        active={loop}
        muted={!loop}
        disabled={!ready}
      >
        {loop ? (
          <TbRepeat className="h-3.5 w-3.5" strokeWidth={1.75} />
        ) : (
          <TbRepeatOff className="h-3.5 w-3.5" strokeWidth={1.75} />
        )}
      </IconBtn>
    </div>
  );
}

export default memo(AnimationTransportControls);
