import { memo, type CSSProperties, ReactNode } from 'react';
import { cn } from '@/utils/classnames';
import './style.css';

declare global {
  interface Window {
    __recombynBootPct?: number;
  }
}

/** Module + window high-water mark so HTML → Suspense → Editor never jumps backward. */
let bootHighWater = 0;

function clampBootPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Current boot percent (never below the highest value already shown). */
export function readBootProgress(): number {
  const fromWin =
    typeof window !== 'undefined' ? clampBootPct(Number(window.__recombynBootPct) || 0) : 0;
  return Math.max(bootHighWater, fromWin);
}

/** Raise boot percent only (ignores lower values). Returns the new high-water mark. */
export function advanceBootProgress(next: number): number {
  const n = clampBootPct(next);
  bootHighWater = Math.max(bootHighWater, n);
  if (typeof window !== 'undefined') {
    window.__recombynBootPct = Math.max(Number(window.__recombynBootPct) || 0, bootHighWater);
  }
  return bootHighWater;
}

/** Call when the boot overlay fully dismisses so the next visit can start fresh. */
export function resetBootProgress() {
  bootHighWater = 0;
  if (typeof window !== 'undefined') {
    window.__recombynBootPct = 0;
  }
}

export type ProgressBarProps = {
  /** 0–100 */
  percent: number;
  /** Ant Design `status="active"` 风格扫光 */
  active?: boolean;
  /** 轨道高度，默认 8（对齐图1 antd Progress） */
  height?: number;
  className?: string;
  trackClassName?: string;
  fillClassName?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  /** 右侧文案，如 `30% 改了画布`；不传则不显示 */
  format?: ((percent: number) => ReactNode) | false;
};

/**
 * 主站进度条（无 antd）：浅底 + 深色填充，可选扫光动画。
 */
function ProgressBar({
  percent,
  active = true,
  height = 8,
  className,
  trackClassName,
  fillClassName,
  style,
  'aria-label': ariaLabel,
  format,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const showInfo = format !== false && format != null;

  return (
    <div
      className={cn('rcb-progress', showInfo && 'rcb-progress--with-info', className)}
      style={style}
    >
      <div
        className={cn('rcb-progress__track', trackClassName)}
        style={{ height }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={ariaLabel}
      >
        <div
          className={cn(
            'rcb-progress__fill',
            active && pct > 0 && pct < 100 && 'rcb-progress__fill--active',
            fillClassName
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showInfo ? (
        <span className="rcb-progress__info">{format(Math.round(pct))}</span>
      ) : null}
    </div>
  );
}

export default memo(ProgressBar);
