/**
 * Thin ky client for multipart / non-oRPC leftovers.
 * Prefer `apiClient` / `apiQuery` for JSON endpoints.
 */

import ky, { HTTPError, type Options } from 'ky';
import { getApiBaseUrl } from '@/utils/apiBase';
import { getToken, setToken } from '@/utils/token';

export type RequestConfig = {
  url: string;
  method?: string;
  data?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeout?: number;
  /** Skip in-flight GET dedupe (rare; default dedupes identical GETs). */
  skipInflightDedupe?: boolean;
};

function detailToText(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (!Array.isArray(detail)) return '';
  return detail
    .map((d) => {
      if (typeof d === 'string') return d;
      if (d && typeof d === 'object' && 'msg' in d) {
        return String((d as { msg?: unknown }).msg || '');
      }
      return '';
    })
    .filter(Boolean)
    .join(' ');
}

async function clearSessionOnAuthDead(res: Response): Promise<void> {
  if (res.status !== 401 && res.status !== 403) return;
  let detailText = '';
  try {
    const data = (await res.clone().json()) as { detail?: unknown };
    detailText = detailToText(data?.detail);
  } catch {
    /* ignore */
  }
  const authDead =
    res.status === 401 ||
    (res.status === 403 &&
      /could not validate credentials|not authenticated/i.test(detailText));
  if (!authDead) return;
  setToken(null);
  try {
    window.dispatchEvent(new CustomEvent('recombine:auth-unauthorized'));
  } catch {
    /* ignore */
  }
}

function resolveUrl(path: string): string {
  const base = getApiBaseUrl().replace(/\/$/, '');
  if (!base) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

const inflightGets = new Map<string, Promise<unknown>>();
const recentGets = new Map<string, { expires: number; value: unknown }>();
const RECENT_GET_TTL_MS = 1200;

function getInflightKey(config: RequestConfig): string | null {
  if (config.skipInflightDedupe) return null;
  const method = (config.method || 'get').toLowerCase();
  if (method !== 'get') return null;
  const auth = getToken() || '';
  return `${method}|${config.url}|${auth}`;
}

async function executeRequest<T>(config: RequestConfig, key: string | null): Promise<T> {
  const method = (config.method || 'get').toUpperCase();
  const token = getToken();
  const headers: Record<string, string> = { ...(config.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const isForm = typeof FormData !== 'undefined' && config.data instanceof FormData;
  const options: Options = {
    method,
    headers,
    signal: config.signal,
    timeout: config.timeout ?? 180_000,
    hooks: {
      afterResponse: [
        async ({ response }) => {
          await clearSessionOnAuthDead(response);
        },
      ],
    },
  };
  if (config.data != null && method !== 'GET' && method !== 'HEAD') {
    if (isForm) options.body = config.data as FormData;
    else options.json = config.data as Options['json'];
  }

  try {
    const data = await ky(resolveUrl(config.url), options).json<T>();
    if (key) {
      recentGets.set(key, { expires: Date.now() + RECENT_GET_TTL_MS, value: data });
    }
    return data;
  } catch (err) {
    if (err instanceof HTTPError) {
      await clearSessionOnAuthDead(err.response);
      let body: unknown;
      try {
        body = await err.response.clone().json();
      } catch {
        try {
          body = await err.response.clone().text();
        } catch {
          body = undefined;
        }
      }
      const detail =
        body && typeof body === 'object' && body !== null && 'detail' in body
          ? (body as { detail?: unknown }).detail
          : undefined;
      let detailText = '';
      if (typeof detail === 'string') detailText = detail.trim();
      else if (Array.isArray(detail)) detailText = detailToText(detail);
      const enriched = new Error(
        detailText || err.message || `Request failed (${err.response.status})`
      ) as Error & {
        response?: { status: number; data?: unknown };
        status?: number;
      };
      enriched.response = { status: err.response.status, data: body };
      enriched.status = err.response.status;
      throw enriched;
    }
    throw err;
  }
}

/** Typed JSON/multipart request — unwraps response body like the old axios helper. */
export async function request<T = unknown>(config: RequestConfig): Promise<T> {
  const key = getInflightKey(config);
  if (key) {
    const cached = recentGets.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.value as T;
    }
    const existing = inflightGets.get(key);
    if (existing) return existing as Promise<T>;
  }

  let pending: Promise<T>;
  async function run(): Promise<T> {
    try {
      return await executeRequest<T>(config, key);
    } finally {
      if (key && inflightGets.get(key) === pending) inflightGets.delete(key);
    }
  }
  pending = run();
  if (key) inflightGets.set(key, pending);
  return pending;
}

export { HTTPError };
