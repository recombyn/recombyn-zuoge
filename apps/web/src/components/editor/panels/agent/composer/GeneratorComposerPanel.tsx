import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/utils/classnames';

/** Shared outer panel for on-canvas generator / quick-edit composers. */
export const GENERATOR_COMPOSER_PANEL_BASE =
  'flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_8px_28px_rgba(15,23,42,0.12)]';

export const GENERATOR_COMPOSER_PANEL_SIZE_CLASS = {
  default: 'h-[200px] w-[500px]',
  compact: 'h-[160px] w-[420px]',
} as const;

export type GeneratorComposerPanelSize = keyof typeof GENERATOR_COMPOSER_PANEL_SIZE_CLASS;

export function GeneratorComposerPanel({
  children,
  overflow = 'hidden',
  size = 'default',
  className,
  style,
}: {
  children: ReactNode;
  overflow?: 'hidden' | 'visible';
  size?: GeneratorComposerPanelSize;
  className?: string;
  style?: CSSProperties;
}): ReactNode {
  return (
    <div
      style={style}
      className={cn(
        GENERATOR_COMPOSER_PANEL_BASE,
        GENERATOR_COMPOSER_PANEL_SIZE_CLASS[size],
        overflow === 'visible' ? 'overflow-visible' : 'overflow-hidden',
        className
      )}
    >
      {children}
    </div>
  );
}
