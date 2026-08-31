import { memo } from 'react';
import { cn } from '@/utils/classnames';

type EmptyStateProps = {
  hint: string;
  className?: string;
};

/** Left-aligned empty hint — text only, no icon. */
function EmptyState({ hint, className }: EmptyStateProps) {
  return (
    <div className={cn('text-left text-[13px] text-[var(--muted)]', className)}>{hint}</div>
  );
}

export default memo(EmptyState);
