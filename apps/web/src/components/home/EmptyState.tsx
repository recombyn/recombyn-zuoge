import { memo, type ReactNode } from 'react';
import { HiOutlineInbox } from 'react-icons/hi2';
import { cn } from '@/utils/classnames';

type EmptyStateProps = {
  hint: string;
  /** Defaults to inbox (generic empty). Pass a contextual icon per surface. */
  icon?: ReactNode;
  className?: string;
};

/** Borderless empty hint: icon + text only (no dashed box / fill). */
function EmptyState({ hint, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-col items-center justify-center px-6 py-24 text-[var(--muted)]',
        className
      )}
    >
      {icon ?? <HiOutlineInbox className="mb-3 h-8 w-8 opacity-50" strokeWidth={1.25} />}
      <p className="text-center text-[13px]">{hint}</p>
    </div>
  );
}

export default memo(EmptyState);
