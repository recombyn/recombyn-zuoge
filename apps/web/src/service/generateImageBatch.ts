import {
  createImageJob,
  waitForImageJob,
  type GenerateImageInput,
  type GenerateImageResult,
} from '@/service/chat';
import { getHttpErrorMessage, getHttpStatus } from '@/service/client';

/** All image URLs from a single generation result (images[] preferred, then assets[]). */
export function listGenerateImageUrls(res: GenerateImageResult): string[] {
  const out: string[] = [];
  if (Array.isArray(res?.images)) {
    for (const u of res.images) {
      const url = String(u || '').trim();
      if (url) out.push(url);
    }
  }
  if (Array.isArray(res?.assets)) {
    for (const a of res.assets) {
      const url = String(a?.url || '').trim();
      if (url) out.push(url);
    }
  }
  return [...new Set(out)];
}

export function pickGenerateImageUrl(res: GenerateImageResult): string {
  const urls = listGenerateImageUrls(res);
  return urls[0] || '';
}

function isBillingOrAuthError(err: unknown): boolean {
  const status = getHttpStatus(err);
  if (status === 401 || status === 402 || status === 403) return true;
  const msg = getHttpErrorMessage(err, '').toLowerCase();
  return /credit|积分|balance|insufficient|quota|billing|wallet/.test(msg);
}

/**
 * Parallel image gens (1–4). Surfaces credit/auth errors instead of silent empty slots.
 * `onJobsCreated` fires after job ids are known so callers can persist them for refresh recovery.
 */
export async function generateImageBatch(
  body: GenerateImageInput,
  count: number,
  opts?: {
    signal?: AbortSignal;
    emptyMessage?: string;
    onJobsCreated?: (jobIds: string[]) => void;
  }
): Promise<string[]> {
  const slots = Math.max(1, Math.min(4, Math.round(count) || 1));
  const jobIds = await Promise.all(
    Array.from({ length: slots }, () => createImageJob(body, { signal: opts?.signal }))
  );
  opts?.onJobsCreated?.(jobIds);

  const results = await Promise.allSettled(
    jobIds.map((jobId) => waitForImageJob(jobId, { signal: opts?.signal }))
  );

  const urls: string[] = [];
  let firstError: unknown = null;
  let billingError: unknown = null;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const url of listGenerateImageUrls(result.value)) {
        if (url) urls.push(url);
      }
      continue;
    }
    const err = result.reason;
    if (!firstError) firstError = err;
    if (isBillingOrAuthError(err)) billingError = err;
  }

  const unique = [...new Set(urls)];
  if (billingError && !unique.length) throw billingError;
  if (!unique.length) {
    if (firstError instanceof Error) throw firstError;
    throw new Error(opts?.emptyMessage || 'image generation returned no results');
  }
  return unique;
}

/** Poll persisted image job ids (refresh recovery). */
export async function waitForImageBatchJobs(
  jobIds: string[],
  opts?: { signal?: AbortSignal; emptyMessage?: string }
): Promise<string[]> {
  const ids = jobIds.map((id) => String(id || '').trim()).filter(Boolean);
  if (!ids.length) return [];

  const results = await Promise.allSettled(
    ids.map((jobId) => waitForImageJob(jobId, { signal: opts?.signal }))
  );

  const urls: string[] = [];
  let firstError: unknown = null;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const url of listGenerateImageUrls(result.value)) {
        if (url) urls.push(url);
      }
      continue;
    }
    if (!firstError) firstError = result.reason;
  }

  const unique = [...new Set(urls)];
  if (!unique.length) {
    if (firstError instanceof Error) throw firstError;
    throw new Error(opts?.emptyMessage || 'image generation returned no results');
  }
  return unique;
}
