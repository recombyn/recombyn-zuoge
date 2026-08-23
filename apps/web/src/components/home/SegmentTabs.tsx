import { memo, type ReactNode } from 'react';
import { cn } from '@/utils/classnames';

type SegmentTabsProps<T extends string> = {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  /** Tab label size. Plaza filters = 14; profile = 16. */
  size?: 'sm' | 'md';
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
  'aria-label': ariaLabel,
}: SegmentTabsProps<T>): ReactNode {
  const labelSize = size === 'md' ? 'text-[16px]' : 'text-[14px]';
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
