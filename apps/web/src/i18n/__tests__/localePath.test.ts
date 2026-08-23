import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  detectNavigatorI18nLang,
  redirectToPreferredLocaleIfNeeded,
  resolvePreferredI18nLang,
  shouldSkipLocaleAutoRedirect,
  LOCALE_STORAGE_KEY,
} from '@/i18n/localePath';

describe('detectNavigatorI18nLang', () => {
  it('maps zh / ja / en variants', () => {
    expect(detectNavigatorI18nLang(['zh-CN'])).toBe('zh-CN');
    expect(detectNavigatorI18nLang(['zh-Hans-CN'])).toBe('zh-CN');
    expect(detectNavigatorI18nLang(['zh-TW'])).toBe('zh-TW');
    expect(detectNavigatorI18nLang(['zh-HK'])).toBe('zh-TW');
    expect(detectNavigatorI18nLang(['ja-JP'])).toBe('ja');
    expect(detectNavigatorI18nLang(['en-US'])).toBe('en');
  });

  it('uses first supported candidate', () => {
    expect(detectNavigatorI18nLang(['fr-FR', 'zh-CN', 'en'])).toBe('zh-CN');
  });

  it('falls back to English', () => {
    expect(detectNavigatorI18nLang(['fr-FR', 'de'])).toBe('en');
    expect(detectNavigatorI18nLang([])).toBe('en');
  });
});

describe('shouldSkipLocaleAutoRedirect', () => {
  it('skips Google OAuth callback', () => {
    expect(shouldSkipLocaleAutoRedirect('/login/google/callback')).toBe(true);
    expect(shouldSkipLocaleAutoRedirect('/zh/login/google/callback')).toBe(true);
    expect(shouldSkipLocaleAutoRedirect('/home')).toBe(false);
  });
});

describe('redirectToPreferredLocaleIfNeeded', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('redirects first visit from browser zh to /zh/...', () => {
    const assign = vi.fn();
    const languagesSpy = vi
      .spyOn(window.navigator, 'languages', 'get')
      .mockReturnValue(['zh-CN', 'en'] as unknown as readonly string[]);
    const redirected = redirectToPreferredLocaleIfNeeded(
      { pathname: '/home', search: '?x=1', hash: '' },
      assign
    );
    expect(redirected).toBe(true);
    expect(assign).toHaveBeenCalledWith('/zh/home?x=1');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh-CN');
    languagesSpy.mockRestore();
  });

  it('does not redirect when preferred is English', () => {
    const assign = vi.fn();
    const languagesSpy = vi
      .spyOn(window.navigator, 'languages', 'get')
      .mockReturnValue(['en-US'] as unknown as readonly string[]);
    const redirected = redirectToPreferredLocaleIfNeeded(
      { pathname: '/home', search: '', hash: '' },
      assign
    );
    expect(redirected).toBe(false);
    expect(assign).not.toHaveBeenCalled();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    languagesSpy.mockRestore();
  });

  it('respects stored choice over navigator', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'ja');
    const assign = vi.fn();
    const languagesSpy = vi
      .spyOn(window.navigator, 'languages', 'get')
      .mockReturnValue(['zh-CN'] as unknown as readonly string[]);
    expect(resolvePreferredI18nLang()).toBe('ja');
    const redirected = redirectToPreferredLocaleIfNeeded(
      { pathname: '/home', search: '', hash: '' },
      assign
    );
    expect(redirected).toBe(true);
    expect(assign).toHaveBeenCalledWith('/ja/home');
    languagesSpy.mockRestore();
  });

  it('does not redirect when URL already has a locale prefix', () => {
    const assign = vi.fn();
    const redirected = redirectToPreferredLocaleIfNeeded(
      { pathname: '/zh/home', search: '', hash: '' },
      assign
    );
    expect(redirected).toBe(false);
    expect(assign).not.toHaveBeenCalled();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh-CN');
  });

  it('skips oauth callback even without stored lang', () => {
    const assign = vi.fn();
    const redirected = redirectToPreferredLocaleIfNeeded(
      { pathname: '/login/google/callback', search: '?code=1', hash: '' },
      assign
    );
    expect(redirected).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });
});
