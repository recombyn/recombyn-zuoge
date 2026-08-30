/**
 * Image toolbar AI tools — async POST /api/v1/image/process/jobs + SSE wait.
 * (Real-ESRGAN upscale, intelligence vision, or Seedream i2i).
 */

import { useQuery } from '@tanstack/react-query';
import { abortAfter, apiClient } from '@/service/client';
import { useBillingEnabled } from '@/service/wallet';
import { createMonotonicProgress } from '@/components/rcb/scene/document/processJobAttrs';
import { request } from '@/utils/request';
import { sse } from '@/utils/sse';

export type ImageProcessKindApi =
  | 'upscale'
  | 'removeBg'
  | 'eraser'
  | 'multiAngle'
  | 'expand'
  | 'editText'
  | 'editElements'
  | 'replaceText'
  | 'vector'
  | 'adjust';

export type ImageProcessBody = {
  kind: ImageProcessKindApi | string;
  image: string;
  meta?: Record<string, unknown>;
  aspect_ratio?: string;
  quality?: string;
  resolution?: string;
  model?: string;
};

export type ImageDecomposeLayer = {
  type: 'image' | 'text' | string;
  src?: string;
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  fill?: string;
  lineHeight?: number;
};

export type ImageProcessResult = {
  /** Raster tool output (data URL or https). Absent for vectorize. */
  image?: string;
  /** vtracer SVG markup — finish as ``key: 'svg'`` node. */
  svg?: string;
  text?: string | null;
  kind: string;
  model?: string;
  /** editText / editElements: split layers in source-pixel coords */
  layers?: ImageDecomposeLayer[];
  width?: number;
  height?: number;
  warnings?: string[];
  engines?: string[];
  engine?: string;
  /** Credits charged for this tool call (server-side). */
  credits?: number;
};

export type ImageToolCapabilities = {
  credits?: Partial<Record<ImageProcessKindApi | string, number>>;
  ilp?: {
    enabled?: boolean;
    supports?: string[];
  };
  mockup?: {
    enabled?: boolean;
    templates?: Array<{
      id: string;
      name?: string;
      kind?: string;
      width?: number;
      height?: number;
    }>;
  };
};

/** Kinds that require Recombyn Intelligence (not available in OSS-only deploy). */
export const INTELLIGENCE_VISION_KINDS = [
  'upscale',
  'removeBg',
  'eraser',
  'editText',
  'editElements',
] as const;

/** Toolbar kinds handled by async image process jobs (ImageProcessWatcher). */
export const AI_IMAGE_PROCESS_KINDS = new Set<string>([
  'upscale',
  'removeBg',
  'eraser',
  'multiAngle',
  'expand',
  'editText',
  'editElements',
  'replaceText',
  'vector',
  'adjust',
]);

let intelligenceVisionEnabled = false;

/** Sync snapshot updated by ``useImageToolCapabilities`` / ``fetchImageToolCapabilities``. */
export function isIntelligenceVisionEnabled(): boolean {
  return intelligenceVisionEnabled;
}

function syncIntelligenceVisionEnabled(caps: ImageToolCapabilities | undefined): void {
  intelligenceVisionEnabled = caps?.ilp?.enabled === true;
}

/** Server-reported image tool capabilities (ILP routing, credits, etc.). */
export const fetchImageToolCapabilities = async () => {
  const data = (await apiClient.imageToolsListImageTools({})) as ImageToolCapabilities;
  syncIntelligenceVisionEnabled(data);
  return data;
};

export function useImageToolCapabilities() {
  return useQuery({
    queryKey: ['image-tool-capabilities'],
    queryFn: fetchImageToolCapabilities,
    staleTime: 60_000,
  });
}

/** Server-reported credit cost for a toolbar kind (0 when billing off / no LLM). */
export function useImageToolCreditCost(kind: ImageProcessKindApi | string): number {
  const billingEnabled = useBillingEnabled();
  const caps = useImageToolCapabilities();
  if (!billingEnabled || !kind) return 0;
  const fromApi = caps.data?.credits?.[kind];
  if (typeof fromApi === 'number' && Number.isFinite(fromApi)) return Math.max(0, Math.round(fromApi));
  return 0;
}

type ImageProcessJobCreate = {
  job_id: string;
  status: string;
  trace_id?: string;
};

type ImageProcessJobState = {
  job_id: string;
  status: string;
  progress: number;
  result: ImageProcessResult | null;
  error?: string | null;
};

const IMAGE_PROCESS_JOB_TIMEOUT_MS = 320_000;
const IMAGE_PROCESS_QUEUED_STALL_MS = 60_000;
const IMAGE_PROCESS_TIMEOUT_MSG = '图片分层超时，请稍后重试（大图首次加载模型会更慢）';

/** POST /api/v1/image/process/jobs — returns job id for SSE / refresh recovery. */
export async function createImageProcessJob(
  data: ImageProcessBody,
  opts?: { signal?: AbortSignal }
): Promise<string> {
  const created = await request<ImageProcessJobCreate>({
    url: '/api/v1/image/process/jobs',
    method: 'post',
    data,
    signal: abortAfter(60_000, opts?.signal),
  });
  return created.job_id;
}

function handleImageProcessJobPayload(
  job: ImageProcessJobState,
  queuedSince: { at: number | null },
  report: (pct: number) => void
): ImageProcessResult | 'pending' {
  report(Number(job.progress) || 0);
  if (job.status === 'done') {
    report(100);
    if (!job.result || typeof job.result !== 'object') {
      throw new Error(job.error || 'image process job missing result');
    }
    return job.result;
  }
  if (job.status === 'failed') {
    throw new Error(job.error || 'image process failed');
  }
  if (job.status === 'queued') {
    if (queuedSince.at == null) queuedSince.at = Date.now();
    else if (Date.now() - queuedSince.at > IMAGE_PROCESS_QUEUED_STALL_MS) {
      throw new Error(
        'Image process queue stalled — run npm run dev:worker (Celery) alongside the API'
      );
    }
  } else {
    queuedSince.at = null;
  }
  return 'pending';
}

/** Wait for toolbar image job via SSE (progress + result). */
export async function waitForImageProcessJob(
  jobId: string,
  opts?: { signal?: AbortSignal; onProgress?: (pct: number) => void }
): Promise<ImageProcessResult> {
  const deadline = Date.now() + IMAGE_PROCESS_JOB_TIMEOUT_MS;
  const queuedSince = { at: null as number | null };
  const report = opts?.onProgress ?? (() => {});

  return new Promise<ImageProcessResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    void sse({
      url: `/api/v1/image/process/jobs/${encodeURIComponent(jobId)}/events`,
      method: 'GET',
      signal: abortAfter(IMAGE_PROCESS_JOB_TIMEOUT_MS, opts?.signal),
      onmessage: (ev) => {
        if (opts?.signal?.aborted) {
          finish(() => reject(new DOMException('Aborted', 'AbortError')));
          return;
        }
        if (Date.now() > deadline) {
          finish(() => reject(new Error(IMAGE_PROCESS_TIMEOUT_MSG)));
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
        let job: ImageProcessJobState;
        try {
          job = JSON.parse(ev.data) as ImageProcessJobState;
        } catch {
          finish(() => reject(new Error('Invalid image process job event payload')));
          return;
        }
        try {
          const outcome = handleImageProcessJobPayload(job, queuedSince, report);
          if (outcome !== 'pending') finish(() => resolve(outcome));
        } catch (err) {
          finish(() => reject(err instanceof Error ? err : new Error(String(err))));
        }
      },
      onerror: (err) => {
        finish(() => reject(err));
      },
      onclose: () => {
        if (!settled) {
          finish(() => reject(new Error(IMAGE_PROCESS_TIMEOUT_MSG)));
        }
      },
    });
  });
}

/** Create async toolbar job + SSE wait (preferred for long intelligence paths). */
export async function processImageToolAsync(
  data: ImageProcessBody,
  opts?: {
    signal?: AbortSignal;
    jobId?: string;
    onProgress?: (pct: number) => void;
    onJobCreated?: (jobId: string) => void;
  }
): Promise<ImageProcessResult> {
  const jobId = opts?.jobId || (await createImageProcessJob(data, { signal: opts?.signal }));
  if (!opts?.jobId) opts?.onJobCreated?.(jobId);
  return waitForImageProcessJob(jobId, {
    signal: opts?.signal,
    onProgress: createMonotonicProgress(opts?.onProgress),
  });
}
