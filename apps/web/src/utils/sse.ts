/**
 * Server-Sent Events helper.
 * Call sites parse `ev.data`; this only opens the stream and forwards frames.
 */

import { resolveApiUrl } from '@/utils/apiBase';
import { getToken } from '@/utils/token';

export type SseConfig = {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string | number | undefined>;
  onmessage?: (ev: { event: string; data: string }) => void;
  onerror?: (err: Error) => void;
  onopen?: (response: Response) => Promise<void>;
  onclose?: () => void;
  signal?: AbortSignal;
};

export async function sse(config: SseConfig): Promise<void> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...config.headers,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let url = resolveApiUrl(config.url);
  if (config.params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(config.params)) {
      if (v !== undefined && v !== null) qs.append(k, String(v));
    }
    const q = qs.toString();
    if (q) url += (url.includes('?') ? '&' : '?') + q;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: config.method || 'GET',
      headers,
      body: config.body != null ? JSON.stringify(config.body) : undefined,
      signal: config.signal,
    });
  } catch (err: unknown) {
    if (config.signal?.aborted) return;
    const e = err instanceof Error ? err : new Error(String(err));
    config.onerror?.(e);
    return;
  }

  if (!res.ok || !res.body) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      detail = '';
    }
    config.onerror?.(new Error(detail || `SSE HTTP ${res.status}`));
    return;
  }

  await config.onopen?.(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const idx = buffer.indexOf('\n');
        if (idx === -1) break;
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (!line || line.startsWith(':')) continue;
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trimStart();
        if (data) config.onmessage?.({ event: 'message', data });
      }
    }
    if (buffer.trim().startsWith('data:')) {
      config.onmessage?.({
        event: 'message',
        data: buffer.trim().slice(5).trimStart(),
      });
    }
  } catch (err: unknown) {
    if (config.signal?.aborted) return;
    const e = err instanceof Error ? err : new Error(String(err));
    config.onerror?.(e);
    return;
  }

  config.onclose?.();
}
