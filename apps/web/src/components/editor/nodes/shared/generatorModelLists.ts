import type { LlmModel } from '@/service/chat';
import {
  buildByokAwareModelList,
  DEFAULT_CLOUD_VIDEO_MODEL_ID,
  modelIsImageGenerator,
  modelSupportsVisionInput,
} from '@/components/editor/panels/agent/llmModelMeta';
import { customProvidersAsModels } from '@/components/editor/panels/agent/customLlmProviders';
import { isDesktopLocal } from '@/utils/apiBase';
import { FREE_IMAGE_MODEL_ID } from '@/utils/wallet';

const DEFAULT_AUDIO_MODEL_ID = 'or-gemini-3-1-flash-tts';

export function modelIsVideoGenerator(model?: Pick<LlmModel, 'kind' | 'id'> | null): boolean {
  if (!model) return false;
  if (model.kind === 'video') return true;
  return /seedance/i.test(model.id || '');
}

export function modelIsAudioGenerator(model?: Pick<LlmModel, 'kind' | 'id'> | null): boolean {
  if (!model) return false;
  if (model.kind === 'audio') return true;
  return /tts|kokoro|fish-audio|speech|audio/i.test(model.id || '');
}

export function modelIsAgentChat(model?: Pick<LlmModel, 'kind' | 'id'> | null): boolean {
  if (!model?.id) return false;
  if (model.id === 'auto') return false;
  if (model.kind === 'image' || model.kind === 'video') return false;
  return !/seedance|seedream|t2i|i2i/i.test(model.id);
}

/** Local desktop: BYOK only. Cloud/web: platform image catalog + BYOK. */
export function buildImageGeneratorModelList(res?: {
  models?: LlmModel[] | null;
  imageModels?: LlmModel[] | null;
} | null): LlmModel[] {
  return buildByokAwareModelList({
    byok: customProvidersAsModels(),
    catalogs: [res?.models, res?.imageModels],
    filter: (m) => modelIsImageGenerator(m) || m.kind === 'image',
  });
}

export function buildVideoGeneratorModelList(res?: {
  models?: LlmModel[] | null;
  videoModels?: LlmModel[] | null;
} | null): LlmModel[] {
  return buildByokAwareModelList({
    byok: customProvidersAsModels(),
    catalogs: [res?.models, res?.videoModels],
    filter: (m) => modelIsVideoGenerator(m),
  });
}

export function buildAudioGeneratorModelList(res?: {
  models?: LlmModel[] | null;
  audioModels?: LlmModel[] | null;
} | null): LlmModel[] {
  return buildByokAwareModelList({
    byok: customProvidersAsModels(),
    catalogs: [res?.models, res?.audioModels],
    filter: (m) => modelIsAudioGenerator(m),
  });
}

export function buildLottieChatModelList(res?: { models?: LlmModel[] | null } | null): LlmModel[] {
  return buildByokAwareModelList({
    byok: customProvidersAsModels(),
    catalogs: [res?.models],
    filter: (m) => modelIsAgentChat(m),
  });
}

export function nextImageModelId(models: LlmModel[], currentId: string): string | null {
  if (!models.length || models.some((m) => m.id === currentId)) return null;
  if (!isDesktopLocal()) {
    const free = models.find((m) => m.id === FREE_IMAGE_MODEL_ID);
    if (free) return free.id;
  }
  return models[0]?.id ?? null;
}

export function nextVideoModelId(models: LlmModel[], currentId: string): string | null {
  if (!models.length || models.some((m) => m.id === currentId)) return null;
  if (!isDesktopLocal()) {
    const preferred = models.find((m) => m.id === DEFAULT_CLOUD_VIDEO_MODEL_ID);
    if (preferred) return preferred.id;
  }
  return models[0]?.id ?? null;
}

export function nextAudioModelId(models: LlmModel[], currentId: string): string | null {
  if (!models.length || models.some((m) => m.id === currentId)) return null;
  if (!isDesktopLocal()) {
    const preferred = models.find((m) => m.id === DEFAULT_AUDIO_MODEL_ID);
    if (preferred) return preferred.id;
  }
  return models[0]?.id ?? null;
}

export function nextLottieChatModelId(models: LlmModel[], currentId: string): string | null {
  if (!models.length) return null;
  if (currentId && models.some((m) => m.id === currentId)) return null;
  return models[0]?.id ?? null;
}

export function pickVisionChatModel(
  models: LlmModel[],
  preferredId?: string
): LlmModel | undefined {
  const vision = models.filter((m) => modelSupportsVisionInput(m));
  if (!vision.length) return undefined;
  if (preferredId) {
    const hit = vision.find((m) => m.id === preferredId);
    if (hit) return hit;
  }
  return vision[0];
}
