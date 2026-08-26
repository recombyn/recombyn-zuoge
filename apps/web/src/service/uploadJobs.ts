/**
 * Async canvas upload jobs — POST /api/v1/uploads/jobs + SSE wait.
 */

import { processJobAttrPatch } from '@/components/rcb/scene/document/processJobAttrs';
import { patchDocumentNode } from '@/store/modules/editor';
import { abortAfter } from '@/service/client';
import type { UploadedFileItem } from '@/service/upload';
import { getLocalDevApiOrigin } from '@/utils/apiBase';
import { assertUploadFileSize } from '@/utils/uploadLimits';
import { request } from '@/utils/request';
import { sse } from '@/utils/sse';

type UploadJobCreate = { job_id: string; status: string };

type UploadJobState = {
  job_id: string;
  status: string;
  progress: number;
  result: { item?: UploadedFileItem } | null;
  error?: string | null;
};

const UPLOAD_JOB_TIMEOUT_MS = 620_000;
const UPLOAD_QUEUED_STALL_MS = 60_000;
export const UPLOAD_HEAVY_TIMEOUT_MS = 600_000;
export const UPLOAD_LIGHT_TIMEOUT_MS = 120_000;

export function uploadTimeoutForMime(mime: string): number {
  const kind = String(mime || '');
  return kind.startsWith('video/') || kind.startsWith('audio/')
    ? UPLOAD_HEAVY_TIMEOUT_MS
    : UPLOAD_LIGHT_TIMEOUT_MS;
}

export async function createUploadJob(
  file: File,
  opts?: { signal?: AbortSignal }
): Promise<string> {
  assertUploadFileSize(file);
  const form = new FormData();
  form.append('file', file, file.name);
  const timeout = uploadTimeoutForMime(file.type);
  const devApi = getLocalDevApiOrigin();
  const created = await request<UploadJobCreate>({
    url: devApi ? `${devApi}/api/v1/uploads/jobs` : '/api/v1/uploads/jobs',
    method: 'post',
    data: form,
    timeout,
    signal: abortAfter(timeout, opts?.signal),
  });
  return created.job_id;
}

function handleUploadJobPayload(
  job: UploadJobState,
  queuedSince: { at: number | null },
  opts: { onProgress?: (pct: number) => void }
): UploadedFileItem | 'pending' {
  const progress = Math.max(0, Math.min(100, Number(job.progress) || 0));
  opts.onProgress?.(progress);

  if (job.status === 'done') {
    const item = job.result?.item;
    if (!item?.url) throw new Error(job.error || 'upload job missing result');
    return item;
  }
  if (job.status === 'failed') {
    throw new Error(job.error || 'upload failed');
  }
  if (job.status === 'queued') {
    if (queuedSince.at == null) queuedSince.at = Date.now();
    else if (Date.now() - queuedSince.at > UPLOAD_QUEUED_STALL_MS) {
      throw new Error(
        'Upload queue stalled — run npm run dev:worker (Celery) alongside the API'
      );
    }
  } else {
    queuedSince.at = null;
  }
  return 'pending';
}

export async function waitForUploadJob(
  jobId: string,
  opts?: { signal?: AbortSignal; onProgress?: (pct: number) => void }
): Promise<UploadedFileItem> {
  const deadline = Date.now() + UPLOAD_JOB_TIMEOUT_MS;
  const queuedSince = { at: null as number | null };

  return new Promise<UploadedFileItem>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    void sse({
      url: `/api/v1/uploads/jobs/${encodeURIComponent(jobId)}/events`,
      method: 'GET',
      signal: abortAfter(UPLOAD_JOB_TIMEOUT_MS, opts?.signal),
      onmessage: (ev) => {
        if (opts?.signal?.aborted) {
          finish(() => reject(new DOMException('Aborted', 'AbortError')));
          return;
        }
        if (Date.now() > deadline) {
          finish(() => reject(new Error('upload timed out')));
          return;
        }
        if (ev.event === 'error') {
          let detail = 'Job not found';
          try {
            detail = String(JSON.parse(ev.data)?.error || detail);
          } catch {
            /* ignore */
          }
          finish(() => reject(new Error(detail)));
          return;
        }
        let job: UploadJobState;
        try {
          job = JSON.parse(ev.data) as UploadJobState;
        } catch {
          finish(() => reject(new Error('Invalid upload job event payload')));
          return;
        }
        try {
          const outcome = handleUploadJobPayload(job, queuedSince, opts || {});
          if (outcome !== 'pending') finish(() => resolve(outcome));
        } catch (err) {
          finish(() => reject(err instanceof Error ? err : new Error(String(err))));
        }
      },
      onerror: (err) => finish(() => reject(err)),
      onclose: () => {
        if (!settled) finish(() => reject(new Error('upload timed out')));
      },
    });
  });
}

export async function uploadFileViaJob(
  file: File,
  opts?: {
    signal?: AbortSignal;
    jobId?: string;
    onProgress?: (pct: number) => void;
    onJobCreated?: (jobId: string) => void;
  }
): Promise<UploadedFileItem> {
  const jobId = opts?.jobId || (await createUploadJob(file, { signal: opts?.signal }));
  if (!opts?.jobId) opts?.onJobCreated?.(jobId);
  return waitForUploadJob(jobId, {
    signal: opts?.signal,
    onProgress: opts?.onProgress,
  });
}

type DispatchLike = (action: unknown) => unknown;

/** Persist upload job id on a canvas placeholder for refresh recovery. */
export function dispatchUploadJobCreated(
  dispatch: DispatchLike,
  nodeId: string,
  jobId: string
): void {
  const id = String(nodeId || '').trim();
  if (!id || !jobId) return;
  dispatch(
    patchDocumentNode({
      nodeId: id,
      skipHistory: true,
      patch: { attrs: processJobAttrPatch([jobId]) },
    })
  );
}
