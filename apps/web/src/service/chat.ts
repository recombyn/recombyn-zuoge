/**
 * Chat / LLM API — models + image gen.
 */

import { abortAfter, apiQuery, queryClient } from '@/service/client';
import { request } from '@/utils/request';

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

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForMediaJob<TResult>(
  kind: 'image' | 'video' | 'audio',
  jobId: string,
  opts: {
    signal?: AbortSignal;
    timeoutMs: number;
    isValidResult: (result: TResult | null | undefined) => result is TResult;
    missingResultMessage: string;
    failedMessage: string;
    timedOutMessage: string;
  },
): Promise<TResult> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const job = await request<MediaJobState<TResult>>({
      url: `/api/v1/chat/${kind}/jobs/${encodeURIComponent(jobId)}`,
      method: 'get',
      skipInflightDedupe: true,
      signal: opts.signal,
    });
    if (job.status === 'done') {
      if (!opts.isValidResult(job.result)) {
        throw new Error(job.error || opts.missingResultMessage);
      }
      return job.result;
    }
    if (job.status === 'failed') {
      throw new Error(job.error || opts.failedMessage);
    }
    await sleep(800);
  }
  throw new Error(opts.timedOutMessage);
}

/** POST /api/v1/chat/image/jobs + poll (keeps API workers free). */
export async function generateImage(
  data: GenerateImageInput,
  opts?: { signal?: AbortSignal },
): Promise<GenerateImageResult> {
  const signal = abortAfter(180_000, opts?.signal);
  const created = await request<MediaJobCreate>({
    url: '/api/v1/chat/image/jobs',
    method: 'post',
    data,
    signal,
  });
  return waitForMediaJob('image', created.job_id, {
    signal,
    timeoutMs: 180_000,
    isValidResult: (r): r is GenerateImageResult =>
      !!r && Array.isArray(r.images),
    missingResultMessage: 'image job missing result',
    failedMessage: 'image generation failed',
    timedOutMessage: 'image generation timed out',
  });
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

/** POST /api/v1/chat/video/jobs + poll (keeps API workers free). */
export async function generateVideo(
  data: GenerateVideoInput,
  opts?: { signal?: AbortSignal },
): Promise<GenerateVideoResult> {
  const signal = abortAfter(600_000, opts?.signal);
  const created = await request<MediaJobCreate>({
    url: '/api/v1/chat/video/jobs',
    method: 'post',
    data,
    signal,
  });
  return waitForMediaJob('video', created.job_id, {
    signal,
    timeoutMs: 600_000,
    isValidResult: (r): r is GenerateVideoResult =>
      !!r && Array.isArray(r.videos),
    missingResultMessage: 'video job missing result',
    failedMessage: 'video generation failed',
    timedOutMessage: 'video generation timed out',
  });
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

/** POST /api/v1/chat/audio/jobs + poll (keeps API workers free). */
export async function generateAudio(
  data: GenerateAudioInput,
  opts?: { signal?: AbortSignal },
): Promise<GenerateAudioResult> {
  const signal = abortAfter(180_000, opts?.signal);
  const created = await request<MediaJobCreate>({
    url: '/api/v1/chat/audio/jobs',
    method: 'post',
    data,
    signal,
  });
  return waitForMediaJob('audio', created.job_id, {
    signal,
    timeoutMs: 180_000,
    isValidResult: (r): r is GenerateAudioResult =>
      !!r && Array.isArray(r.audios),
    missingResultMessage: 'audio job missing result',
    failedMessage: 'audio generation failed',
    timedOutMessage: 'audio generation timed out',
  });
}
