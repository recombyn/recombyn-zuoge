import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import { cn } from '@/utils/classnames';

/** Shared outer panel for on-canvas generator / quick-edit composers. */
export const GENERATOR_COMPOSER_PANEL_BASE =
  'pointer-events-auto flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_8px_28px_rgba(15,23,42,0.12)]';

export const GENERATOR_COMPOSER_PANEL_SIZE_CLASS = {
  default: 'h-[200px] w-[500px]',
  /** Audio quick-edit / generator plate. */
  audio: 'h-[180px] w-[440px]',
  compact: 'h-[160px] w-[420px]',
} as const;

/** Stop canvas pointer routing while interacting inside the composer panel. */
export function stopComposerPanelPointer(e: PointerEvent<HTMLElement>) {
  e.stopPropagation();
  e.nativeEvent.stopImmediatePropagation?.();
}

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
      onPointerDown={stopComposerPanelPointer}
    >
      {children}
    </div>
  );
}

/** Upload / wait state — same shell as ImageQuickEditComposer when src is not ready. */
export function GeneratorComposerUploadPanel({
  label,
  size = 'default',
  className,
}: {
  label: ReactNode;
  size?: GeneratorComposerPanelSize;
  className?: string;
}): ReactNode {
  return (
    <GeneratorComposerPanel
      size={size}
      className={cn('items-center justify-center text-[13px] text-[var(--muted)]', className)}
    >
      {label}
    </GeneratorComposerPanel>
  );
}
