/**
 * Image toolbar AI tools — POST /api/v1/image/process
 * (Real-ESRGAN upscale, intelligence vision, or Seedream i2i).
 */

import { useQuery } from '@tanstack/react-query';
import { abortAfter, apiClient } from '@/service/client';
import { useBillingEnabled } from '@/service/wallet';

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
  image: string;
  text?: string | null;
  kind: string;
  model?: string;
  /** editText / editElements: split layers in source-pixel coords */
  layers?: ImageDecomposeLayer[];
  width?: number;
  height?: number;
  warnings?: string[];
  engines?: string[];
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

/** Fallback when `/image/tools` has not loaded yet — keep in sync with API `_KIND_CREDIT_COST`. */
const IMAGE_TOOL_CREDIT_FALLBACK: Partial<Record<ImageProcessKindApi | string, number>> = {
  multiAngle: 30,
  expand: 30,
  replaceText: 30,
  vector: 20,
};

/** Server-reported credit cost for a toolbar kind (0 when billing off / no LLM). */
export function useImageToolCreditCost(kind: ImageProcessKindApi | string): number {
  const billingEnabled = useBillingEnabled();
  const caps = useImageToolCapabilities();
  if (!billingEnabled || !kind) return 0;
  const fromApi = caps.data?.credits?.[kind];
  if (typeof fromApi === 'number' && Number.isFinite(fromApi)) return Math.max(0, Math.round(fromApi));
  const fallback = IMAGE_TOOL_CREDIT_FALLBACK[kind];
  return typeof fallback === 'number' ? fallback : 0;
}

/** Run an image toolbar tool on the API (intelligence vision or Seedream i2i). */
export const processImageTool = (
  data: ImageProcessBody,
  opts?: { signal?: AbortSignal }
) =>
  apiClient.imageToolsPostImageProcess(
    { body: data as never },
    { signal: abortAfter(180_000, opts?.signal) }
  ) as Promise<ImageProcessResult>;
