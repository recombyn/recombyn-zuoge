import { memo, type ReactNode } from 'react';
import { cn } from '@/utils/classnames';

export type LoadingDotsSize = 'sm' | 'lg';

type LoadingDotsProps = {
  size?: LoadingDotsSize;
  /** Screen-reader status. Omit when the parent already exposes busy/label. */
  label?: string;
  className?: string;
};

/**
 * Three-dot pulse used as the in-panel loading indicator
 * (lists, pickers, account panes — not boot splash / progress).
 */
function LoadingDots({
  size = 'sm',
  label,
  className,
}: LoadingDotsProps): ReactNode {
  const labelled = Boolean(label);

  return (
    <div
      className={cn('flex items-center justify-center', className)}
      role={labelled ? 'status' : undefined}
      aria-busy={labelled || undefined}
      aria-label={label}
    >
      <span
        className={cn('rcb-loading-dots', size === 'lg' && 'rcb-loading-dots--lg')}
        aria-hidden
      >
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

export default memo(LoadingDots);
