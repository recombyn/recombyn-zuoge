import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react';
import type { LlmModel, ChatModelsResponse } from '@/service/chat';
import { apiQuery, queryClient } from '@/service/client';
import {
  agentAttachmentLimit,
  cloudImageFallbackId,
  cloudVideoFallbackId,
  isImageKind,
  isVideoKind,
  mergeSelectableModels,
  pickPreferredImageModelId,
  pickPreferredVideoModelId,
} from '@/components/editor/panels/agent/llmModelMeta';
import AgentComposerShell, {
  type ComposerInteractionMode,
  type ImageModeComposerControls,
  type VideoModeComposerControls,
} from '@/components/editor/panels/agent/composer/AgentComposerShell';
import {
  chipBaseKey,
  parseAtMentionQuery,
  stripTrailingAtQuery,
  type AgentComposerHandle,
  type ComposerContext,
} from '@/components/editor/panels/AgentComposerInput';
import MentionAttachPanel, {
  type MentionAttachItem,
} from '@/components/editor/panels/agent/composer/MentionAttachPanel';
import {
  DEFAULT_IMAGE_ASPECT_RATIO,
  DEFAULT_IMAGE_COUNT,
  DEFAULT_IMAGE_RESOLUTION,
  modelImageLimits,
} from '@/components/editor/panels/agent/shared/ImageAspectRatioPicker';
import ModelPickerPanel, {
  ModelBrandIcon,
  modelTabOf,
  type ModelPickerTab,
} from '@/components/editor/panels/agent/models/ModelPickerPanel';
import {
  loadAgentRoutePrefs,
  loadDesignIntensity,
  warmOpenrouterAvailability,
  routeOverridesForApi,
} from '@/components/editor/panels/agent/agentRoutePrefs';
import { AgentRoutePrefsEditor } from '@/components/editor/panels/agent/models/AgentRoutePrefsEditor';
import { customProvidersAsModels } from '@/components/editor/panels/agent/customLlmProviders';
import { cn } from '@/utils/classnames';
import { useWalletSnapshot } from '@/service/wallet';
import { FREE_IMAGE_MODEL_ID, planAllowsModelId, planAllowsModelPick } from '@/utils/wallet';
import { nanoid } from 'nanoid';
import {
  deleteUploadedFile,
  readFileAsDataUrl,
  uploadComposerAttachment,
} from '@/utils/uploadImage';
import { message, Dropdown } from '@/components/base';
import AppLogo from '@/components/base/AppLogo';
import { estimateImageCredits, estimateVideoCredits } from '@/utils/imageCredits';

export type HomeAgentCategory =
  | 'website'
  | 'mobile'
  | 'image'
  | 'poster'
  | 'drawing'
  | 'video';

const EXAMPLE_CHIPS_BY_CATEGORY: Record<HomeAgentCategory, readonly string[]> = {
  poster: ['eventPoster', 'commercePoster', 'brandPoster'],
  mobile: ['officeApp', 'landing', 'login'],
  image: ['productShot', 'illustSet', 'styleAvatar'],
  video: ['storyboard', 'promoClip', 'conceptBoard'],
  website: ['landing', 'dashboard', 'login'],
  drawing: ['pencilSketch', 'inkWash', 'markerDraw'],
};

function exampleChipKeysForCategory(category: HomeAgentCategory): readonly string[] {
  return EXAMPLE_CHIPS_BY_CATEGORY[category] || EXAMPLE_CHIPS_BY_CATEGORY.poster;
}

/** Pixso-style capability promo 鈥?opens from銆孉I鑳藉仛浠€涔堛€? */
function HomeAiCapabilityCard(): ReactNode {
  const { t } = useTranslation();
  return (
    <div
      className="w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-[10px] bg-[var(--surface)] shadow-[0_12px_40px_rgba(15,23,42,0.16)] ring-1 ring-[var(--line)]"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="relative flex h-[7.5rem] items-center justify-center overflow-hidden"
        style={{
          background:
            'linear-gradient(165deg, #f4f7ff 0%, #e8f0ff 42%, #fff 72%)',
        }}
      >
        <div className="relative z-[1] inline-flex items-center gap-2 text-[#141414]">
          {/* Header stay light 鈥?always use dark mark + dark type. */}
          <AppLogo size={28} scheme="dark" />
          <span
            className="text-[18px] font-semibold tracking-tight text-[#141414]"
            style={{ fontFamily: 'var(--font-hero)' }}
          >
            {t('app.name')} AI
          </span>
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[2.75rem]"
          style={{
            background:
              'linear-gradient(90deg, #1a4fd8 0%, #3370ff 38%, #7aa7ff 62%, #ff7eb3 100%)',
            clipPath: 'ellipse(75% 100% at 50% 100%)',
            opacity: 0.92,
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-8 opacity-40"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 40%, rgba(255,255,255,0.9) 0 1px, transparent 1.5px), radial-gradient(circle at 70% 60%, rgba(255,255,255,0.75) 0 1px, transparent 1.5px), radial-gradient(circle at 45% 20%, rgba(255,255,255,0.65) 0 0.8px, transparent 1.2px)',
            backgroundSize: '48px 24px',
          }}
        />
      </div>
      <div className="px-4 pb-4 pt-3.5 text-left">
        <h3 className="text-[15px] font-semibold leading-snug text-[var(--ink)]">
          {t('home.aiPromoTitle')}
        </h3>
        <p className="mt-1.5 text-[12px] leading-[1.55] text-[var(--muted)]">
          {t('home.aiPromoBody')}
        </p>
      </div>
    </div>
  );
}

export type HomeAgentSubmitPayload = {
  prompt: string;
  attachments: ComposerContext[];
  modelId?: string;
  interactionMode?: ComposerInteractionMode;
  imageAspectRatio?: string;
  category?: HomeAgentCategory;
  scene?: HomeAgentCategory | null;
};

type Props = {
  onSubmit: (payload: HomeAgentSubmitPayload) => void;
  className?: string;
  category?: HomeAgentCategory;
  /** Keep hero category tabs in sync with composer Image mode. */
  onCategoryChange?: (category: HomeAgentCategory) => void;
};

/** Merge catalog + imageModels + videoModels; normalize kind (same as AgentDock). */
function normalizeModelList(
  models: LlmModel[] | undefined,
  imageModels?: LlmModel[] | null,
  videoModels?: LlmModel[] | null
): LlmModel[] {
  return mergeSelectableModels({
    models,
    imageModels,
    videoModels,
    customModels: customProvidersAsModels(),
  });
}

const DEFAULT_VIDEO_ASPECT_RATIO = '16:9';
const DEFAULT_VIDEO_RESOLUTION = '720p';
const DEFAULT_VIDEO_DURATION = 5;

function aspectRatioForCategory(category: HomeAgentCategory): string {
  switch (category) {
    case 'image':
      return DEFAULT_IMAGE_ASPECT_RATIO as string;
    case 'video':
      return DEFAULT_VIDEO_ASPECT_RATIO;
    // Design agent categories: Smart only — LLM picks create_frame WxH.
    case 'mobile':
    case 'poster':
    case 'drawing':
    case 'website':
    default:
      return 'auto';
  }
}

function modelTabForCategory(category: HomeAgentCategory): ModelPickerTab {
  if (category === 'image') return 'image';
  if (category === 'video') return 'video';
  return 'design';
}

function interactionModeForCategory(category: HomeAgentCategory): ComposerInteractionMode {
  if (category === 'image') return 'image';
  if (category === 'video') return 'video';
  return 'agent';
}

function hasUploadingAttachment(contexts: ComposerContext[]): boolean {
  return contexts.some((c) => c.kind === 'attachment' && c.uploadStatus === 'uploading');
}

function resolveHomeSubmitModelId(opts: {
  canPickModel: boolean;
  isImageModelSelected: boolean;
  modelId: string;
}): string {
  if (!opts.canPickModel) {
    return opts.isImageModelSelected ? cloudImageFallbackId() || 'auto' : 'auto';
  }
  return opts.modelId;
}

function homeModelChipLabel(
  modelId: string,
  models: Array<{ id: string; label?: string }>,
  autoLabel: string
): string {
  if (modelId === 'auto') return autoLabel;
  return models.find((m) => m.id === modelId)?.label || modelId;
}

function resolveHomeIsImageSubmit(opts: {
  isImageInteraction: boolean;
  canPickModel: boolean;
  category: HomeAgentCategory;
  isImageModelSelected: boolean;
  resolvedModelId: string;
  models: LlmModel[];
}): boolean {
  if (opts.isImageInteraction) return true;
  if (opts.canPickModel) {
    return (
      opts.category === 'image' ||
      isImageKind(opts.models.find((m) => m.id === opts.resolvedModelId))
    );
  }
  return opts.isImageModelSelected || opts.category === 'image';
}

function resolveModelIdAfterCatalogLoad(
  prev: string,
  list: LlmModel[],
  canPickModel: boolean
): string {
  if (!canPickModel) {
    return planAllowsModelId('free', prev) ? prev : 'auto';
  }
  return prev === 'auto' || (prev && list.some((m) => m.id === prev)) ? prev || 'auto' : 'auto';
}

const TYPE_MS = 72;
const DELETE_MS = 36;
const HOLD_MS = 1800;

/** Typewriter cycle through prompt phrases (type 鈫?hold 鈫?delete 鈫?next). */
function useTypewriterCycle(phrases: string[], enabled = true): string {
  const [index, setIndex] = useState(0);
  const [len, setLen] = useState(0);
  const [phase, setPhase] = useState<'type' | 'delete'>('type');
  const phrase = phrases.length ? phrases[index % phrases.length]! : '';

  useEffect(() => {
    if (!enabled || !phrases.length) {
      setLen(0);
      setPhase('type');
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout>;
    if (phase === 'type') {
      if (len < phrase.length) {
        timer = setTimeout(() => setLen((n) => n + 1), TYPE_MS);
      } else {
        timer = setTimeout(() => setPhase('delete'), HOLD_MS);
      }
    } else if (len > 0) {
      timer = setTimeout(() => setLen((n) => n - 1), DELETE_MS);
    } else {
      timer = setTimeout(() => {
        setIndex((i) => (i + 1) % phrases.length);
        setPhase('type');
      }, 280);
    }
    return () => clearTimeout(timer);
  }, [enabled, phrases, phrase, index, len, phase]);

  if (!enabled) return '';
  return phrase.slice(0, len);
}

/** Home-page agent composer 鈥?same shell + model popover as editor AgentDock. */
function HomeAgentComposer({
  onSubmit,
  className,
  category = 'poster',
  onCategoryChange,
}: Props): ReactNode {
  const { t, i18n } = useTranslation();
  const { planId } = useWalletSnapshot();
  const canPickModel = planAllowsModelPick(planId);
  const inputRef = useRef<AgentComposerHandle | null>(null);
  const [value, setValue] = useState('');
  const [contexts, setContexts] = useState<ComposerContext[]>([]);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [modelId, setModelId] = useState('auto');
  const [modelTab, setModelTab] = useState<ModelPickerTab>(() =>
    modelTabForCategory(category)
  );
  const [modelsStatus, setModelsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [modelsWanted, setModelsWanted] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [designIntensity, setDesignIntensity] = useState(() => loadDesignIntensity());
  useEffect(() => {
    const sync = () => setDesignIntensity(loadDesignIntensity());
    window.addEventListener('storage', sync);
    window.addEventListener('recombyn-design-intensity', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('recombyn-design-intensity', sync);
    };
  }, []);
  const [mentionPanelOpen, setMentionPanelOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [interactionMode, setInteractionMode] = useState<ComposerInteractionMode>(() =>
    interactionModeForCategory(category)
  );
  const [imageModelPanelOpen, setImageModelPanelOpen] = useState(false);
  const [videoModelPanelOpen, setVideoModelPanelOpen] = useState(false);
  const [imageResolution, setImageResolution] = useState(DEFAULT_IMAGE_RESOLUTION);
  const [imageGenAspectRatio, setImageGenAspectRatio] = useState(DEFAULT_IMAGE_ASPECT_RATIO);
  const [imageGenCount, setImageGenCount] = useState(DEFAULT_IMAGE_COUNT);
  const [videoResolution, setVideoResolution] = useState(DEFAULT_VIDEO_RESOLUTION);
  const [videoGenAspectRatio, setVideoGenAspectRatio] = useState(DEFAULT_VIDEO_ASPECT_RATIO);
  const [videoGenDuration, setVideoGenDuration] = useState(DEFAULT_VIDEO_DURATION);
  const contextsRef = useRef(contexts);
  contextsRef.current = contexts;
  const [imageAspectRatio, setImageAspectRatio] = useState(() =>
    aspectRatioForCategory(category)
  );

  const enterVideoMode = (nextModels: LlmModel[] = models) => {
    setInteractionMode('video');
    setModelTab('video');
    setModelOpen(false);
    setModelId(
      canPickModel ? pickPreferredVideoModelId(nextModels) : cloudVideoFallbackId() || 'auto'
    );
  };

  const leaveVideoMode = () => {
    setInteractionMode((m) => (m === 'video' ? 'agent' : m));
    setModelTab('design');
    setModelId('auto');
    setVideoModelPanelOpen(false);
  };

  const enterImageMode = (nextModels: LlmModel[] = models) => {
    setInteractionMode('image');
    setModelTab('image');
    setModelOpen(false);
    setModelId(
      canPickModel ? pickPreferredImageModelId(nextModels) : cloudImageFallbackId() || 'auto'
    );
  };

  const leaveImageMode = () => {
    setInteractionMode((m) => (m === 'image' ? 'agent' : m));
    setModelTab('design');
    setModelId('auto');
    setImageModelPanelOpen(false);
  };

  useEffect(() => {
    setImageAspectRatio(aspectRatioForCategory(category));
    // Hero Image / Video tabs 鈫?composer interaction chrome.
    if (category === 'image') {
      leaveVideoMode();
      enterImageModeWithModels();
    } else if (category === 'video') {
      leaveImageMode();
      enterVideoModeWithModels();
    } else {
      leaveImageMode();
      leaveVideoMode();
    }
    // Only react to category 鈥?models list is read at switch time.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [category, canPickModel]);

  useEffect(() => {
    if (canPickModel) return;
    setModelId((prev) => {
      if (prev === FREE_IMAGE_MODEL_ID) {
        setModelTab('image');
        return prev;
      }
      setModelTab('design');
      return 'auto';
    });
  }, [canPickModel]);

  const placeholderPrefix = t('home.composerPlaceholderPrefix');
  const placeholderPrompts = useMemo(() => {
    // Optional per-category list: home.composerPlaceholderPromptsByCategory.{category}
    const byCat = t(`home.composerPlaceholderPromptsByCategory.${category}`, {
      returnObjects: true,
      defaultValue: [],
    });
    if (Array.isArray(byCat) && byCat.length) return byCat.map(String).filter(Boolean);
    const raw = t('home.composerPlaceholderPrompts', { returnObjects: true });
    return Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
  }, [t, i18n.language, category]);
  // Pause typewriter while the user has text/chips 鈥?avoids re-render storms during paste/typing.
  const typewriterOn = !value.trim() && contexts.length === 0;
  const typedPrompt = useTypewriterCycle(placeholderPrompts, typewriterOn);
  const [caretOn, setCaretOn] = useState(true);
  useEffect(() => {
    if (!typewriterOn) return undefined;
    const id = window.setInterval(() => setCaretOn((v) => !v), 530);
    return () => window.clearInterval(id);
  }, [typewriterOn]);
  const composerPlaceholder = typewriterOn
    ? `${placeholderPrefix}${typedPrompt}${caretOn ? '|' : ' '}`
    : '';

  const modelsInflightRef = useRef<Promise<LlmModel[]> | null>(null);

  const modelsQuery = useQuery({
    ...apiQuery.chatGetModels.queryOptions(),
    staleTime: 60_000,
    enabled: modelsWanted,
  });

  useEffect(() => {
    if (!modelsWanted) return;
    if (modelsQuery.isPending) {
      setModelsStatus('loading');
      return;
    }
    if (modelsQuery.isError) {
      setModels([]);
      setModelsStatus('error');
      return;
    }
    if (!modelsQuery.isFetched) return;
    const res = modelsQuery.data as ChatModelsResponse | undefined;
    if (!res) {
      setModels([]);
      setModelsStatus('error');
      return;
    }
    warmOpenrouterAvailability(res.openrouterAvailable);
    const list = normalizeModelList(res.models, res.imageModels, res.videoModels);
    setModels(list);
    setModelsStatus('ready');
    setModelId((prev) => resolveModelIdAfterCatalogLoad(prev, list, canPickModel));
  }, [
    modelsWanted,
    modelsQuery.data,
    modelsQuery.isPending,
    modelsQuery.isError,
    modelsQuery.isFetched,
    canPickModel,
  ]);

  /** Models catalog — only when Image/Video mode or opening a model picker (not on home mount). */
  const ensureModelsLoaded = async (): Promise<LlmModel[]> => {
    if (modelsStatus === 'ready') return models;
    if (modelsInflightRef.current) return modelsInflightRef.current;
    setModelsWanted(true);
    setModelsStatus('loading');

    async function loadModels(): Promise<LlmModel[]> {
      try {
        const res = (await queryClient.ensureQueryData({
          ...apiQuery.chatGetModels.queryOptions(),
          staleTime: 60_000,
        })) as ChatModelsResponse;
        warmOpenrouterAvailability(res?.openrouterAvailable);
        const list = normalizeModelList(res?.models, res?.imageModels, res?.videoModels);
        setModels(list);
        setModelsStatus('ready');
        setModelId((prev) => resolveModelIdAfterCatalogLoad(prev, list, canPickModel));
        return list;
      } catch {
        setModels([]);
        setModelsStatus('error');
        return [] as LlmModel[];
      } finally {
        modelsInflightRef.current = null;
      }
    }

    const pending = loadModels();
    modelsInflightRef.current = pending;
    return pending;
  };

  const enterImageModeWithModels = async () => {
    const list = await ensureModelsLoaded();
    enterImageMode(list);
  };

  const enterVideoModeWithModels = async () => {
    const list = await ensureModelsLoaded();
    enterVideoMode(list);
  };

  const canSend = value.trim().length > 0 && !hasUploadingAttachment(contexts);
  const selectedModel =
    modelId === 'auto'
      ? ({ id: 'auto', label: 'Auto', provider: 'system', kind: 'text' } as LlmModel)
      : models.find((x) => x.id === modelId);
  const isVideoInteraction = interactionMode === 'video';
  const isVideoModelSelected =
    isVideoInteraction || modelTab === 'video' || modelTabOf(selectedModel) === 'video';
  const isImageInteraction = interactionMode === 'image';
  const isImageModelSelected =
    !isVideoInteraction &&
    (isImageInteraction || modelTab === 'image' || modelTabOf(selectedModel) === 'image');

  const imageModels = models.filter((m) => isImageKind(m));
  const imageFallbackId = cloudImageFallbackId();
  const imageModeSelectedModel =
    imageModels.find((m) => m.id === modelId) ||
    (imageFallbackId ? imageModels.find((m) => m.id === imageFallbackId) : undefined) ||
    imageModels[0];

  const attachmentLimit = agentAttachmentLimit({
    models,
    modelId,
    isImageMode: isImageModelSelected || isVideoModelSelected,
    routedImageId: routeOverridesForApi(loadAgentRoutePrefs())?.image,
    freeImageId: imageFallbackId || undefined,
  });
  const attachmentCount = contexts.filter((c) => c.kind === 'attachment').length;
  const attachFull = attachmentCount >= attachmentLimit;

  const imageModeControls: ImageModeComposerControls | null = isImageInteraction
    ? {
        resolution: imageResolution,
        aspectRatio: imageGenAspectRatio,
        imageCount: imageGenCount,
        onResolutionChange: (r) => setImageResolution(r as typeof imageResolution),
        onAspectRatioChange: (r) => setImageGenAspectRatio(r as typeof imageGenAspectRatio),
        onImageCountChange: (n) =>
          setImageGenCount(
            Math.max(1, Math.min(4, Math.round(n) || 1)) as typeof imageGenCount
          ),
        imageLimits: modelImageLimits(imageModeSelectedModel),
        creditCost: estimateImageCredits(
          imageModeSelectedModel,
          imageGenCount,
          imageResolution
        ),
        modelLabel: String(
          imageModeSelectedModel?.label || modelId || imageFallbackId || ''
        ),
        modelIcon: (
          <ModelBrandIcon
            model={imageModeSelectedModel || { id: modelId || imageFallbackId || '' }}
            className="h-3.5 w-3.5 shrink-0"
          />
        ),
        modelOpen: imageModelPanelOpen,
        onModelOpenChange: (next) => {
          if (next) ensureModelsLoaded();
          setImageModelPanelOpen(next);
        },
        modelPanel: (
          <ModelPickerPanel
            tab="image"
            models={models}
            selectedId={modelId}
            status={modelsStatus}
            autoOnly={!canPickModel}
            onPick={(id) => {
              setModelId(id);
              setModelTab('image');
              setImageModelPanelOpen(false);
            }}
          />
        ),
      }
    : null;

  const videoModels = models.filter((m) => isVideoKind(m));
  const videoFallbackId = cloudVideoFallbackId();
  const videoModeSelectedModel =
    videoModels.find((m) => m.id === modelId) ||
    (videoFallbackId ? videoModels.find((m) => m.id === videoFallbackId) : undefined) ||
    videoModels[0];
  const videoModeControls: VideoModeComposerControls | null = isVideoInteraction
    ? {
        resolution: videoResolution,
        aspectRatio: videoGenAspectRatio,
        duration: videoGenDuration,
        onResolutionChange: (r) => setVideoResolution(r),
        onAspectRatioChange: (r) => setVideoGenAspectRatio(r),
        onDurationChange: (d) =>
          setVideoGenDuration(Math.max(1, Math.round(d) || DEFAULT_VIDEO_DURATION)),
        creditCost: estimateVideoCredits(videoModeSelectedModel),
        modelLabel: String(
          videoModeSelectedModel?.label || modelId || videoFallbackId || ''
        ),
        modelIcon: (
          <ModelBrandIcon
            model={videoModeSelectedModel || { id: modelId || videoFallbackId || '' }}
            className="h-3.5 w-3.5 shrink-0"
          />
        ),
        modelOpen: videoModelPanelOpen,
        onModelOpenChange: (next) => {
          if (next) ensureModelsLoaded();
          setVideoModelPanelOpen(next);
        },
        modelPanel: (
          <ModelPickerPanel
            tab="video"
            models={models}
            selectedId={modelId}
            status={modelsStatus}
            autoOnly={!canPickModel}
            onPick={(id) => {
              setModelId(id);
              setModelTab('video');
              setVideoModelPanelOpen(false);
            }}
          />
        ),
      }
    : null;

  const imageAspectProps = {
    // Agent canvas size defaults to Smart (auto) — no manual size popover.
    showDesignSizePicker: false,
    imageAspectRatio,
    onImageAspectRatioChange: setImageAspectRatio,
    aspectMenuPlacement: 'bottom-end' as const,
  };

  const exampleChipKeys = exampleChipKeysForCategory(category);

  const applyExampleChip = (chipKey: string) => {
    const prompt = t(`home.chipPrompts.${chipKey}`);
    if (!prompt || prompt.startsWith('home.chipPrompts.')) return;
    setValue(prompt);
    queueMicrotask(() => {
      inputRef.current?.focusEnd();
    });
  };

  const homeExampleActions = (
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto text-[12px] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <span className="shrink-0 text-[var(--muted)]">{t('home.examplesLabel')}</span>
      {exampleChipKeys.map((key) => (
        <button
          key={`${category}:${key}`}
          type="button"
          onClick={() => applyExampleChip(key)}
          className="shrink-0 text-[12px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--home-cta)]"
        >
          {t(`home.chips.${key}`)}
        </button>
      ))}
      <span className="shrink-0 text-[var(--line)]" aria-hidden>
        |
      </span>
      <Dropdown
        trigger="hover"
        placement="bottom-start"
        strategy="fixed"
        offset={10}
        items={[]}
        floatingClassName="z-[80]"
        referenceClassName="inline-flex shrink-0"
        popupRender={() => <HomeAiCapabilityCard />}
      >
        <button
          type="button"
          className="font-medium text-[var(--home-cta)] transition-opacity hover:opacity-80"
        >
          {t('home.whatAiCanDo')}
        </button>
      </Dropdown>
    </div>
  );

  const handleSubmit = () => {
    const prompt = value.trim();
    if (!prompt) return;
    if (hasUploadingAttachment(contexts)) {
      message.warning(t('agent.attachWaitUpload'));
      return;
    }
    const resolvedModelId = resolveHomeSubmitModelId({
      canPickModel,
      isImageModelSelected,
      modelId,
    });
    const isImage = !isVideoInteraction && resolveHomeIsImageSubmit({
      isImageInteraction,
      canPickModel,
      category,
      isImageModelSelected,
      resolvedModelId,
      models,
    });

    let submitMode: ComposerInteractionMode = interactionMode;
    if (isVideoInteraction) submitMode = 'video';
    else if (isImage) submitMode = 'image';

    let scene: HomeAgentCategory | null = category;
    if (isVideoInteraction || category === 'video') scene = null;
    else if (isImage) scene = 'image';

    let submitAspect = imageAspectRatio;
    if (isImage) submitAspect = String(imageGenAspectRatio);
    else if (isVideoInteraction) submitAspect = String(videoGenAspectRatio);
    else {
      // Design agent: Smart only — LLM picks create_frame WxH (never lock category stock).
      submitAspect = 'auto';
    }

    onSubmit({
      prompt,
      attachments: contexts.filter((c) => c.kind === 'attachment'),
      modelId: resolvedModelId === 'auto' ? undefined : resolvedModelId || undefined,
      interactionMode: submitMode,
      category,
      scene,
      // Design canvas size for agent scenes; image-gen ratio for Image chat mode.
      imageAspectRatio: submitAspect,
    });
  };

  const onAttachFiles = async (files: File[], opts?: { mention?: boolean }) => {
    const MAX = 10 * 1024 * 1024;
    const slots = Math.max(0, attachmentLimit - attachmentCount);
    if (slots <= 0) {
      message.warning(t('agent.attachMaxReached', { count: attachmentLimit }));
      return;
    }

    const accepted: File[] = [];
    for (const file of files.slice(0, slots)) {
      if (isVideoInteraction) {
        if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue;
      } else if (!file.type.startsWith('image/')) {
        continue;
      }
      if (file.size > MAX) {
        message.warning(t('agent.attachTooLarge', { name: file.name }));
        continue;
      }
      accepted.push(file);
    }
    if (!accepted.length) return;

    const previews = await Promise.all(
      accepted.map(async (file) => {
        try {
          return { file, preview: await readFileAsDataUrl(file), ok: true as const };
        } catch {
          message.error(t('agent.attachReadFailed', { name: file.name }));
          return { file, preview: '', ok: false as const };
        }
      })
    );
    const readable = previews.filter((p) => p.ok);
    if (!readable.length) return;

    let mentionOrdinal = contextsRef.current.filter((c) => c.kind === 'attachment').length;
    const batch = readable.map(({ file, preview }) => {
      const key = `att-${nanoid(8)}`;
      const pending: ComposerContext = {
        key,
        label: file.name || 'image',
        kind: 'attachment',
        payload: file.name || 'image',
        dataUrl: preview,
        thumbUrl: preview,
        uploadStatus: 'uploading',
      };
      mentionOrdinal += 1;
      const n = mentionOrdinal;
      const mentionCtx: ComposerContext | null = opts?.mention
        ? {
            key: `attach-ref:${chipBaseKey(key)}`,
            label: t('agent.mentionAttachImageN', { n }),
            kind: 'image',
            payload: pending.payload || `[User attachment ${n}]`,
            dataUrl: preview,
            thumbUrl: preview,
          }
        : null;
      return { file, key, preview, pending, mentionCtx };
    });

    setContexts((prev) => {
      const extra: ComposerContext[] = [];
      for (const item of batch) {
        extra.push(item.pending);
        if (item.mentionCtx) extra.push(item.mentionCtx);
      }
      return [...prev, ...extra];
    });
    if (opts?.mention) {
      queueMicrotask(() => inputRef.current?.focus());
    }

    await Promise.all(
      batch.map(async ({ file, key, preview }) => {
        try {
          const uploaded = await uploadComposerAttachment(file, {
            previewDataUrl: preview,
          });
          setContexts((prev) => {
            if (!prev.some((c) => c.key === key)) {
              if (uploaded.uploadKey) {
                async function purgeOrphanUpload() {
                  try {
                    await deleteUploadedFile(uploaded.uploadKey!);
                  } catch {
                    /* ignore */
                  }
                }
                purgeOrphanUpload();
              }
              return prev;
            }
            return prev.map((c) =>
              c.key === key
                ? {
                    ...c,
                    dataUrl: uploaded.imageRef,
                    thumbUrl: uploaded.previewDataUrl || preview,
                    uploadKey: uploaded.uploadKey || undefined,
                    uploadStatus: 'ready' as const,
                  }
                : c
            );
          });
        } catch {
          setContexts((prev) => prev.filter((c) => c.key !== key));
          message.error(t('agent.uploadFailed', { name: file.name }));
        }
      })
    );
  };

  const onContextsChange = (next: ComposerContext[]) => {
    const removed = contexts.filter((c) => !next.some((n) => n.key === c.key));
    for (const c of removed) {
      if (c.kind === 'attachment' && c.uploadKey) {
        async function deleteRemovedAttachment() {
          try {
            await deleteUploadedFile(c.uploadKey!);
          } catch {
            /* ignore */
          }
        }
        deleteRemovedAttachment();
      }
    }
    setContexts(next);
  };

  const maybeOpenMentionFromAt = (next: string) => {
    const parsed = parseAtMentionQuery(next);
    if (!parsed.open) {
      setMentionPanelOpen(false);
      setMentionQuery('');
      return;
    }
    setModelOpen(false);
    setMentionQuery(parsed.query);
    setMentionPanelOpen(true);
  };

  const mentionItems = useMemo((): MentionAttachItem[] => {
    const attachments = contexts.filter((c) => c.kind === 'attachment');
    return attachments.map((c, i) => ({
      id: c.key,
      label: t('agent.mentionAttachImageN', { n: i + 1 }),
      ...(c.thumbUrl || c.dataUrl
        ? { thumbUrl: String(c.thumbUrl || c.dataUrl) }
        : {}),
    }));
  }, [contexts, t]);

  const pickMentionAttach = (pickId: string) => {
    const attachments = contextsRef.current.filter((c) => c.kind === 'attachment');
    const idx = attachments.findIndex((c) => c.key === pickId);
    if (idx < 0) return;
    const att = attachments[idx]!;
    const n = idx + 1;
    const ctx: ComposerContext = {
      key: `attach-ref:${chipBaseKey(att.key)}`,
      label: t('agent.mentionAttachImageN', { n }),
      kind: 'image',
      payload: att.payload || `[User attachment ${n}]`,
      ...(att.dataUrl ? { dataUrl: att.dataUrl } : {}),
      ...(att.thumbUrl || att.dataUrl
        ? { thumbUrl: String(att.thumbUrl || att.dataUrl) }
        : {}),
    };
    setValue(stripTrailingAtQuery);
    setMentionPanelOpen(false);
    setMentionQuery('');
    queueMicrotask(() => {
      inputRef.current?.insertContextAtCaret(ctx);
      inputRef.current?.focus();
    });
  };

  const mentionFloating = useFloating({
    open: mentionPanelOpen,
    onOpenChange: (open) => {
      setMentionPanelOpen(open);
      if (!open) setMentionQuery('');
    },
    placement: 'bottom-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      flip({ padding: 12, fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] }),
      shift({ padding: 12 }),
    ],
  });
  const mentionDismiss = useDismiss(mentionFloating.context);
  const mentionIx = useInteractions([mentionDismiss]);

  useLayoutEffect(() => {
    if (!mentionPanelOpen) return;
    const editor =
      (document.querySelector('[data-agent-composer]') as HTMLElement | null) || undefined;
    mentionFloating.refs.setPositionReference({
      contextElement: editor,
      getBoundingClientRect: () =>
        inputRef.current?.getAtMentionAnchorRect?.() ??
        editor?.getBoundingClientRect() ??
        new DOMRect(),
    });
    mentionFloating.update();
  }, [mentionPanelOpen, mentionQuery, value, mentionFloating.refs, mentionFloating.update]);

  return (
    <>
      <AgentComposerShell
        className={cn(
          'min-h-[132px] w-full overflow-hidden rounded-2xl border border-white/80 bg-[var(--surface)]',
          'shadow-[0_8px_40px_rgba(51,112,255,0.08),0_2px_16px_rgba(0,0,0,0.04)]',
          'ring-1 ring-black/[0.04]',
          className
        )}
        inputRef={inputRef}
        contexts={contexts}
        onContextsChange={onContextsChange}
        value={value}
        onChange={(next) => {
          setValue(next);
          maybeOpenMentionFromAt(next);
        }}
        onSubmit={handleSubmit}
        placeholder={composerPlaceholder}
        canSend={canSend}
        onAttachFiles={attachFull ? undefined : onAttachFiles}
        attachTooltip={
          attachFull
            ? t('agent.attachMaxReached', { count: attachmentLimit })
            : t('agent.uploadImage')
        }
        sendVariant="circle"
        sendTone="ink"
        showInteractionModePicker={false}
        leadingActions={homeExampleActions}
        interactionMode={interactionMode}
        onInteractionModeChange={(mode) => {
          if (mode === 'image') {
            onCategoryChange?.('image');
            enterImageModeWithModels();
            return;
          }
          if (mode === 'video') {
            onCategoryChange?.('video');
            enterVideoModeWithModels();
            return;
          }
          if (category === 'image' || category === 'video') {
            // Leave Image/Video tab when leaving that mode (restore last design category in parent).
            onCategoryChange?.('poster');
          }
          leaveVideoMode();
          leaveImageMode();
          setInteractionMode(mode);
          setImageModelPanelOpen(false);
          setModelId('auto');
          setModelTab('design');
        }}
        imageModeControls={imageModeControls}
        videoModeControls={videoModeControls}
        {...imageAspectProps}
        modelButtonProps={{
          variant: 'chip',
          label: homeModelChipLabel(modelId, models, t('agent.autoToggle')),
          labelSuffix: t(`agent.designIntensity.${designIntensity}.short`),
          open: modelOpen,
          panelPlacement: 'bottom-end',
          onOpenChange: (next) => {
            if (next) {
              setMentionPanelOpen(false);
              setMentionQuery('');
              setModelTab('design');
              void ensureModelsLoaded();
            }
            setModelOpen(next);
          },
          // Dropdown keeps portal mounted when closed — only mount prefs (catalog/models) when open.
          panel: modelOpen ? (
            <AgentRoutePrefsEditor
              compact
              selectedModelId={modelId}
              autoOnly={!canPickModel}
              onPickModel={(id) => {
                setModelId(id);
                setModelTab('design');
              }}
            />
          ) : (
            <span className="hidden" aria-hidden />
          ),
        }}
      />
      {mentionPanelOpen ? (
        <FloatingPortal>
          <div
            ref={mentionFloating.refs.setFloating}
            style={mentionFloating.floatingStyles as CSSProperties}
            className="z-[80]"
            {...mentionIx.getFloatingProps()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <MentionAttachPanel
              items={mentionItems}
              query={mentionQuery}
              onPick={pickMentionAttach}
            />
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}

export default memo(HomeAgentComposer);
