import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AspectRatioGlyph } from '@/components/editor/panels/agent/shared/ImageAspectRatioPicker';
import { cn } from '@/utils/classnames';

export const VIDEO_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;
export const DEFAULT_VIDEO_ASPECT_RATIO = '16:9';

export const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p'] as const;
export const DEFAULT_VIDEO_RESOLUTION = '720p';

export const VIDEO_DURATIONS = [4, 5, 6, 7, 8, 10, 12, 15] as const;
export const DEFAULT_VIDEO_DURATION = 5;

function VideoSegmentedTrack({ children }: { children: ReactNode }): ReactNode {
  return <div className="flex flex-wrap gap-1 rounded-xl bg-[var(--rail)] p-1">{children}</div>;
}

function VideoSegmentPill({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex min-w-[2.75rem] flex-1 items-center justify-center rounded-lg px-2 py-2 text-[12px] font-medium tabular-nums transition disabled:opacity-40',
        active
          ? 'bg-[var(--surface)] text-[var(--ink)] shadow-[0_1px_3px_rgba(15,23,42,0.12)]'
          : 'bg-transparent text-[var(--muted)] hover:text-[var(--ink)]'
      )}
    >
      {children}
    </button>
  );
}

/** Aspect / resolution / duration — shared by VideoGeneratorCard and AgentComposerShell. */
export function VideoSettingsPanel({
  aspectRatio,
  resolution,
  duration,
  onAspectRatioChange,
  onResolutionChange,
  onDurationChange,
  disabled,
}: {
  aspectRatio: string;
  resolution: string;
  duration: number;
  onAspectRatioChange: (ratio: string) => void;
  onResolutionChange: (resolution: string) => void;
  onDurationChange: (duration: number) => void;
  disabled?: boolean;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-[12px] font-medium text-[var(--muted)]">{t('agent.chooseRatio')}</p>
        <div className="flex items-start justify-between gap-0.5 rounded-xl bg-[var(--rail)] p-1">
          {VIDEO_ASPECT_RATIOS.map((ratio) => {
            const active = aspectRatio === ratio;
            return (
              <button
                key={ratio}
                type="button"
                disabled={disabled}
                title={ratio}
                onClick={(e) => {
                  e.stopPropagation();
                  onAspectRatioChange(ratio);
                }}
                className={cn(
                  'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-0.5 py-1.5 transition-colors disabled:opacity-40',
                  active
                    ? 'bg-[var(--surface)] text-[var(--ink)] shadow-[0_1px_3px_rgba(15,23,42,0.12)]'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                )}
              >
                <AspectRatioGlyph ratio={ratio} size={20} />
                <span className="max-w-full truncate text-[10px] font-medium tabular-nums">
                  {ratio}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[12px] font-medium text-[var(--muted)]">
          {t('agent.chooseResolution')}
        </p>
        <VideoSegmentedTrack>
          {VIDEO_RESOLUTIONS.map((r) => (
            <VideoSegmentPill
              key={r}
              active={resolution === r}
              disabled={disabled}
              onClick={() => onResolutionChange(r)}
            >
              {r}
            </VideoSegmentPill>
          ))}
        </VideoSegmentedTrack>
      </div>

      <div>
        <p className="mb-2 text-[12px] font-medium text-[var(--muted)]">
          {t('editor.tools.videoDuration', { defaultValue: 'Duration' })}
        </p>
        <VideoSegmentedTrack>
          {VIDEO_DURATIONS.map((n) => (
            <VideoSegmentPill
              key={n}
              active={duration === n}
              disabled={disabled}
              onClick={() => onDurationChange(n)}
            >
              {t('editor.tools.videoDurationNs', { n })}
            </VideoSegmentPill>
          ))}
        </VideoSegmentedTrack>
      </div>
    </div>
  );
}
