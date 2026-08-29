import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AspectRatioGlyph } from '@/components/editor/panels/agent/shared/ImageAspectRatioPicker';
import { cn } from '@/utils/classnames';

export const LOTTIE_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const;
export const DEFAULT_LOTTIE_ASPECT = '1:1';

export const LOTTIE_DURATIONS = [1, 2, 3, 5, 8, 10] as const;
export const DEFAULT_LOTTIE_DURATION = 3;

/** Aspect + duration — shared by AnimationGeneratorCard (and optionally QuickEdit). */
export function AnimationSettingsPanel({
  aspectRatio,
  duration,
  onAspectRatioChange,
  onDurationChange,
  disabled,
  showAspect = true,
}: {
  aspectRatio: string;
  duration: number;
  onAspectRatioChange: (ratio: string) => void;
  onDurationChange: (duration: number) => void;
  disabled?: boolean;
  /** Quick-edit only needs duration chips. */
  showAspect?: boolean;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      {showAspect ? (
        <div>
          <p className="mb-2 text-[12px] font-medium text-[var(--muted)]">{t('agent.chooseRatio')}</p>
          <div className="flex items-start justify-between gap-0.5 rounded-xl bg-[var(--rail)] p-1">
            {LOTTIE_ASPECT_RATIOS.map((ratio) => {
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
      ) : null}

      <div>
        <p className="mb-2 text-[12px] font-medium text-[var(--muted)]">
          {t('editor.tools.lottieDuration')}
        </p>
        <div className="flex flex-wrap gap-1 rounded-xl bg-[var(--rail)] p-1">
          {LOTTIE_DURATIONS.map((n) => {
            const active = duration === n;
            return (
              <button
                key={n}
                type="button"
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  onDurationChange(n);
                }}
                className={cn(
                  'flex min-w-[2.75rem] flex-1 items-center justify-center rounded-lg px-2 py-2 text-[12px] font-medium tabular-nums transition disabled:opacity-40',
                  active
                    ? 'bg-[var(--surface)] text-[var(--ink)] shadow-[0_1px_3px_rgba(15,23,42,0.12)]'
                    : 'bg-transparent text-[var(--muted)] hover:text-[var(--ink)]'
                )}
              >
                {t('editor.tools.lottieDurationNs', { n })}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
