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
  onPlayPause: () => void;
  onStepFrame: (dir: -1 | 1) => void;
  onSeekEdge: (toEnd: boolean) => void;
  onToggleLoop: () => void;
  className?: string;
};

const BTN =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--ink)] hover:bg-[var(--accent-soft)]';

function IconBtn({
  tip,
  onClick,
  children,
  active,
  muted,
}: {
  tip: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  muted?: boolean;
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
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function LottieTransportControls({
  playing,
  loop,
  onPlayPause,
  onStepFrame,
  onSeekEdge,
  onToggleLoop,
  className,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className={cn('inline-flex items-center gap-0.5', className)} role="group">
      <IconBtn
        tip={t('editor.lottieToolbar.toStart', { defaultValue: '跳到开头' })}
        onClick={() => onSeekEdge(false)}
      >
        <TbPlayerSkipBack className="h-4 w-4" strokeWidth={1.75} />
      </IconBtn>
      <IconBtn
        tip={t('editor.lottieToolbar.prevFrame', { defaultValue: '上一帧' })}
        onClick={() => onStepFrame(-1)}
      >
        <TbPlayerTrackPrev className="h-4 w-4" strokeWidth={1.75} />
      </IconBtn>
      <IconBtn
        tip={
          playing
            ? t('editor.lottieToolbar.pause', { defaultValue: '暂停' })
            : t('editor.lottieToolbar.play', { defaultValue: '播放' })
        }
        onClick={onPlayPause}
      >
        {playing ? (
          <HiOutlinePause className="h-4 w-4" strokeWidth={1.75} />
        ) : (
          <HiOutlinePlay className="h-4 w-4" strokeWidth={1.75} />
        )}
      </IconBtn>
      <IconBtn
        tip={t('editor.lottieToolbar.nextFrame', { defaultValue: '下一帧' })}
        onClick={() => onStepFrame(1)}
      >
        <TbPlayerTrackNext className="h-4 w-4" strokeWidth={1.75} />
      </IconBtn>
      <IconBtn
        tip={t('editor.lottieToolbar.toEnd', { defaultValue: '跳到结尾' })}
        onClick={() => onSeekEdge(true)}
      >
        <TbPlayerSkipForward className="h-4 w-4" strokeWidth={1.75} />
      </IconBtn>
      <IconBtn
        tip={
          loop
            ? t('editor.lottieToolbar.loopOn', { defaultValue: '循环（点击关闭）' })
            : t('editor.lottieToolbar.loopOff', { defaultValue: '不循环（点击开启）' })
        }
        onClick={onToggleLoop}
        active={loop}
        muted={!loop}
      >
        {loop ? (
          <TbRepeat className="h-4 w-4" strokeWidth={1.75} />
        ) : (
          <TbRepeatOff className="h-4 w-4" strokeWidth={1.75} />
        )}
      </IconBtn>
    </div>
  );
}

export default memo(LottieTransportControls);
