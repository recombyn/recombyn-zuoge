/**
 * Full-page Google OAuth (authorization code + redirect).
 * Navigates the current tab to accounts.google.com — not popup / iframe.
 * Return intent is encoded in the OAuth `state` query (URL), not Redux.
 */

import { sanitizeReturnTo } from '@/utils/authReturnTo';

declare const __GOOGLE_CLIENT_ID__: string;

export const GOOGLE_CLIENT_ID =
  typeof __GOOGLE_CLIENT_ID__ !== 'undefined' ? __GOOGLE_CLIENT_ID__ : '';

/** CSRF nonce only — intent path rides in the OAuth `state` URL param. */
const NONCE_KEY = 'recombyn-google-oauth-nonce-v1';

export function getGoogleRedirectUri(): string {
  return `${window.location.origin}/login/google/callback`;
}

function encodeReturnTo(returnTo: string): string {
  try {
    return btoa(unescape(encodeURIComponent(sanitizeReturnTo(returnTo))));
  } catch {
    return btoa('/home');
  }
}

function decodeReturnTo(encoded: string): string {
  try {
    return sanitizeReturnTo(decodeURIComponent(escape(atob(encoded))));
  } catch {
    return '/home';
  }
}

export function startGoogleOAuthRedirect(returnTo = '/home') {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_CLIENT_ID is not configured');
  }
  const nonce =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const safe = sanitizeReturnTo(returnTo);
  // state = nonce.returnTo — Google echoes this back via URL.
  const state = `${nonce}.${encodeReturnTo(safe)}`;
  try {
    sessionStorage.setItem(NONCE_KEY, nonce);
  } catch {
    /* ignore */
  }

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: getGoogleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

export function consumeGoogleOAuthState(
  stateFromQuery: string | null
): { returnTo: string } | null {
  try {
    const expected = sessionStorage.getItem(NONCE_KEY);
    sessionStorage.removeItem(NONCE_KEY);
    if (!stateFromQuery || !expected) return null;
    const dot = stateFromQuery.indexOf('.');
    if (dot <= 0) return null;
    const nonce = stateFromQuery.slice(0, dot);
    const encoded = stateFromQuery.slice(dot + 1);
    if (nonce !== expected) return null;
    return { returnTo: decodeReturnTo(encoded) };
  } catch {
    return null;
  }
}
