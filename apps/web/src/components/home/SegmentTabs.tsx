import { memo, type ReactNode } from 'react';
import { cn } from '@/utils/classnames';

type SegmentTabsProps<T extends string> = {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  /** Tab label size. Plaza filters = 14; profile = 16. */
  size?: 'sm' | 'md';
  /** plain = text-only; pill | track = segmented capsule; chips = separate buttons. */
  variant?: 'plain' | 'pill' | 'track' | 'chips';
  /** chips only — equal-width slots filling the tablist width. */
  fill?: boolean;
  /** chips only — keep tabs on one line (scroll if needed). */
  nowrap?: boolean;
  /** chips only — tighter padding for narrow toolbars. */
  compact?: boolean;
  /** Accessible name for the tablist. */
  'aria-label'?: string;
};

/**
 * Plain text tabs (no underline / no pill) — plaza & profile.
 * Active = ink; inactive = muted. Bold width is always reserved so switching
 * does not shift neighboring tabs / the page.
 */
function SegmentTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  size = 'sm',
  variant = 'plain',
  fill = false,
  nowrap = false,
  compact = false,
  'aria-label': ariaLabel,
}: SegmentTabsProps<T>): ReactNode {
  const labelSize = size === 'md' ? 'text-[16px]' : 'text-[14px]';
  const pillLabelSize = size === 'md' ? 'text-[14px]' : 'text-[13px]';
  const trackRing = 'ring-1 ring-[color-mix(in_srgb,var(--home-cta)_42%,var(--line))]';
  const activeTrackRing = 'ring-1 ring-[color-mix(in_srgb,var(--home-cta)_58%,var(--line))]';

  if (variant === 'chips') {
    return (
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={cn(
          fill
            ? 'flex w-full min-w-0 flex-nowrap items-stretch gap-1'
            : nowrap
              ? 'flex max-w-full flex-nowrap items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
              : 'flex max-w-full flex-wrap items-center gap-2',
          className
        )}
      >
        {tabs.map((tab) => {
          const active = value === tab.id;
          const chipPad = compact ? 'px-2 py-1' : 'px-3.5 py-1.5 sm:px-4';
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={cn(
                'relative inline-flex items-center rounded-lg border transition-colors',
                fill ? 'min-w-0 flex-1 basis-0 justify-center px-1 py-1.5' : cn('shrink-0', chipPad),
                pillLabelSize,
                active
                  ? 'border-[var(--line)] bg-[var(--surface)] font-semibold text-[var(--ink)] shadow-sm'
                  : 'border-transparent bg-[color-mix(in_srgb,var(--ink)_8%,var(--surface))] font-normal text-[var(--ink)]/75 hover:bg-[color-mix(in_srgb,var(--ink)_12%,var(--surface))] hover:text-[var(--ink)]'
              )}
              onClick={() => onChange(tab.id)}
            >
              <span className="invisible font-semibold" aria-hidden>
                {tab.label}
              </span>
              <span
                className={cn(
                  'absolute inset-0 flex items-center justify-center',
                  fill ? 'px-1' : chipPad
                )}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  if (variant === 'pill' || variant === 'track') {
    return (
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={cn(
          'inline-flex max-w-full flex-nowrap items-center gap-0.5 overflow-x-auto rounded-full',
          'bg-[color-mix(in_srgb,var(--ink)_4%,var(--rail))] p-1',
          trackRing,
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          className
        )}
      >
        {tabs.map((tab) => {
          const active = value === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={cn(
                'relative inline-flex shrink-0 items-center rounded-full px-3.5 py-1.5 transition-colors sm:px-4',
                pillLabelSize,
                active
                  ? cn(
                      'bg-[var(--surface)] font-semibold text-[var(--ink)]',
                      activeTrackRing
                    )
                  : 'font-normal text-[var(--ink)]/65 hover:text-[var(--ink)]'
              )}
              onClick={() => onChange(tab.id)}
            >
              <span className="invisible font-semibold" aria-hidden>
                {tab.label}
              </span>
              <span className="absolute inset-0 flex items-center justify-center px-3.5 sm:px-4">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('inline-flex max-w-full flex-wrap items-center gap-5', className)}
    >
      {tabs.map((tab) => {
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={cn(
              'relative inline-flex items-center transition-colors',
              labelSize,
              active
                ? 'font-semibold text-[var(--ink)]'
                : 'font-normal text-[var(--muted)] hover:text-[var(--ink)]'
            )}
            onClick={() => onChange(tab.id)}
          >
            {/* Invisible bold twin locks width — avoids jitter when weight changes. */}
            <span className="invisible font-semibold" aria-hidden>
              {tab.label}
            </span>
            <span className="absolute inset-0 flex items-center">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default memo(SegmentTabs) as typeof SegmentTabs;
