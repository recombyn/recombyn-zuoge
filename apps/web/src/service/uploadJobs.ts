import {
  createMonotonicProgress,
  mapServerUploadProgress,
  processJobAttrPatch,
  UPLOAD_QUEUED_PCT,
  UPLOAD_WIRE_MAX,
  wirePctFromBytes,
} from '@/components/rcb/scene/document/processJobAttrs';
import { requestProjectFlush } from '@/components/editor/useProjectCloudSync';
import { patchDocumentNode } from '@/store/modules/editor';
import { abortAfter } from '@/service/client';
import type { UploadedFileItem } from '@/service/upload';
import {
  deletePendingUploadFile,
  loadPendingUploadFile,
  savePendingUploadFile,
} from '@/service/uploadPendingStore';
import { getApiBaseUrl, getLocalDevApiOrigin } from '@/utils/apiBase';
import { acceptLanguageHeader } from '@/i18n/apiLocale';
import { getToken } from '@/utils/token';
import { request } from '@/utils/request';
import { sse } from '@/utils/sse';
import i18n from '@/i18n';

type UploadSession = { job_id: string; part_size: number; part_count: number };

type UploadJobState = {
  job_id: string;
  status: string;
  progress: number;
  result: { item?: UploadedFileItem } | null;
  error?: string | null;
  received_parts?: number[] | null;
  part_count?: number | null;
  part_size?: number | null;
};

const JOB_TIMEOUT_MS = 1_800_000;
const PART_TIMEOUT_MS = 300_000;
const QUEUED_STALL_MS = 60_000;
const DEFAULT_PART_SIZE = 8 * 1024 * 1024;

function apiBase(): string {
  const devApi = getLocalDevApiOrigin();
  return devApi ? devApi.replace(/\/$/, '') : '';
}

function resolveUploadUrl(path: string): string {
  const base = (apiBase() || getApiBaseUrl()).replace(/\/$/, '');
  if (!base) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function fetchUploadJob(jobId: string): Promise<UploadJobState> {
  return request<UploadJobState>({
    url: `/api/v1/uploads/jobs/${encodeURIComponent(jobId)}`,
    method: 'get',
  });
}

async function createUploadSession(
  file: File,
  opts?: { signal?: AbortSignal }
): Promise<UploadSession> {
  return request<UploadSession>({
    url: `${apiBase()}/api/v1/uploads/jobs/session`,
    method: 'post',
    data: {
      filename: file.name,
      content_type: file.type || 'application/octet-stream',
      total_size: file.size,
    },
    timeout: 60_000,
    signal: opts?.signal,
  });
}

/** PUT one part with real XMLHttpRequest upload progress (ky has no upload events). */
function putPartBlob(
  url: string,
  blob: Blob,
  opts: {
    signal?: AbortSignal;
    timeoutMs: number;
    onByteProgress?: (loaded: number, total: number) => void;
  }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', resolveUploadUrl(url));
    xhr.timeout = opts.timeoutMs;
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    for (const [k, v] of Object.entries(acceptLanguageHeader())) {
      xhr.setRequestHeader(k, v);
    }
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    const onAbort = () => {
      xhr.abort();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const cleanup = () => opts.signal?.removeEventListener('abort', onAbort);
    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort();
        return;
      }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      opts.onByteProgress?.(ev.loaded, ev.total || blob.size);
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onByteProgress?.(blob.size, blob.size);
        resolve();
        return;
      }
      reject(new Error(parseXhrError(xhr)));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error('upload part network error'));
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(new Error('upload part timed out'));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    xhr.send(blob);
  });
}

function parseXhrError(xhr: XMLHttpRequest): string {
  let detail = `upload part failed (${xhr.status})`;
  try {
    const parsed = JSON.parse(xhr.responseText) as { detail?: unknown };
    if (typeof parsed.detail === 'string') detail = parsed.detail;
  } catch {
    /* ignore */
  }
  return detail;
}

async function uploadJobParts(
  file: File,
  session: UploadSession,
  opts?: {
    signal?: AbortSignal;
    onProgress?: (pct: number) => void;
    receivedParts?: number[];
  }
): Promise<void> {
  const partSize = Math.max(1, session.part_size || DEFAULT_PART_SIZE);
  const partCount = session.part_count || Math.max(1, Math.ceil(file.size / partSize));
  const received = new Set((opts?.receivedParts || []).map((n) => Number(n)).filter((n) => n > 0));
  const report = opts?.onProgress ?? (() => {});

  let committedBytes = 0;
  for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
    const start = (partNumber - 1) * partSize;
    const end = Math.min(file.size, start + partSize);
    const partBytes = end - start;
    if (received.has(partNumber)) {
      committedBytes += partBytes;
      report(wirePctFromBytes(committedBytes, file.size));
      continue;
    }
    if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const blob = file.slice(start, end);
    await putPartBlob(
      `${apiBase()}/api/v1/uploads/jobs/${encodeURIComponent(session.job_id)}/parts/${partNumber}`,
      blob,
      {
        signal: opts?.signal,
        timeoutMs: PART_TIMEOUT_MS,
        onByteProgress: (loaded) => {
          report(wirePctFromBytes(committedBytes + loaded, file.size));
        },
      }
    );
    committedBytes += partBytes;
    report(wirePctFromBytes(committedBytes, file.size));
  }
  report(UPLOAD_WIRE_MAX);
}

async function completeUploadJob(jobId: string, opts?: { signal?: AbortSignal }): Promise<void> {
  await request({
    url: `${apiBase()}/api/v1/uploads/jobs/${encodeURIComponent(jobId)}/complete`,
    method: 'post',
    timeout: PART_TIMEOUT_MS,
    signal: opts?.signal,
  });
}

async function finishWireUpload(
  jobId: string,
  report: (pct: number) => void,
  opts?: { signal?: AbortSignal }
): Promise<void> {
  report(UPLOAD_QUEUED_PCT);
  await completeUploadJob(jobId, opts);
}

function sessionFromJob(jobId: string, snap: UploadJobState): UploadSession {
  const partSize = Math.max(1, Number(snap.part_size) || DEFAULT_PART_SIZE);
  const partCount = Math.max(1, Number(snap.part_count) || 1);
  return { job_id: jobId, part_size: partSize, part_count: partCount };
}

function handleJobPayload(
  job: UploadJobState,
  queuedSince: { at: number | null },
  opts: { onProgress?: (pct: number) => void; wireDone?: boolean }
): UploadedFileItem | 'pending' {
  opts.onProgress?.(mapServerUploadProgress(Number(job.progress) || 0, Boolean(opts.wireDone)));

  if (job.status === 'done') {
    const item = job.result?.item;
    if (!item?.url) throw new Error(job.error || 'upload job missing result');
    return item;
  }
  if (job.status === 'failed' || job.status === 'aborted') {
    throw new Error(job.error || 'upload failed');
  }
  if (job.status === 'queued') {
    if (queuedSince.at == null) queuedSince.at = Date.now();
    else if (Date.now() - queuedSince.at > QUEUED_STALL_MS) {
      throw new Error(String(i18n.t('editor.tools.uploadQueueStall')));
    }
  } else {
    queuedSince.at = null;
  }
  return 'pending';
}

export async function waitForUploadJob(
  jobId: string,
  opts?: { signal?: AbortSignal; onProgress?: (pct: number) => void; wireDone?: boolean }
): Promise<UploadedFileItem> {
  const report = opts?.onProgress ?? (() => {});
  const wireDone = opts?.wireDone !== false;
  const snap = await fetchUploadJob(jobId);
  if (snap.status === 'done') {
    const item = snap.result?.item;
    if (!item?.url) throw new Error(snap.error || 'upload job missing result');
    report(100);
    await deletePendingUploadFile(jobId);
    return item;
  }
  if (snap.status === 'failed' || snap.status === 'aborted') {
    await deletePendingUploadFile(jobId);
    throw new Error(snap.error || 'upload failed');
  }
  if (snap.status === 'uploading') {
    const received = snap.received_parts?.length ?? 0;
    const total = snap.part_count ?? 0;
    if (total > 0 && received >= total) {
      await finishWireUpload(jobId, report, opts);
    } else {
      throw new Error(String(i18n.t('editor.tools.uploadInterrupted')));
    }
  }

  const deadline = Date.now() + JOB_TIMEOUT_MS;
  const queuedSince = { at: null as number | null };
  report(mapServerUploadProgress(Number(snap.progress) || 0, wireDone));

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
      signal: abortAfter(JOB_TIMEOUT_MS, opts?.signal),
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
          const outcome = handleJobPayload(job, queuedSince, { onProgress: report, wireDone });
          if (outcome !== 'pending') {
            finish(() => {
              void deletePendingUploadFile(jobId);
              report(100);
              resolve(outcome);
            });
          }
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

/** Resume an in-flight upload after refresh (IndexedDB file + server received_parts). */
export async function resumeOrWaitUploadJob(
  jobId: string,
  opts?: { signal?: AbortSignal; onProgress?: (pct: number) => void }
): Promise<UploadedFileItem> {
  const report = createMonotonicProgress(opts?.onProgress);
  const snap = await fetchUploadJob(jobId);
  if (snap.status === 'done' && snap.result?.item?.url) {
    await deletePendingUploadFile(jobId);
    report(100);
    return snap.result.item;
  }
  if (snap.status === 'failed' || snap.status === 'aborted') {
    await deletePendingUploadFile(jobId);
    throw new Error(snap.error || 'upload failed');
  }

  if (snap.status === 'uploading') {
    const file = await loadPendingUploadFile(jobId);
    const received = snap.received_parts ?? [];
    const total = snap.part_count ?? 0;
    if (file) {
      await uploadJobParts(file, sessionFromJob(jobId, snap), {
        signal: opts?.signal,
        onProgress: report,
        receivedParts: received,
      });
    } else if (!(total > 0 && received.length >= total)) {
      throw new Error(String(i18n.t('editor.tools.uploadInterrupted')));
    }
    await finishWireUpload(jobId, report, opts);
  }

  return waitForUploadJob(jobId, {
    signal: opts?.signal,
    onProgress: report,
    wireDone: true,
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
  const report = createMonotonicProgress(opts?.onProgress);

  if (opts?.jobId) {
    return resumeOrWaitUploadJob(opts.jobId, {
      signal: opts?.signal,
      onProgress: report,
    });
  }

  const session = await createUploadSession(file, { signal: opts?.signal });
  opts?.onJobCreated?.(session.job_id);
  try {
    await savePendingUploadFile(session.job_id, file);
  } catch {
    /* resume after refresh may be unavailable */
  }
  await uploadJobParts(file, session, {
    signal: opts?.signal,
    onProgress: report,
  });
  await finishWireUpload(session.job_id, report, { signal: opts?.signal });
  return waitForUploadJob(session.job_id, {
    signal: opts?.signal,
    onProgress: report,
    wireDone: true,
  });
}

type DispatchLike = (action: unknown) => unknown;

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
  requestProjectFlush();
}
