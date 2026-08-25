import { memo } from 'react';
import { cn } from '@/utils/classnames';

/** Latin `zuoge` graphic wordmark aspect (ink → alpha PNG under /brand/). */
export const ZUOGE_WORDMARK_EN_ASPECT = 534 / 148;
/** @deprecated Prefer `ZUOGE_WORDMARK_EN_ASPECT` — product wordmark is Latin-only. */
export const ZUOGE_WORDMARK_ASPECT = ZUOGE_WORDMARK_EN_ASPECT;

type Props = {
  /** Cap height in px. */
  size?: number;
  className?: string;
  /** @deprecated Ignored — brand is always the graphic wordmark (no leading icon). */
  mark?: boolean;
  /** @deprecated Ignored — Latin wordmark is the graphic sheet (always lowercase art). */
  lowercase?: boolean;
};

/**
 * Designed brand wordmark via CSS mask (not live `<text>`).
 * Fill is currentColor so light/dark and on-brand chrome stay correct.
 * `height` may be a px number or any CSS length (e.g. `100%` / `1em`).
 */
function ZuogeWordmarkSvg({ height }: { height: number | string; locale?: 'cjk' | 'en' }) {
  const aspect = ZUOGE_WORDMARK_EN_ASPECT;
  const sizeStyle =
    typeof height === 'number'
      ? { width: aspect * height, height }
      : { width: '100%', height: '100%' };
  return (
    <span
      aria-hidden
      className="block shrink-0 app-brand-wordmark-mask-en"
      style={sizeStyle}
    />
  );
}

/**
 * Product wordmark — Latin `zuoge` graphic mask (not live UI text).
 * Pair with text-[var(--ink)] or text-[var(--on-brand)] for theme contrast.
 */
function AppBrandWordmark({ size = 20, className }: Props) {
  return (
    <span
      className={cn(
        'app-brand-wordmark-cjk inline-flex min-w-0 items-center text-[var(--ink)]',
        className
      )}
      style={{ height: size, lineHeight: 1 }}
      aria-hidden
    >
      <ZuogeWordmarkSvg height={size} />
    </span>
  );
}

export default memo(AppBrandWordmark);
export { ZuogeWordmarkSvg };
