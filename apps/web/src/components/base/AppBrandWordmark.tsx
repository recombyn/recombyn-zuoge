import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/classnames';

/** CJK 「左格」 lockup aspect (ink → alpha PNG under /brand/). */
export const ZUOGE_WORDMARK_ASPECT = 490 / 192;
/** Latin `zuoge` graphic wordmark aspect. */
export const ZUOGE_WORDMARK_EN_ASPECT = 534 / 148;

type Props = {
  /** Cap height in px. */
  size?: number;
  className?: string;
  /** @deprecated Ignored — brand is always the graphic wordmark (no leading icon). */
  mark?: boolean;
  /** @deprecated Ignored — graphic sheet has fixed casing. */
  lowercase?: boolean;
};

/**
 * Chinese locales use graphic 「左格」; Japanese/English use Latin `zuoge`.
 * 「左格」is the CN brand lockup — not appropriate for `ja` UI copy.
 */
function useCjkBrand(): boolean {
  const { i18n, t } = useTranslation();
  const name = t('app.name');
  const lng = String(i18n.resolvedLanguage || i18n.language || '');
  return /^zh\b/i.test(lng) || name === '左格';
}

/**
 * Designed brand wordmark via CSS mask (not live `<text>`).
 * Fill is currentColor so light/dark and on-brand chrome stay correct.
 * `height` may be a px number or any CSS length (e.g. `100%` / `1em`).
 */
function ZuogeWordmarkSvg({
  height,
  variant = 'cjk',
}: {
  height: number | string;
  variant?: 'cjk' | 'en';
}) {
  const aspect = variant === 'en' ? ZUOGE_WORDMARK_EN_ASPECT : ZUOGE_WORDMARK_ASPECT;
  const sizeStyle =
    typeof height === 'number'
      ? { width: aspect * height, height }
      : { width: '100%', height: '100%' };
  return (
    <span
      aria-hidden
      className={cn(
        'block shrink-0',
        variant === 'en' ? 'app-brand-wordmark-mask-en' : 'app-brand-wordmark-mask'
      )}
      style={sizeStyle}
    />
  );
}

/**
 * Product wordmark — zh uses graphic 「左格」; ja/en use Latin `zuoge`.
 * Pair with text-[var(--ink)] or text-[var(--on-brand)] for theme contrast.
 */
function AppBrandWordmark({ size = 20, className }: Props) {
  const cjk = useCjkBrand();
  const variant = cjk ? 'cjk' : 'en';
  return (
    <span
      className={cn(
        'app-brand-wordmark-cjk inline-flex min-w-0 items-center text-[var(--ink)]',
        className
      )}
      style={{ height: size, lineHeight: 1 }}
      aria-hidden
    >
      <ZuogeWordmarkSvg height={size} variant={variant} />
    </span>
  );
}

export default memo(AppBrandWordmark);
export { ZuogeWordmarkSvg, useCjkBrand };
