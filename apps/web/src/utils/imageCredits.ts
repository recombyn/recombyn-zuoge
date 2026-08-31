/**
 * Image credit estimates — Ark and OpenRouter use separate formulas.
 *
 * Ark (doubao / Seedream): ¥/image; Pro may switch high-pixel tier.
 * OpenRouter: flat ¥/image or output_image_token × Gemini fixed tokens
 *   (1K/2K → 1120, 4K → 2000). Never pixel÷256.
 *
 * Credits: ceil(¥/张 × 340/49 × 1.2 × count)
 */

import type { LlmModel } from '@/service/chat';

const PLUS_LIST_CNY = 49;
const PLUS_FACE_CREDITS = 340;
const DEFAULT_MARKUP = 1.2;
const DEFAULT_FX = 7.2;
const FALLBACK_CREDITS = 2;

const RES_AREA: Record<string, number> = {
  '512': 512 * 512,
  '1K': 1024 * 1024,
  '2K': 2048 * 2048,
  '3K': 3072 * 3072,
  '4K': 4096 * 4096,
};

/** Gemini Nano Banana / Pro Image fixed output tokens (OpenRouter path only). */
const GEMINI_OUTPUT_TOKENS: Record<string, number> = {
  '512': 1120,
  '1K': 1120,
  '2K': 1120,
  '3K': 2000,
  '4K': 2000,
};

export type ImagePriceMeta = {
  source?: string;
  unit?: string;
  usd?: number;
  usd_per_output_token?: number;
  fx_usd_cny?: number;
  base_resolution?: string;
  token_by_resolution?: Record<string, number>;
  price_by_resolution_cny?: Record<string, number | string>;
  output_image?: number;
  output_image_high?: number;
  high_pixels_threshold?: number;
};

export function parsePriceAmount(raw?: string | number | null): number | null {
  if (raw == null) return null;
  const n = Number.parseFloat(String(raw).trim().split(/\s+/)[0] || '');
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeResolution(raw?: string | null): string {
  const r = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  return r in RES_AREA ? r : '2K';
}

function metaOf(model?: LlmModel | null): ImagePriceMeta | null {
  const m = model?.priceMeta || null;
  return m && typeof m === 'object' ? m : null;
}

function providerKind(model?: LlmModel | null, meta?: ImagePriceMeta | null): 'ark' | 'openrouter' | 'other' {
  const src = String(meta?.source || '').toLowerCase();
  if (src === 'openrouter' || src.startsWith('openrouter')) return 'openrouter';
  if (src === 'ark_docs' || src === 'ark' || src === 'doubao') return 'ark';
  const prov = String(model?.provider || '').toLowerCase();
  if (prov === 'openrouter') return 'openrouter';
  if (prov === 'doubao' || prov === 'ark' || prov === 'volcengine') return 'ark';
  const unit = String(meta?.unit || '').toLowerCase();
  if (unit.includes('token')) return 'openrouter';
  return 'other';
}

function openrouterOutputTokens(
  resolution?: string | null,
  tokenByResolution?: Record<string, number> | null
): number {
  const res = normalizeResolution(resolution);
  const override = tokenByResolution?.[res];
  if (typeof override === 'number' && override > 0) return Math.round(override);
  return GEMINI_OUTPUT_TOKENS[res] || GEMINI_OUTPUT_TOKENS['2K'];
}

/** Ark: ¥/image; Pro may switch by total pixel threshold. */
export function resolveArkImageUnitCny(
  model?: LlmModel | null,
  resolution?: string | null
): number | null {
  const meta = metaOf(model);
  const res = normalizeResolution(resolution || meta?.base_resolution || '2K');
  const lo = parsePriceAmount(meta?.output_image ?? null);
  const hi = parsePriceAmount(meta?.output_image_high ?? null);
  const thr = Number(meta?.high_pixels_threshold) || 0;
  if (lo != null && hi != null && thr > 0) {
    const area = RES_AREA[res] || RES_AREA['2K'];
    return area > thr ? hi : lo;
  }
  if (lo != null) return lo;
  return parsePriceAmount(model?.price == null ? null : String(model.price));
}

/** OpenRouter: flat ¥/image, or token × fixed Gemini buckets. */
export function resolveOpenRouterImageUnitCny(
  model?: LlmModel | null,
  resolution?: string | null
): number | null {
  const meta = metaOf(model);
  const res = normalizeResolution(resolution || meta?.base_resolution || '2K');
  const byRes = meta?.price_by_resolution_cny;
  if (byRes && byRes[res] != null) {
    const hit = parsePriceAmount(byRes[res]);
    if (hit != null) return hit;
  }

  const unit = String(meta?.unit || '').toLowerCase();
  const usdTok = Number(meta?.usd_per_output_token);
  if (
    Number.isFinite(usdTok) &&
    usdTok > 0 &&
    unit.includes('token')
  ) {
    const fx = Number(meta?.fx_usd_cny) > 0 ? Number(meta?.fx_usd_cny) : DEFAULT_FX;
    return openrouterOutputTokens(res, meta?.token_by_resolution) * usdTok * fx;
  }

  return parsePriceAmount(model?.price == null ? null : String(model.price));
}

export function resolveImageUnitCny(
  model?: LlmModel | null,
  resolution?: string | null
): number | null {
  const meta = metaOf(model);
  const kind = providerKind(model, meta);
  if (kind === 'openrouter') return resolveOpenRouterImageUnitCny(model, resolution);
  return resolveArkImageUnitCny(model, resolution);
}

function cnyToWalletCredits(priceCny: number, count = 1): number {
  return Math.max(
    1,
    Math.ceil(priceCny * count * (PLUS_FACE_CREDITS / PLUS_LIST_CNY) * DEFAULT_MARKUP)
  );
}

export function estimateImageCredits(
  model?: LlmModel | null,
  count = 1,
  resolution?: string | null
): number {
  const n = Math.max(1, Math.min(4, Math.round(count) || 1));
  const price = resolveImageUnitCny(model, resolution);
  if (price == null || price <= 0) return FALLBACK_CREDITS * n;
  return cnyToWalletCredits(price, n);
}

/** Video gen credit estimate — same ¥→credits conversion as image; fallback 8. */
export function estimateVideoCredits(model?: LlmModel | null): number {
  const price = parsePriceAmount(model?.price);
  if (price == null || price <= 0) return 8;
  return cnyToWalletCredits(price);
}

/** TTS / speech catalog price (¥/call) → wallet credits. */
export function estimateAudioCredits(model?: LlmModel | null): number {
  const price = parsePriceAmount(model?.price);
  if (price == null || price <= 0) return FALLBACK_CREDITS;
  return cnyToWalletCredits(price);
}

/**
 * Lottie gen credit estimate — LLM structured JSON, billed like chat tokens.
 * Matches wallet `TOKENS_PER_CREDIT` (15k billed ≈ 1 credit). Catalog chat `price`
 * is ¥/百万 tokens; scale vs mid-tier ¥2.
 */
const LOTTIE_TOKENS_PER_CREDIT = 15_000;
const LOTTIE_MID_PRICE_CNY_PER_MTOK = 2;

export function estimateLottieCredits(
  model?: LlmModel | null,
  durationSec = 3
): number {
  const sec = Math.max(0.5, Math.min(30, Number(durationSec) || 3));
  // Bodymovin JSON is token-heavy; longer clips → denser layer estimate.
  const estTokens = Math.round(10_000 + sec * 3_000);
  const billed = Math.ceil(estTokens * DEFAULT_MARKUP);
  let credits = Math.max(1, Math.ceil(billed / LOTTIE_TOKENS_PER_CREDIT));

  const price = parsePriceAmount(model?.price);
  if (price != null && price > 0) {
    const kind = String(model?.kind || '').toLowerCase();
    if (kind !== 'image' && kind !== 'video') {
      const scale = Math.min(3, Math.max(0.5, price / LOTTIE_MID_PRICE_CNY_PER_MTOK));
      credits = Math.max(1, Math.ceil(credits * scale));
    }
  }
  return credits;
}
