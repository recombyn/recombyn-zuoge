/**
 * LLM catalog helpers for Agent UI (not HTTP — lives next to model pickers).
 */

import type { LlmModel, ModelReferenceType } from '@/service/chat';
import { FREE_IMAGE_MODEL_ID } from '@/utils/wallet';

/** Cloud default Seedance id. */
export const DEFAULT_CLOUD_VIDEO_MODEL_ID = 'or-seedance-2-0-fast';

export function isImageKind(m: Pick<LlmModel, 'kind' | 'id'> | null | undefined): boolean {
  if (!m) return false;
  if (m.kind === 'image') return true;
  return Boolean(m.id && /seedream|image|i2i|t2i/i.test(m.id));
}

export function isVideoKind(m: Pick<LlmModel, 'kind' | 'id'> | null | undefined): boolean {
  if (!m) return false;
  if (m.kind === 'video') return true;
  return Boolean(m.id && /seedance|kling|runway|luma|minimax.*video|sora/i.test(m.id));
}

export function dedupeModelsById(models: LlmModel[]): LlmModel[] {
  const seen = new Set<string>();
  return models.filter((m) => {
    if (!m?.id || seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

/** Catalog buckets + BYOK, then filter. */
export function buildByokAwareModelList(opts: {
  byok: LlmModel[];
  catalogs?: Array<LlmModel[] | null | undefined>;
  filter: (m: LlmModel) => boolean;
}): LlmModel[] {
  const pool = [...(opts.catalogs || []).flatMap((c) => c || []), ...opts.byok];
  return dedupeModelsById(pool.filter(opts.filter));
}

export function cloudOnlyModelId(cloudId: string): string {
  return cloudId;
}

export function cloudImageFallbackId(): string {
  return cloudOnlyModelId(FREE_IMAGE_MODEL_ID);
}

export function cloudVideoFallbackId(): string {
  return cloudOnlyModelId(DEFAULT_CLOUD_VIDEO_MODEL_ID);
}

export function pickPreferredImageModelId(models: LlmModel[], currentId?: string): string {
  const images = models.filter((m) => isImageKind(m));
  if (currentId && images.some((m) => m.id === currentId)) return currentId;
  const free = images.find((m) => m.id === FREE_IMAGE_MODEL_ID);
  if (free) return free.id;
  const seedream = images.find((m) => /seedream/i.test(m.id));
  if (seedream) return seedream.id;
  return images[0]?.id || '';
}

export function pickPreferredVideoModelId(models: LlmModel[], currentId?: string): string {
  const videos = models.filter((m) => isVideoKind(m));
  if (currentId && videos.some((m) => m.id === currentId)) return currentId;
  const def = videos.find((m) => m.id === DEFAULT_CLOUD_VIDEO_MODEL_ID);
  if (def) return def.id;
  return videos[0]?.id || '';
}

/** Merge catalog + image/video buckets + BYOK; normalize kind. */
export function mergeSelectableModels(opts: {
  models?: LlmModel[] | null;
  imageModels?: LlmModel[] | null;
  videoModels?: LlmModel[] | null;
  customModels: LlmModel[];
  withMaxAttachments?: boolean;
}): LlmModel[] {
  const mapKind = (m: LlmModel): LlmModel => {
    const base = opts.withMaxAttachments
      ? { ...m, maxAttachments: maxAttachmentsFor(m) }
      : m;
    if (isVideoKind(m)) return { ...base, kind: 'video' as const };
    if (isImageKind(m)) return { ...base, kind: 'image' as const };
    if (m.kind === 'svg') return { ...base, kind: 'text' as const };
    return { ...base, kind: (m.kind || 'text') as LlmModel['kind'] };
  };

  const byId = new Map<string, LlmModel>();
  for (const m of opts.models || []) {
    if (!m?.id) continue;
    byId.set(m.id, m);
  }
  for (const m of opts.imageModels || []) {
    if (!m?.id) continue;
    byId.set(m.id, { ...byId.get(m.id), ...m, kind: 'image' });
  }
  for (const m of opts.videoModels || []) {
    if (!m?.id) continue;
    byId.set(m.id, { ...byId.get(m.id), ...m, kind: 'video' });
  }
  for (const m of opts.customModels) {
    if (!m?.id) continue;
    byId.set(m.id, m);
  }
  return [...byId.values()]
    .filter((m) => m.provider === 'custom' || isVolcanoCatalogModel(m))
    .map(mapKind);
}

export function modelReferenceTypes(
  model?: Pick<
    LlmModel,
    'id' | 'kind' | 'referenceTypes' | 'maxAttachments'
  > | null
): ModelReferenceType[] {
  if (!model) return [];
  const raw = model.referenceTypes;
  if (Array.isArray(raw) && raw.length) {
    const out: ModelReferenceType[] = [];
    for (const t of raw) {
      if ((t === 'text' || t === 'vision' || t === 'image') && !out.includes(t)) out.push(t);
    }
    if (out.length) return out;
  }
  if (model.kind === 'image') return ['image'];
  if (modelSupportsVisionInput(model)) return ['text', 'vision'];
  return ['text'];
}

export function modelAllowsRouteSlot(
  model: Pick<
    LlmModel,
    'id' | 'kind' | 'referenceTypes' | 'maxAttachments'
  > | null | undefined,
  slot: 'fast' | 'standard' | 'reasoning' | 'vision' | 'image'
): boolean {
  if (!model) return false;
  const types = modelReferenceTypes(model);
  if (slot === 'image') return types.includes('image') || model.kind === 'image';
  if (slot === 'vision') return types.includes('vision');
  return types.includes('text') || types.includes('vision');
}

export function isVolcanoCatalogModel(
  m?: Pick<LlmModel, 'provider' | 'enabled'> | null
): boolean {
  if (!m) return false;
  if (m.enabled === false) return false;
  return (m.provider || '').toLowerCase() !== 'deepseek';
}

export function maxAttachmentsFor(
  model?: Pick<LlmModel, 'kind' | 'maxAttachments'> | null
): number {
  const raw = model?.maxAttachments;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  if (model?.kind === 'image') return 14;
  return 5;
}

/**
 * Composer attach ceiling (Dock + Home share this).
 * Image mode → current image model; Agent/Ask → routed image model.
 */
export function agentAttachmentLimit(opts: {
  models: LlmModel[];
  modelId: string;
  isImageMode: boolean;
  rules?: Record<string, string> | null;
  routedImageId?: string | null;
  freeImageId?: string;
  autoModel?: LlmModel | null;
}): number {
  const {
    models,
    modelId,
    isImageMode,
    rules,
    routedImageId,
    freeImageId = '',
    autoModel = null,
  } = opts;
  const images = models.filter(
    (m) => m.kind === 'image' || /seedream|t2i|i2i/i.test(m.id)
  );
  const pickImage = () =>
    images.find((m) => m.id === modelId) ||
    (freeImageId ? images.find((m) => m.id === freeImageId) : undefined) ||
    (freeImageId ? images.find((m) => /seedream/i.test(m.id)) : undefined) ||
    images[0];

  if (isImageMode) return maxAttachmentsFor(pickImage());

  const want =
    String(routedImageId || '').trim() ||
    String(rules?.['assets.image_default_model'] || '').trim() ||
    freeImageId;
  const routed =
    (want ? images.find((m) => m.id === want) : undefined) || pickImage();
  const imageLimit = maxAttachmentsFor(routed);
  if (modelId === 'auto' || !modelId) return imageLimit;
  const chat = models.find((m) => m.id === modelId) || autoModel;
  if (!chat || chat.id === 'auto') return imageLimit;
  return Math.min(maxAttachmentsFor(chat), imageLimit);
}

export function modelSupportsVisionInput(
  model?: Pick<
    LlmModel,
    'id' | 'kind' | 'referenceTypes' | 'maxAttachments'
  > | null
): boolean {
  if (!model || model.kind === 'image') return false;
  const tagged = model.referenceTypes;
  if (Array.isArray(tagged) && tagged.length) {
    return tagged.includes('vision');
  }
  const id = String(model.id || '').toLowerCase();
  if (!id || id === 'auto' || id.includes('seedream')) return false;
  if (
    id.includes('seed-2-1') ||
    id.includes('seed-2.1') ||
    id.includes('vision') ||
    /(^|[-_])vl([-_]|$)/.test(id)
  ) {
    return true;
  }
  return maxAttachmentsFor(model) >= 16;
}

export function modelIsImageGenerator(
  model?: Pick<LlmModel, 'kind' | 'id'> | null
): boolean {
  if (!model) return false;
  if (model.kind === 'image') return true;
  const id = (model.id || '').toLowerCase();
  return /seedream|t2i|i2i/.test(id);
}
