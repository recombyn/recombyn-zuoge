/**
 * oRPC + TanStack Query client:
 * OpenAPILink(contract) → createORPCClient → createTanstackQueryUtils → apiQuery
 *
 * Contract comes from `@recombyn/contracts` (OpenAPI → hey-api orpc codegen).
 * Call sites: `useQuery(apiQuery.projectsListMyProjects.queryOptions({ input: { query: {...} } }))`
 */

import type { JsonifiedClient } from '@orpc/openapi-client';
import type { ContractRouterClient } from '@orpc/contract';
import { createORPCClient, onError, ORPCError } from '@orpc/client';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { QueryClient } from '@tanstack/react-query';
import { HTTPError } from 'ky';
import { apiRouterContract } from '@recombyn/contracts';
import { getApiBaseUrl } from '@/utils/apiBase';
import { getToken, setToken } from '@/utils/token';

/** HTTP status from oRPC or ky errors (replaces axios.isAxiosError). */
export function getHttpStatus(err: unknown): number | undefined {
  if (err instanceof ORPCError) return err.status;
  if (err instanceof HTTPError) return err.response.status;
  // Legacy axios-shaped errors (pre-migration leftovers).
  if (err && typeof err === 'object' && 'response' in err) {
    const status = (err as { response?: { status?: unknown } }).response?.status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

/** FastAPI `{ detail }` body (or full body) from oRPC errors. */
export function getHttpErrorBody(err: unknown): unknown {
  if (err instanceof ORPCError) {
    const data = err.data as { body?: unknown } | unknown;
    if (data && typeof data === 'object' && data !== null && 'body' in data) {
      return (data as { body?: unknown }).body ?? data;
    }
    return data;
  }
  if (err && typeof err === 'object' && 'response' in err) {
    return (err as { response?: { data?: unknown } }).response?.data;
  }
  return undefined;
}

/** FastAPI `detail` field (string or object) when present. */
export function getHttpErrorDetail(err: unknown): unknown {
  const body = getHttpErrorBody(err);
  if (body && typeof body === 'object' && body !== null && 'detail' in body) {
    return (body as { detail?: unknown }).detail;
  }
  if (typeof body === 'string') return body;
  return undefined;
}

/** User-facing message from oRPC / ky / axios-family errors. */
export function getHttpErrorMessage(err: unknown, fallback = ''): string {
  const status = getHttpStatus(err);
  if (status === 502 || status === 503 || status === 504) {
    if (fallback.trim()) return fallback;
  }
  if (status === 413) {
    const detail = getHttpErrorDetail(err);
    if (typeof detail === 'string' && /max\s+\d+MB/i.test(detail)) return detail;
    if (fallback.trim()) return fallback;
    return '文件过大，请压缩后重试';
  }

  const detail = getHttpErrorDetail(err);
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0];
    if (typeof first === 'string' && first.trim()) return first;
    if (first && typeof first === 'object' && 'msg' in first) {
      const msg = (first as { msg?: unknown }).msg;
      if (typeof msg === 'string' && msg.trim()) return msg;
    }
  }
  if (detail && typeof detail === 'object' && detail !== null && 'message' in detail) {
    const msg = (detail as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  if (err instanceof Error && err.message.trim()) {
    const raw = err.message.trim();
    if (/^(bad gateway|gateway timeout|service unavailable)$/i.test(raw) && fallback.trim()) {
      return fallback;
    }
    return raw;
  }
  return fallback;
}

export function abortAfter(ms: number, signal?: AbortSignal): AbortSignal {
  const timed = AbortSignal.timeout(ms);
  if (!signal) return timed;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timed]);
  return signal;
}

function apiV1BaseUrl(): string {
  const baked = getApiBaseUrl().replace(/\/$/, '');
  if (baked) return `${baked}/api/v1`;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/api/v1`;
  }
  return 'http://127.0.0.1:8000/api/v1';
}

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
    const clone = res.clone();
    const data = (await clone.json()) as { detail?: unknown };
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

function isAbortError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current != null; depth += 1) {
    if (typeof current !== 'object') return false;
    if (
      typeof DOMException !== 'undefined' &&
      current instanceof DOMException &&
      current.name === 'AbortError'
    ) {
      return true;
    }
    const e = current as { name?: string; message?: string; cause?: unknown };
    if (e.name === 'AbortError') return true;
    const msg = String(e.message || '');
    if (/aborted|AbortError|signal is aborted|The user aborted a request/i.test(msg)) {
      return true;
    }
    current = e.cause;
  }
  return false;
}

const link = new OpenAPILink(apiRouterContract, {
  url: apiV1BaseUrl,
  headers: () => {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
  fetch: async (input, init) => {
    const res = await globalThis.fetch(input, init);
    await clearSessionOnAuthDead(res);
    return res;
  },
  customErrorResponseBodyDecoder: (body, response) => {
    if (response.status < 400) return null;
    if (body != null && typeof body === 'object') {
      const detail = (body as { detail?: unknown }).detail;
      const message = detailToText(detail) || `HTTP ${response.status}`;
      return new ORPCError('BAD_REQUEST', {
        status: response.status,
        message: message || `HTTP ${response.status}`,
        data: body,
      });
    }
    const statusText =
      'statusText' in response && typeof response.statusText === 'string'
        ? response.statusText.trim()
        : '';
    const message =
      statusText && !/^ok$/i.test(statusText) ? statusText : `HTTP ${response.status}`;
    return new ORPCError('BAD_REQUEST', {
      status: response.status,
      message,
    });
  },
  interceptors: [
    onError((error) => {
      // Query unmount / observer drop cancels in-flight fetch — not a real failure.
      if (isAbortError(error)) return;
      if (import.meta.env.DEV) console.error('[apiQuery]', error);
    }),
  ],
});

export const apiClient: JsonifiedClient<ContractRouterClient<typeof apiRouterContract>> =
  createORPCClient(link);

/** Prefer this in components — typed query/mutation helpers over raw `apiClient` calls. */
export const apiQuery = createTanstackQueryUtils(apiClient, {
  path: ['api'],
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /** Lists / catalog — override to 0 for live editor document fetches. */
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
