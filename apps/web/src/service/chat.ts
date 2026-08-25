/**
 * Chat / LLM API — models + image gen.
 */

import { abortAfter, apiQuery, queryClient } from '@/service/client';
import { request } from '@/utils/request';
import { sse } from '@/utils/sse';

export type ModelReferenceType = 'text' | 'vision' | 'image';

/** From admin catalog `imageLimits`. */
export type ImageLimits = {
  preset?: string;
  transport?: string;
  min_pixels?: number;
  max_pixels?: number;
  resolutions?: string[];
  default_resolution?: string;
  aspect_ratios?: string[];
  size_tables?: Record<string, Record<string, string>>;
  supports_output_format?: boolean;
  supports_quality?: boolean;
};

/** Catalog price provenance. */
export type ImagePriceMeta = {
  source?: string;
  unit?: string;
  usd_per_output_token?: number;
  fx_usd_cny?: number;
  base_resolution?: string;
  price_by_resolution_cny?: Record<string, number | string>;
  output_image?: number;
  output_image_high?: number;
  high_pixels_threshold?: number;
  note?: string;
};

export type LlmModel = {
  id: string;
  label: string;
  provider: string;
  description?: string | null;
  kind?: 'text' | 'image' | 'svg' | 'video' | 'audio';
  referenceTypes?: ModelReferenceType[];
  thinking?: boolean;
  enabled?: boolean;
  iconUrl?: string | null;
  iconKey?: string | null;
  price?: string | null;
  priceMeta?: ImagePriceMeta | null;
  maxAttachments?: number;
  imageLimits?: ImageLimits | null;
  apiModel?: string;
};

/** Default generation params carried by image/video preset models. */
export type ByokPresetDefaults = {
  aspectRatios?: string[];
  resolutions?: string[];
  defaultResolution?: string;
  durations?: number[];
  defaultDuration?: number;
};

/** One selectable model under a per-endpoint preset. */
export type ByokPresetModel = {
  apiModel: string;
  label: string;
  kind: 'text' | 'vision' | 'image' | 'video' | 'audio';
  thinking?: boolean;
  defaults?: ByokPresetDefaults;
};

/** Aggregator platform — one API key unlocks catalog models for that provider. */
export type ByokPlatform = {
  id: string;
  name: string;
  baseUrl: string;
  website?: string;
  iconKey?: string;
  kinds: Array<'text' | 'vision' | 'image' | 'video'>;
  /** Stable vault id, e.g. ``platform:openrouter``. */
  rowId: string;
  hint?: string;
};

export type ChatModelsResponse = {
  models: LlmModel[];
  available: boolean;
  imageModels?: LlmModel[];
  videoModels?: LlmModel[];
  audioModels?: LlmModel[];
  /** ISO country from GeoLite2 / edge headers when known. */
  clientRegion?: string | null;
  /** False when aggregator catalog is region-blocked. */
  openrouterAvailable?: boolean;
  /** Aggregator platforms — one key unlocks catalog models. */
  byokPlatforms?: ByokPlatform[];
};

export type GenerateImageInput = {
  prompt: string;
  model?: string;
  aspect_ratio?: string;
  quality?: string;
  resolution?: string;
  images?: string[];
};

export type GenerateImageResult = {
  images: string[];
  text?: string | null;
  model: string;
  assets?: Array<{ url?: string | null; id?: string | null }> | null;
};

/** GET /api/v1/chat/models — Query-cached via oRPC. */
export function invalidateChatModelsCache() {
  void queryClient.invalidateQueries({ queryKey: apiQuery.chatGetModels.key() });
}

export async function listModels(opts?: { force?: boolean }): Promise<ChatModelsResponse> {
  if (opts?.force) {
    return queryClient.fetchQuery({
      ...apiQuery.chatGetModels.queryOptions(),
      staleTime: 0,
    }) as Promise<ChatModelsResponse>;
  }
  return queryClient.ensureQueryData({
    ...apiQuery.chatGetModels.queryOptions(),
    staleTime: 60_000,
  }) as Promise<ChatModelsResponse>;
}

type MediaJobCreate = {
  job_id: string;
  status: 'queued';
};

type MediaJobState<TResult> = {
  job_id: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  progress?: number;
  result?: TResult | null;
  error?: string | null;
};

/** Fail fast when Celery worker is down / blocked (solo pool stuck on prior job). */
const MEDIA_JOB_QUEUED_STALL_MS = 60_000;

type WaitForMediaJobOpts<TResult> = {
  signal?: AbortSignal;
  timeoutMs: number;
  isValidResult: (result: TResult | null | undefined) => result is TResult;
  missingResultMessage: string;
  failedMessage: string;
  timedOutMessage: string;
  queuedStallMessage?: string;
  onProgress?: (progress: number, status: MediaJobState<TResult>['status']) => void;
};

function handleMediaJobPayload<TResult>(
  job: MediaJobState<TResult>,
  opts: WaitForMediaJobOpts<TResult>,
  queuedSince: { at: number | null },
  queuedStallMessage: string,
): TResult | 'pending' {
  opts.onProgress?.(job.progress ?? 0, job.status);
  if (job.status === 'done') {
    if (!opts.isValidResult(job.result)) {
      throw new Error(job.error || opts.missingResultMessage);
    }
    return job.result;
  }
  if (job.status === 'failed') {
    throw new Error(job.error || opts.failedMessage);
  }
  if (job.status === 'queued') {
    if (queuedSince.at == null) queuedSince.at = Date.now();
    else if (Date.now() - queuedSince.at > MEDIA_JOB_QUEUED_STALL_MS) {
      throw new Error(queuedStallMessage);
    }
  } else {
    queuedSince.at = null;
  }
  return 'pending';
}

async function waitForMediaJobViaSse<TResult>(
  kind: 'image' | 'video' | 'audio' | 'lottie',
  jobId: string,
  opts: WaitForMediaJobOpts<TResult>,
): Promise<TResult> {
  const deadline = Date.now() + opts.timeoutMs;
  const queuedSince = { at: null as number | null };
  const queuedStallMessage =
    opts.queuedStallMessage ||
    'Generation queue stalled — run npm run dev:worker (Celery) alongside the API';

  return new Promise<TResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    void sse({
      url: `/api/v1/chat/${kind}/jobs/${encodeURIComponent(jobId)}/events`,
      method: 'GET',
      signal: opts.signal,
      onmessage: (ev) => {
        if (opts.signal?.aborted) {
          finish(() => reject(new DOMException('Aborted', 'AbortError')));
          return;
        }
        if (Date.now() > deadline) {
          finish(() => reject(new Error(opts.timedOutMessage)));
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
        let job: MediaJobState<TResult>;
        try {
          job = JSON.parse(ev.data) as MediaJobState<TResult>;
        } catch {
          finish(() => reject(new Error('Invalid media job event payload')));
          return;
        }
        try {
          const outcome = handleMediaJobPayload(job, opts, queuedSince, queuedStallMessage);
          if (outcome !== 'pending') finish(() => resolve(outcome));
        } catch (err) {
          finish(() => reject(err instanceof Error ? err : new Error(String(err))));
        }
      },
      onerror: (err) => {
        finish(() => reject(err));
      },
      onclose: () => {
        if (!settled) finish(() => reject(new Error(opts.timedOutMessage)));
      },
    });
  });
}

async function waitForMediaJob<TResult>(
  kind: 'image' | 'video' | 'audio' | 'lottie',
  jobId: string,
  opts: WaitForMediaJobOpts<TResult>,
): Promise<TResult> {
  return waitForMediaJobViaSse(kind, jobId, opts);
}

/** POST /api/v1/chat/image/jobs — returns job id for SSE / refresh recovery. */
export async function createImageJob(
  data: GenerateImageInput,
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const signal = abortAfter(180_000, opts?.signal);
  const created = await request<MediaJobCreate>({
    url: '/api/v1/chat/image/jobs',
    method: 'post',
    data,
    signal,
  });
  return created.job_id;
}

export async function waitForImageJob(
  jobId: string,
  opts?: { signal?: AbortSignal },
): Promise<GenerateImageResult> {
  const signal = abortAfter(180_000, opts?.signal);
  return waitForMediaJob('image', jobId, {
    signal,
    timeoutMs: 180_000,
    isValidResult: (r): r is GenerateImageResult =>
      !!r && Array.isArray(r.images),
    missingResultMessage: 'image job missing result',
    failedMessage: 'image generation failed',
    timedOutMessage: 'image generation timed out',
  });
}

/** POST /api/v1/chat/image/jobs + SSE wait. */
export async function generateImage(
  data: GenerateImageInput,
  opts?: { signal?: AbortSignal },
): Promise<GenerateImageResult> {
  const jobId = await createImageJob(data, opts);
  return waitForImageJob(jobId, opts);
}

export type GenerateVideoInput = {
  prompt: string;
  model?: string;
  aspect_ratio?: string;
  resolution?: string;
  duration?: number;
  /** First-frame / style reference images (data URLs or http URLs). */
  images?: string[];
};

export type GenerateVideoResult = {
  videos: string[];
  text?: string | null;
  model: string;
  assets?: Array<{ url?: string | null; id?: string | null }> | null;
};

/** POST /api/v1/chat/video/jobs — returns job id for SSE / refresh recovery. */
export async function createVideoJob(
  data: GenerateVideoInput,
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const signal = abortAfter(600_000, opts?.signal);
  const created = await request<MediaJobCreate>({
    url: '/api/v1/chat/video/jobs',
    method: 'post',
    data,
    signal,
  });
  return created.job_id;
}

export async function waitForVideoJob(
  jobId: string,
  opts?: { signal?: AbortSignal },
): Promise<GenerateVideoResult> {
  const signal = abortAfter(600_000, opts?.signal);
  return waitForMediaJob('video', jobId, {
    signal,
    timeoutMs: 600_000,
    isValidResult: (r): r is GenerateVideoResult =>
      !!r && Array.isArray(r.videos),
    missingResultMessage: 'video job missing result',
    failedMessage: 'video generation failed',
    timedOutMessage: 'video generation timed out',
  });
}

/** POST /api/v1/chat/video/jobs + SSE wait. */
export async function generateVideo(
  data: GenerateVideoInput,
  opts?: { signal?: AbortSignal },
): Promise<GenerateVideoResult> {
  const jobId = await createVideoJob(data, opts);
  return waitForVideoJob(jobId, opts);
}

export type GenerateAudioInput = {
  prompt: string;
  model?: string;
  voice?: string;
  response_format?: string;
  speed?: number;
};

export type GenerateAudioResult = {
  audios: string[];
  model: string;
  voice?: string;
  mime?: string;
  assets?: Array<{ url?: string | null; id?: string | null }> | null;
};

/** POST /api/v1/chat/audio/jobs — returns job id for SSE / refresh recovery. */
export async function createAudioJob(
  data: GenerateAudioInput,
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const signal = abortAfter(180_000, opts?.signal);
  const created = await request<MediaJobCreate>({
    url: '/api/v1/chat/audio/jobs',
    method: 'post',
    data,
    signal,
  });
  return created.job_id;
}

export async function waitForAudioJob(
  jobId: string,
  opts?: { signal?: AbortSignal },
): Promise<GenerateAudioResult> {
  const signal = abortAfter(180_000, opts?.signal);
  return waitForMediaJob('audio', jobId, {
    signal,
    timeoutMs: 180_000,
    isValidResult: (r): r is GenerateAudioResult =>
      !!r && Array.isArray(r.audios),
    missingResultMessage: 'audio job missing result',
    failedMessage: 'audio generation failed',
    timedOutMessage: 'audio generation timed out',
  });
}

/** POST /api/v1/chat/audio/jobs + SSE wait. */
export async function generateAudio(
  data: GenerateAudioInput,
  opts?: { signal?: AbortSignal },
): Promise<GenerateAudioResult> {
  const jobId = await createAudioJob(data, opts);
  return waitForAudioJob(jobId, opts);
}

export type GenerateLottieInput = {
  prompt: string;
  width?: number;
  height?: number;
  duration_sec?: number;
  model?: string;
  images?: string[];
};

export type GenerateLottieResult = {
  animationData: Record<string, unknown>;
  w?: number;
  h?: number;
  asset?: { url?: string | null; id?: string | null } | null;
};

/** POST /api/v1/chat/lottie/jobs — returns job id for SSE / refresh recovery. */
export async function createLottieJob(
  data: GenerateLottieInput,
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const signal = abortAfter(90_000, opts?.signal);
  const created = await request<MediaJobCreate>({
    url: '/api/v1/chat/lottie/jobs',
    method: 'post',
    data,
    signal,
  });
  return created.job_id;
}

export async function waitForLottieJob(
  jobId: string,
  opts?: { signal?: AbortSignal },
): Promise<GenerateLottieResult> {
  const signal = abortAfter(90_000, opts?.signal);
  return waitForMediaJob('lottie', jobId, {
    signal,
    timeoutMs: 90_000,
    isValidResult: (r): r is GenerateLottieResult =>
      !!r &&
      typeof r.animationData === 'object' &&
      r.animationData !== null &&
      !Array.isArray(r.animationData),
    missingResultMessage: 'lottie job missing result',
    failedMessage: 'lottie generation failed',
    timedOutMessage: 'lottie generation timed out',
  });
}

/** POST /api/v1/chat/lottie/jobs + SSE wait. */
export async function generateLottie(
  data: GenerateLottieInput,
  opts?: { signal?: AbortSignal },
): Promise<GenerateLottieResult> {
  const jobId = await createLottieJob(data, opts);
  return waitForLottieJob(jobId, opts);
}
