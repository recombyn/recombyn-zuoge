/**
 * Locale sent to the API (`Accept-Language` / design `locale` body).
 * UI chrome stays in FE i18n; API user-facing errors are localized on the backend.
 */
import { basenameToI18nLang, getLocaleBasename, LOCALE_STORAGE_KEY, normalizeI18nLang } from './localePath';

/** Current UI locale for backend requests. */
export function getApiLocale(): string {
  if (typeof window === 'undefined') return 'zh-CN';
  const basename = getLocaleBasename(window.location.pathname);
  if (basename) return basenameToI18nLang(basename);
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored) return normalizeI18nLang(stored);
  } catch {
    /* ignore */
  }
  const nav = navigator.language || '';
  return normalizeI18nLang(nav);
}

export function acceptLanguageHeader(): Record<string, string> {
  return { 'Accept-Language': getApiLocale() };
}
