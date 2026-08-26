import { getApiBaseUrl } from '@/utils/apiBase';
import { getToken } from '@/utils/token';

export type McpPendingBatch = {
  batchId?: string;
  ops?: Array<{ name?: string; args?: Record<string, unknown> }>;
  ts?: number;
};

function mcpUrl(path: string): string {
  const base = getApiBaseUrl().replace(/\/$/, '');
  return `${base}/mcp/canvas${path}`;
}

async function mcpFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(mcpUrl(path), { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const detail =
      typeof data === 'object' && data && 'detail' in data
        ? (data as { detail?: unknown }).detail
        : text;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return data as T;
}

export async function mcpCanvasHeartbeat(projectId: string): Promise<void> {
  await mcpFetch('/session/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId }),
  });
}

export async function mcpCanvasFetchPending(
  projectId: string,
  limit = 8
): Promise<McpPendingBatch[]> {
  const res = await mcpFetch<{ batches?: McpPendingBatch[] }>(
    `/pending?project_id=${encodeURIComponent(projectId)}&limit=${limit}`
  );
  return Array.isArray(res?.batches) ? res.batches : [];
}

export async function mcpCanvasAckPending(
  projectId: string,
  batchIds: string[]
): Promise<number> {
  const res = await mcpFetch<{ removed?: number }>('/pending/ack', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, batch_ids: batchIds }),
  });
  return Number(res?.removed) || 0;
}

export async function mcpCanvasCallTool(
  tool: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const res = await mcpFetch<{ result?: unknown }>('/call', {
    method: 'POST',
    body: JSON.stringify({ tool, arguments: args }),
  });
  return res?.result;
}
