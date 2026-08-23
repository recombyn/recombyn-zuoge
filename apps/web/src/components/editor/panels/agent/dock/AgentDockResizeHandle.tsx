import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  width: number;
  minWidth: number;
  maxWidth: number;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onResetWidth: () => void;
};

/** Left-edge drag handle for the dock panel width. */
function AgentDockResizeHandle({
  width,
  minWidth,
  maxWidth,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onResetWidth,
}: Props): ReactNode {
  const { t } = useTranslation();

  return (
    <div
      role="slider"
      aria-orientation="vertical"
      aria-label={t('agent.resizeDock')}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      tabIndex={0}
      className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize touch-none hover:bg-[var(--accent)]/25 active:bg-[var(--accent)]/40"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onResetWidth}
    />
  );
}

export default AgentDockResizeHandle;
