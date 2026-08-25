import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/classnames';

/** Cropped brand glyph sheet aspect (ink → alpha PNG under /brand/). */
export const ZUOGE_WORDMARK_ASPECT = 490 / 192;
const WORDMARK_ASPECT = ZUOGE_WORDMARK_ASPECT;

type Props = {
  /** Cap height in px. */
  size?: number;
  className?: string;
  /** @deprecated Ignored — CJK brand is always the graphic wordmark (no leading icon). */
  mark?: boolean;
  /** Force Latin wordmark to lowercase (login chrome). */
  lowercase?: boolean;
};

function useCjkBrand(): boolean {
  const { i18n, t } = useTranslation();
  const name = t('app.name');
  const lng = String(i18n.resolvedLanguage || i18n.language || '');
  return /^(zh|ja)\b/i.test(lng) || name === '左格';
}

/**
 * Designed 「左格」 wordmark via CSS mask (not live `<text>`).
 * Fill is currentColor so light/dark and on-brand chrome stay correct.
 * `height` may be a px number or any CSS length (e.g. `100%` / `1em`).
 */
function ZuogeWordmarkSvg({ height }: { height: number | string }) {
  const sizeStyle =
    typeof height === 'number'
      ? { width: WORDMARK_ASPECT * height, height }
      : { width: '100%', height: '100%' };
  return (
    <span
      aria-hidden
      className="app-brand-wordmark-mask block shrink-0"
      style={sizeStyle}
    />
  );
}

/**
 * Product wordmark — CJK is the graphic 「左格」; EN keeps Recombyn type.
 * Pair with text-[var(--ink)] or text-[var(--on-brand)] for theme contrast.
 */
function AppBrandWordmark({ size = 20, className, lowercase = false }: Props) {
  const { t } = useTranslation();
  const cjk = useCjkBrand();
  const name = t('app.name');

  if (cjk) {
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

  const label = lowercase
    ? name.toLowerCase()
    : name.charAt(0).toUpperCase() + name.slice(1);
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center truncate font-semibold leading-none tracking-tight text-[var(--ink)]',
        '[font-family:var(--font-hero-en),var(--font-hero),system-ui,sans-serif]',
        className
      )}
      style={{ fontSize: size, lineHeight: 1 }}
    >
      {label}
    </span>
  );
}

export default memo(AppBrandWordmark);
export { ZuogeWordmarkSvg };
