/**
 * Full-page Google OAuth (authorization code + redirect).
 * Navigates the current tab to accounts.google.com — not popup / iframe.
 * Return intent is encoded in the OAuth `state` query (URL), not the editor store.
 *
 * Client ID: prefer Vite bake-in for local dev; otherwise load from GET /auth/config
 * so Docker/GHCR images keep Google login without rebuilding the web image.
 */

import { fetchAuthConfig } from '@/service/auth';
import { sanitizeReturnTo } from '@/utils/authReturnTo';

declare const __GOOGLE_CLIENT_ID__: string;

/** CSRF nonce only — intent path rides in the OAuth `state` URL param. */
const NONCE_KEY = 'recombyn-google-oauth-nonce-v1';

let cachedApiClientId = '';

function bakedGoogleClientId(): string {
  if (typeof __GOOGLE_CLIENT_ID__ === 'undefined') return '';
  return String(__GOOGLE_CLIENT_ID__).trim();
}

/** Build-time id when present (local `apps/web/.env`). Empty on typical Docker/GHCR images. */
export const GOOGLE_CLIENT_ID = bakedGoogleClientId();

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

/** Resolve Google OAuth client id (bake-in, then API `/auth/config`). */
export async function resolveGoogleClientId(): Promise<string> {
  const baked = bakedGoogleClientId();
  if (baked) return baked;
  if (cachedApiClientId) return cachedApiClientId;
  const cfg = await fetchAuthConfig();
  const fromApi = String(cfg.googleClientId || '').trim();
  if (!fromApi) {
    throw new Error('GOOGLE_CLIENT_ID is not configured on the API');
  }
  cachedApiClientId = fromApi;
  return fromApi;
}

export async function startGoogleOAuthRedirect(returnTo = '/home') {
  const clientId = await resolveGoogleClientId();
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
    client_id: clientId,
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
