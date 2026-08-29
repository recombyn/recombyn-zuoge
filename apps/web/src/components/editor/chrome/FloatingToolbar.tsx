import { forwardRef, memo, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/utils/classnames';

type FloatingToolbarProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  /** Transparent / unstyled chrome (e.g. icon-only host). */
  bare?: boolean;
  /**
   * `pill` — floating capsule (default).
   * `flat` — square strip for timeline-docked chrome (no radius / soft shadow).
   */
  variant?: 'pill' | 'flat';
};

/**
 * Floating editor toolbar chrome — pill ends, or flat when docked to the timeline.
 */
export const FloatingToolbar = memo(
  forwardRef<HTMLDivElement, FloatingToolbarProps>(
    function FloatingToolbar({
      bare = false,
      variant = 'pill',
      className,
      children,
      ...rest
    }, ref) {
      const flat = variant === 'flat';
      return (
        <div
          ref={ref}
          className={cn(
            'flex shrink-0 items-center gap-0.5 whitespace-nowrap',
            bare
              ? 'rounded-none bg-transparent p-0 shadow-none ring-0'
              : flat
                ? 'rounded-none bg-transparent px-1 py-0.5 shadow-none ring-0'
                : 'rounded-full bg-[var(--surface)] px-1.5 py-1 shadow-[0_8px_28px_rgba(15,23,42,0.16)] ring-1 ring-[var(--line)]',
            className
          )}
          {...rest}
        >
          {children}
        </div>
      );
    }
  )
);
