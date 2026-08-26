import {
  createImageJob,
  waitForImageJob,
  type GenerateImageInput,
  type GenerateImageResult,
} from '@/service/chat';
import { apiQuery, queryClient } from '@/service/client';
import { refreshWalletAfterSpend } from '@/service/wallet';

/** Bust home assets dock + editor asset panel after AI image jobs finish. */
export function invalidateUserAssetsCache(): void {
  void queryClient.invalidateQueries({ queryKey: apiQuery.assetsListMyAssets.key() });
}

/** Canonical stored URLs from a generation result (`images[]` after backend rehost). */
export function listGenerateImageUrls(res: GenerateImageResult): string[] {
  const out: string[] = [];
  if (Array.isArray(res?.images)) {
    for (const u of res.images) {
      const url = String(u || '').trim();
      if (url) out.push(url);
    }
  }
  return [...new Set(out)];
}

export function pickGenerateImageUrl(res: GenerateImageResult): string {
  const urls = listGenerateImageUrls(res);
  return urls[0] || '';
}

/**
 * Parallel image gens (1–4). All slots must succeed or the batch throws.
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

  const results = await Promise.all(
    jobIds.map((jobId) => waitForImageJob(jobId, { signal: opts?.signal }))
  );

  const urls: string[] = [];
  for (const result of results) {
    for (const url of listGenerateImageUrls(result)) {
      if (url) urls.push(url);
    }
  }

  const unique = [...new Set(urls)];
  if (unique.length < slots) {
    throw new Error(
      opts?.emptyMessage ||
        `image generation returned ${unique.length}/${slots} results`
    );
  }
  invalidateUserAssetsCache();
  refreshWalletAfterSpend();
  return unique;
}

/** Poll persisted image job ids (refresh recovery). */
export async function waitForImageBatchJobs(
  jobIds: string[],
  opts?: { signal?: AbortSignal; emptyMessage?: string }
): Promise<string[]> {
  const ids = jobIds.map((id) => String(id || '').trim()).filter(Boolean);
  if (!ids.length) {
    throw new Error(opts?.emptyMessage || 'no image jobs to recover');
  }

  const results = await Promise.all(
    ids.map((jobId) => waitForImageJob(jobId, { signal: opts?.signal }))
  );

  const urls: string[] = [];
  for (const result of results) {
    for (const url of listGenerateImageUrls(result)) {
      if (url) urls.push(url);
    }
  }

  const unique = [...new Set(urls)];
  if (!unique.length) {
    throw new Error(opts?.emptyMessage || 'image generation returned no results');
  }
  if (unique.length < ids.length) {
    throw new Error(
      opts?.emptyMessage ||
        `image generation returned ${unique.length}/${ids.length} results`
    );
  }
  invalidateUserAssetsCache();
  refreshWalletAfterSpend();
  return unique;
}
