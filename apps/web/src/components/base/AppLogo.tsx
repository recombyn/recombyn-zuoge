import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/classnames';

export type LogoScheme = 'dark' | 'light';

type Props = {
  /** Outer square size in px — always rendered 1:1. */
  size?: number;
  className?: string;
  bordered?: boolean;
  /**
   * `dark` — white feather on dark plate (`/logo-mark.png`), for light chrome.
   * `light` — dark feather on light plate (`/logo-mark-light.png`), for dark chrome.
   * `auto` / omit — follow `html[data-theme]` (light UI → dark plate, dark UI → light plate).
   */
  scheme?: LogoScheme | 'auto';
};

function readUiTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function useUiTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(readUiTheme);
  useEffect(() => {
    const sync = () => setTheme(readUiTheme());
    sync();
    const root = document.documentElement;
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

function resolveScheme(
  scheme: LogoScheme | 'auto' | undefined,
  uiTheme: 'light' | 'dark',
): LogoScheme {
  if (scheme === 'dark' || scheme === 'light') return scheme;
  // Dark UI chrome → light plate mark; light UI → dark plate mark.
  return uiTheme === 'dark' ? 'light' : 'dark';
}

function markSrc(scheme: LogoScheme): string {
  return scheme === 'light' ? '/logo-mark-light.png' : '/logo-mark.png';
}

/**
 * Brand mark — scheme picks the fixed plate (or follows theme when `auto`).
 * Used by: HomeBody, LoginDialog, DesktopTitlebar.
 */
function AppLogo({
  size = 36,
  className,
  bordered = false,
  scheme = 'auto',
}: Props) {
  const { t } = useTranslation();
  const uiTheme = useUiTheme();
  const resolved = resolveScheme(scheme, uiTheme);

  return (
    <img
      src={markSrc(resolved)}
      alt={t('app.name')}
      width={size}
      height={size}
      draggable={false}
      className={cn('block shrink-0', className)}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        maxWidth: size,
        maxHeight: size,
        aspectRatio: '1 / 1',
        objectFit: 'contain',
        flex: '0 0 auto',
        // Beat Tailwind preflight `img { height: auto }`
        // so flex parents cannot stretch the bitmap.
        ...(bordered
          ? { borderRadius: '36%', boxShadow: 'inset 0 0 0 1px var(--line)' }
          : null),
      }}
    />
  );
}

export default memo(AppLogo);

/** Drops the static `index.html` splash when the app shell mounts. */
export function dismissHtmlBootSplash() {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('boot-splash');
  if (!el) return;
  el.remove();
}
