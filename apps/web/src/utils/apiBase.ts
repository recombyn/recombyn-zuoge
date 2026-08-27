/**
 * Desktop build bakes API host at compile time.
 * Browser / self-host web keeps relative `/api/...` (Vite proxy or nginx).
 */

export type DesktopMode = 'cloud';

declare const __DESKTOP_MODE__: string;
declare const __API_BASE_URL__: string;

function readBaked(name: 'mode' | 'base'): string {
  try {
    if (name === 'mode') {
      return String(typeof __DESKTOP_MODE__ !== 'undefined' ? __DESKTOP_MODE__ : '').trim();
    }
    return String(typeof __API_BASE_URL__ !== 'undefined' ? __API_BASE_URL__ : '').trim();
  } catch {
    return '';
  }
}

/** `cloud` when this is a desktop build; otherwise null (browser web). */
export function getDesktopMode(): DesktopMode | null {
  const raw = (
    import.meta.env.VITE_DESKTOP_MODE ||
    readBaked('mode') ||
    ''
  )
    .trim()
    .toLowerCase();
  if (raw === 'cloud') return 'cloud';
  return null;
}

/** Browser on loopback — internal dev stack (Vite :3000 + API :8000). */
export function isLocalDevHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/**
 * Local dev: chunk uploads bypass Vite proxy (Node HTTP parser → 413 on large bodies).
 * Returns e.g. `http://127.0.0.1:8000`; empty in prod / remote API builds.
 */
export function getLocalDevApiOrigin(): string {
  if (!isLocalDevHost()) return '';
  const baked = getApiBaseUrl().replace(/\/$/, '');
  if (baked && /127\.0\.0\.1|localhost/i.test(baked)) return baked;
  if (baked && !/127\.0\.0\.1|localhost/i.test(baked)) return '';
  const port = String(import.meta.env.VITE_DEV_API_PORT || '8000').trim() || '8000';
  return `http://127.0.0.1:${port}`;
}

/** Tauri desktop shell. */
export function isDesktopShell(): boolean {
  return getDesktopMode() !== null;
}

/** Origin for API calls; empty string → same-origin relative paths. */
export function getApiBaseUrl(): string {
  const explicit = (
    import.meta.env.VITE_API_BASE_URL ||
    readBaked('base') ||
    ''
  )
    .trim()
    .replace(/\/$/, '');
  if (explicit) return explicit;
  return '';
}

/** Turn `/api/v1/...` (or any absolute URL) into a fetchable URL for the active flavor. */
export function resolveApiUrl(pathOrUrl: string): string {
  const raw = (pathOrUrl || '').trim();
  if (!raw) return raw;
  if (/^(https?:|data:|blob:|tauri:)/i.test(raw)) return raw;
  const base = getApiBaseUrl();
  if (!base) return raw;
  if (raw.startsWith('/')) return `${base}${raw}`;
  return `${base}/${raw}`;
}
