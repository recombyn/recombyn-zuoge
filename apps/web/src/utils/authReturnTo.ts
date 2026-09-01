/**
 * Post-login / settings return path lives in the URL (`?from=...`), not the editor store / sessionStorage.
 */

import { stripLocalePrefix } from '@/i18n/localePath';

const BLOCKED_PREFIXES = [
  '/login',
  '/register',
  '/forgot-password',
  '/account',
];

/** Same-origin app path only; falls back to /home. Strips `/zh` etc. for Router basename. */
export function sanitizeReturnTo(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '/home';
  let path = raw.trim();
  try {
    // Allow accidental absolute same-origin URLs.
    if (/^https?:\/\//i.test(path)) {
      const u = new URL(path);
      if (typeof window !== 'undefined' && u.origin !== window.location.origin) return '/home';
      path = u.pathname + u.search + u.hash;
    }
  } catch {
    return '/home';
  }
  if (!path.startsWith('/') || path.startsWith('//')) return '/home';
  const pathnameOnly = path.split('?')[0].split('#')[0];
  const suffix = path.slice(pathnameOnly.length);
  const stripped = stripLocalePrefix(pathnameOnly);
  if (BLOCKED_PREFIXES.some((p) => stripped === p || stripped.startsWith(`${p}/`))) {
    return '/home';
  }
  return (stripped || '/home') + suffix;
}

/** `/home?login=1` or `/home?login=1&from=/editor/...` */
export function buildLoginUrl(from?: string | null): string {
  const dest = sanitizeReturnTo(from);
  if (dest === '/home') return '/home?login=1';
  return `/home?login=1&from=${encodeURIComponent(dest)}`;
}

function asSearchParams(
  search: string | URLSearchParams | null | undefined
): URLSearchParams | null {
  if (typeof search === 'string') {
    return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  }
  if (search instanceof URLSearchParams) return search;
  return null;
}

export function isLoginOpen(search: string | URLSearchParams | null | undefined): boolean {
  return asSearchParams(search)?.get('login') === '1';
}

/**
 * Append `?from=` (or `&from=`) so settings / about can return to the page the user left.
 * Omits the param when destination is already `/home`.
 */
export function withReturnTo(path: string, from?: string | null): string {
  const dest = sanitizeReturnTo(from);
  if (dest === '/home') return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}from=${encodeURIComponent(dest)}`;
}

export function readReturnToParam(
  search: string | URLSearchParams | null | undefined
): string {
  const params = asSearchParams(search);
  return sanitizeReturnTo(params?.get('from'));
}
