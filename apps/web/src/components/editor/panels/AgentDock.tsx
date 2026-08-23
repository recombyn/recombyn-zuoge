import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { useParams, useLocation } from 'react-router-dom';
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
import {
  generateImage,
  generateVideo,
  type ChatModelsResponse,
  type LlmModel,
} from '@/service/chat';
import { apiQuery } from '@/service/client';
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
import {
  peekHomeAgentBoot,
  clearHomeAgentBoot,
  attachmentsFromBoot,
  contextsFromBoot,
} from '@/utils/homeAgentBoot';
import {
  setAgentBusy,
  setDocument,
  patchDocumentNode,
  pushEditorHistory,
  startCanvasAttachPick,
  clearCanvasAttachPick,
  consumePendingCanvasAttach,
  consumePendingAgentContexts,
  EMPTY_ID_LIST,
} from '@/store/modules/editor';
import type { RootState } from '@/store';
import { cloneDocument } from '@/store/modules/editorHistory';
import MentionAttachPanel, {
  type MentionAttachItem,
} from '@/components/editor/panels/agent/composer/MentionAttachPanel';
import type { UserAsset } from '@/models/assets';
import { getToken } from '@/utils/token';
import {
  deleteUploadedFile,
  imageSrcToFile,
  readFileAsDataUrl,
  uploadComposerAttachment,
} from '@/utils/uploadImage';
import { message } from '@/components/base';
import {
  chipBaseKey,
  parseAtMentionQuery,
  parseSlashSkillQuery,
  stripTrailingAtQuery,
  stripTrailingSlashQuery,
  buildComposerContext,
  buildAttachRefMentionContext,
  composerAttachmentMediaKind,
  upsertLibraryAssetAttachment,
  type AgentComposerHandle,
  type ComposerContext,
} from '@/components/editor/panels/AgentComposerInput';
import { pauseDesignRun, fetchDesignRunStatus, type DesignSkillCard, type DesignCatalog, type DesignScene } from '@/service/design';
import AgentDockHeader, {
  type AgentEngineMode,
  type CodingCliOption,
} from '@/components/editor/panels/agent/dock/AgentDockHeader';
import AgentDockFloatingPanels from '@/components/editor/panels/agent/dock/AgentDockFloatingPanels';
import {
  applyCanvasAttachPayload,
  canvasAttachToken,
} from '@/components/editor/panels/agent/canvasAttach';
import {
  noteCanvasFlyLand,
  playFlyChipToChat,
  resolveAttachFlyLabel,
  resolveNextFlyOrigin,
} from '@/components/editor/panels/agent/composer/flyToChat';
import {
  buildCodingCliEnrichedPrompt,
  buildCodingCliWorkspaceFiles,
  codingCliApplyFooter,
  listCodingClisDesktop,
  persistCodingCliId,
  persistEngineMode,
  prepareCodingCliWorkspaceDesktop,
  readStoredCodingCliId,
  readStoredEngineMode,
  runCodingCliDesktop,
} from '@/components/editor/panels/agent/codingCli';
import { extractToolOpsFromText } from '@/components/editor/panels/agent/toolOpsContract';
import { useChatSessions } from '@/components/editor/panels/agent/useChatSessions';
import {
  runDesignAgent,
  applyAgentToolOps,
  resolveDesignTargetFrame,
  nodeIdsInsideFrame,
  frameIdContainingNode,
  buildSceneNodesForCanvas,
  buildSceneFramesSnapshot,
  buildSpatialSummary,
  type AgentStepEvent,
} from '@/components/editor/panels/agent/runDesignAgent';
import {
  canAttachNodeToChat
} from '@/components/rcb/scene/document/mediaLifecycle';
import {
  captureVideoPosterFrame
} from '@/components/rcb/scene/document/nodeFactories';
import {
  applyClientFrameHints,
  applyMemoryPatch,
  buildShortTermFromMessages,
  buildTaskStateFromDocument,
  emptyTaskState,
  type MemoryPatch,
  type TaskState,
} from '@/components/editor/panels/agent/agentMemory';
import AgentMessageList from '@/components/editor/panels/agent/messages/AgentMessageList';
import AgentDockComposerFooter from '@/components/editor/panels/agent/dock/AgentDockComposerFooter';
import AgentDockResizeHandle from '@/components/editor/panels/agent/dock/AgentDockResizeHandle';
import {
  type AskChoicePick,
  type ChatUiMessage,
  applyActivityEventToSteps,
  applyAnalysisDeltaToSteps,
  applyThinkingBodyToSteps,
  buildChatProcessSteps,
  formatActivityLabel,
  localizeExploreItem,
  normalizeActivityStatus,
} from '@/components/editor/panels/agent/messages/ChatTurnList';
import type { VirtualListHandle } from '@/components/base/VirtualList';
import AgentComposerShell, {
  type ComposerInteractionMode,
  type ComposerRunMode,
  type ImageModeComposerControls,
  type VideoModeComposerControls,
} from '@/components/editor/panels/agent/composer/AgentComposerShell';
import { normalizeCanvasSizeChip } from '@/components/editor/chrome/SizePresetPanel';
import {
  customProvidersAsModels,
} from '@/components/editor/panels/agent/customLlmProviders';
import { isDesktopLocal, isDesktopShell } from '@/utils/apiBase';
import {
  routeOverridesForApi,
  warmAgentRoutePresetRules,
  warmOpenrouterAvailability,
  loadAgentRoutePrefs,
  loadDesignIntensity,
} from '@/components/editor/panels/agent/agentRoutePrefs';
import { AgentRoutePrefsEditor } from '@/components/editor/panels/agent/models/AgentRoutePrefsEditor';
import { setAllowedCanvasToolKeys } from '@/components/editor/panels/agent/toolOpsContract';
import { type CanvasUiBridge } from '@/components/editor/panels/agent/designTools';
import {
  DEFAULT_IMAGE_ASPECT_RATIO,
  DEFAULT_IMAGE_COUNT,
  DEFAULT_IMAGE_QUALITY,
  DEFAULT_IMAGE_RESOLUTION,
  modelImageLimits,
} from '@/components/editor/panels/agent/shared/ImageAspectRatioPicker';
import ModelPickerPanel, {
  AUTO_MODEL,
  ModelBrandIcon,
  modelDescription,
} from '@/components/editor/panels/agent/models/ModelPickerPanel';
import { cn } from '@/utils/classnames';
import { estimateImageCredits, estimateVideoCredits } from '@/utils/imageCredits';
import { useWalletSnapshot } from '@/service/wallet';
import { FREE_IMAGE_MODEL_ID, planAllowsModelId, planAllowsModelPick } from '@/utils/wallet';
import {
  buildDesignSceneSnapshot,
  buildComposerChipPrompt,
  buildImageGenRequestBody,
  buildImageModeControls,
  buildStreamingAssistantSeed,
  buildVideoAssistantSeed,
  buildVideoModeControls,
  clampComposerImageCount,
  clearAskProposalFields,
  collectSendChipContext,
  firstGeneratedImageUrl,
  firstGeneratedVideoUrl,
  mergeLongSuggestions,
  resolveAskChoiceSend,
  resolveImageGenFinishKind,
  resolveImageGenPlan,
  resolveSendDisplayText,
  shouldRunImageGenPath,
  shouldRunVideoGenPath,
  splitBubbleContexts,
  uniqueVisionUrls,
  askProposalBind,
  findLastAskMessage,
  type DesignSendMutable,
  type ImageGenFinishKind,
} from '@/components/editor/panels/agent/agentSendPath';
import {
  assistantDurationMs,
  createDesignAgentEventRouter,
  humanizeDesignError,
} from '@/components/editor/panels/agent/designAgentEventRouter';

type SetModelFn = (id: string) => void;
type SetComposerModeFn = (mode: ComposerRunMode) => void;
type SetInteractionModeFn = (mode: ComposerInteractionMode) => void;

/** Apply Home/draft model pick into dock composer (respects free-plan lock). */
function applyDraftModelId(opts: {
  draftModelId: string;
  canPickModel: boolean;
  setModel: SetModelFn;
  setComposerMode: SetComposerModeFn;
}) {
  const { draftModelId, canPickModel, setModel, setComposerMode } = opts;
  if (!canPickModel) {
    if (planAllowsModelId('free', draftModelId) && isImageKind({ id: draftModelId })) {
      setModel(cloudImageFallbackId() || 'auto');
      setComposerMode('image');
      return;
    }
    setModel('auto');
    setComposerMode('agent');
    return;
  }
  setModel(draftModelId);
  setComposerMode(isImageKind({ id: draftModelId }) ? 'image' : 'agent');
}

/** Apply Home/draft interaction mode; fill preferred media model when needed. */
function applyDraftInteractionMode(opts: {
  mode: ComposerInteractionMode;
  draftModelId?: string | null;
  canPickModel: boolean;
  planId: string;
  models: LlmModel[];
  setModel: SetModelFn;
  setComposerMode: SetComposerModeFn;
  setInteractionMode: SetInteractionModeFn;
}) {
  const {
    mode,
    draftModelId,
    canPickModel,
    planId,
    models,
    setModel,
    setComposerMode,
    setInteractionMode,
  } = opts;
  const planKey = canPickModel ? planId : 'free';
  const modelAllowed =
    Boolean(draftModelId) && planAllowsModelId(planKey, String(draftModelId));

  if (mode === 'image') {
    setInteractionMode('image');
    setComposerMode('image');
    if (!modelAllowed) {
      setModel(pickPreferredImageModelId(models) || cloudImageFallbackId());
    }
    return;
  }
  if (mode === 'video') {
    setInteractionMode('video');
    setComposerMode('video');
    if (!modelAllowed) {
      setModel(pickPreferredVideoModelId(models) || cloudVideoFallbackId());
    }
    return;
  }
  if (mode === 'ask') {
    setInteractionMode('agent');
    setComposerMode('agent');
    return;
  }
  if (mode === 'agent') {
    setInteractionMode('agent');
    setComposerMode('agent');
  }
}

function applyBootInteractionMode(
  mode: string | undefined,
  setInteractionMode: SetInteractionModeFn,
  setComposerMode: SetComposerModeFn
) {
  if (mode === 'agent') {
    setInteractionMode('agent');
    setComposerMode('agent');
    return;
  }
  if (mode === 'ask') {
    setInteractionMode('agent');
    setComposerMode('agent');
    return;
  }
  if (mode === 'image') {
    setInteractionMode('image');
    setComposerMode('image');
    return;
  }
  if (mode === 'video') {
    setInteractionMode('video');
    setComposerMode('video');
  }
}

function composerModeForModelId(modelId: string): ComposerRunMode {
  if (isImageKind({ id: modelId })) return 'image';
  if (isVideoKind({ id: modelId })) return 'video';
  return 'agent';
}

type ChatSessionMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  contexts?: ChatUiMessage['contexts'];
  contentMarked?: string;
  thinking?: string;
  durationMs?: number;
  intent?: string;
  steps?: ChatUiMessage['steps'];
  images?: string[];
  videos?: string[];
  imageModelId?: string;
  imageModelLabel?: string;
  imageAspectRatio?: string;
  designTaskId?: string;
  canResume?: boolean;
  proposedOps?: ChatUiMessage['proposedOps'];
  proposalId?: string;
  choiceUi?: ChatUiMessage['choiceUi'];
};

type ChatSession = {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatSessionMessage[];
  taskState?: TaskState | null;
};

const MAX_CHAT_SESSIONS = 40;

/** Model id sent to /design/run (plan gate → auto; custom BYOK kept). */
function resolveAgentSendModel(canPickModel: boolean, model: string): string {
  if (!canPickModel) return 'auto';
  return model || 'auto';
}

/** Auto uses route prefs; locked / BYOK custom pins all tiers+vision. */
function resolveAgentRouteOverrides(
  canPickModel: boolean,
  model: string
): Record<string, string> | null {
  if (!canPickModel) return null;
  if (!model || model === 'auto') {
    return routeOverridesForApi();
  }
  // 锁模 / BYOK：本用户本轮 fast/standard/reasoning/vision 都用同一模型
  return {
    fast: model,
    standard: model,
    reasoning: model,
    vision: model,
  };
}

function resolveUserContentMarked(opts: {
  markedFromDom: string;
  displayContextsLen: number;
  userFacing: string;
}): string | undefined {
  if (opts.markedFromDom.includes('\uFFFC')) return opts.markedFromDom;
  if (opts.displayContextsLen > 0) {
    return `${'\uFFFC'.repeat(opts.displayContextsLen)}${opts.userFacing}`;
  }
  return undefined;
}

/** Make chip / canvas image URLs safe for remote vision APIs (data URL or public https). */
async function resolveVisionImageUrl(src: string): Promise<string | null> {
  const s = String(src || '').trim();
  if (!s) return null;
  if (s.startsWith('data:image/')) return s;
  const needsAuthFetch =
    s.startsWith('/') ||
    s.includes('/api/v1/uploads/') ||
    (!s.startsWith('http://') && !s.startsWith('https://'));
  if (needsAuthFetch || s.startsWith('http://') || s.startsWith('https://')) {
    try {
      // Auth-relative upload URLs cannot be fetched by the vision provider — inline bytes.
      if (
        s.startsWith('/') ||
        s.includes('/api/v1/uploads/') ||
        s.startsWith('blob:')
      ) {
        const file = await imageSrcToFile(s, 'vision.png');
        return await readFileAsDataUrl(file);
      }
      return s;
    } catch {
      return s.startsWith('http://') || s.startsWith('https://') ? s : null;
    }
  }
  return null;
}

function resolveComposerPlaceholder(
  t: (key: string, opts?: Record<string, unknown>) => string,
  opts: {
    isImageModel: boolean;
    isImageMode?: boolean;
    isVideoMode?: boolean;
    hasContextChips: boolean;
    askPlaceholder?: string | null;
  }
): string {
  if (opts.isVideoMode) return t('editor.tools.videoGenPlaceholder');
  if (opts.isImageMode) return t('editor.tools.imageGenPlaceholder');
  if (opts.isImageModel) return t('agent.placeholderImage');
  if (opts.askPlaceholder?.trim()) return opts.askPlaceholder.trim();
  if (opts.hasContextChips) return t('agent.placeholderSkill');
  return t('agent.placeholderDefault');
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

const DETAIL_SUMMARY_KINDS = new Set([
  'tool',
  'skipped',
  'added',
  'updated',
  'deleted',
]);
const SUCCESS_VARIANT_KINDS = new Set(['added', 'updated', 'deleted']);
const CONFIRM_VARIANT_KINDS = new Set(['thought', 'explored', 'tool']);
const DEFAULT_INTERACTION_MODES: ComposerInteractionMode[] = ['agent', 'image', 'video'];

type FinishAssistant = (
  m: ChatUiMessage,
  patch?: Partial<ChatUiMessage>
) => ChatUiMessage;

type AgentDockProps = {
  open: boolean;
  /**
   * Bump when the user opens the dock (click / shortcut / home boot).
   * Hydrates catalog+models without `useEffect([open])` refetch on every reopen.
   */
  openSignal?: number;
  onClose: () => void;
  className?: string;
  floating?: boolean;
  allowedInteractionModes?: ComposerInteractionMode[];
  draftPrompt?: string | null;
  /** When true with draftPrompt, auto-send after models are ready (home → editor). */
  autoSubmitDraft?: boolean;
  /**
   * Hold home-agent auto-send (boot overlay / first-run tour still open).
   * Prompt stays queued in the composer until this clears.
   */
  holdAutoSubmit?: boolean;
  onDraftConsumed?: () => void;
  draftAttachments?: ComposerContext[];
  /** Home → editor: inline skill / context pills (e.g. plaza 「做同款」). */
  draftContexts?: ComposerContext[];
  /** Home → editor: preferred model + Seedream settings. */
  draftModelId?: string | null;
  /** Home → editor: Agent / Ask mode. */
  draftInteractionMode?: ComposerInteractionMode | null;
  draftImageAspectRatio?: string | null;
  /** Home → editor: product category scene (website / mobile / image / poster). */
  draftScene?: DesignScene | null;
  /** Right-click 銆屾坊鍔犲埌 Chat銆嶁€?node id, `frame:id`, or multiple ids as one 缁凬 chip. */
  attachToChat?: string | string[] | null;
  onAttachConsumed?: () => void;
  /** Onboarding spotlight target id (`data-tour`). */
  dataTour?: string;
  /** Editor chrome bridge for zoom / panels / agent mode tools. */
  canvasUi?: CanvasUiBridge | null;
  /** Mobile floating mode: document title shown in the top bar. */
  projectName?: string;
  /** Mobile floating mode: navigate back to home. */
  onGoHome?: () => void;
};

const DEFAULT_VIDEO_ASPECT_RATIO = '16:9';
const DEFAULT_VIDEO_RESOLUTION = '720p';
const DEFAULT_VIDEO_DURATION = 5;

/** Merge catalog + imageModels + videoModels; normalize kind. */
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
    withMaxAttachments: true,
  });
}

/**
 * Canvas → composer:
 * - single image / video → attachment strip (not inline input chip)
 * - multi: videos/images attach as media; remaining shapes → one PNG (not one giant raster of video)
 * - single shape / frame → context chip with thumb
 */
const AGENT_DOCK_WIDTH_KEY = 'agent-dock-width';
const AGENT_DOCK_MIN_W = 340;
const AGENT_DOCK_MAX_W = 560;
const AGENT_DOCK_DEFAULT_W = 360;

function clampAgentDockWidth(width: number): number {
  let viewportCap = AGENT_DOCK_MAX_W;
  if (typeof window !== 'undefined') {
    viewportCap = Math.max(AGENT_DOCK_MIN_W, window.innerWidth - 360);
  }
  return Math.min(
    AGENT_DOCK_MAX_W,
    viewportCap,
    Math.max(AGENT_DOCK_MIN_W, Math.round(width))
  );
}

function readStoredAgentDockWidth(): number {
  try {
    const raw = localStorage.getItem(AGENT_DOCK_WIDTH_KEY);
    if (!raw) return AGENT_DOCK_DEFAULT_W;
    const n = Number(raw);
    if (!Number.isFinite(n)) return AGENT_DOCK_DEFAULT_W;
    return clampAgentDockWidth(n);
  } catch {
    return AGENT_DOCK_DEFAULT_W;
  }
}

function mentionAttachKindLabel(
  kind: 'image' | 'video' | 'audio',
  n: number,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  if (kind === 'video') return t('agent.mentionAttachVideoN', { n });
  if (kind === 'audio') return t('agent.mentionAttachAudioN', { n });
  return t('agent.mentionAttachImageN', { n });
}

function normalizeMediaAssetKind(kind: string): 'image' | 'video' | 'audio' {
  if (kind === 'video' || kind === 'audio' || kind === 'image') return kind;
  return 'image';
}

function mediaAssetKindFallbackLabel(
  kind: 'image' | 'video' | 'audio',
  t: (key: string) => string
): string {
  if (kind === 'video') return t('me.assetKindVideo');
  if (kind === 'audio') return t('me.assetKindAudio');
  return t('me.assetKindImage');
}

function mentionAttachRefPayload(kind: 'image' | 'video' | 'audio', ordinal: number): string {
  if (kind === 'video') return `[Ref: Attached video ${ordinal}]`;
  if (kind === 'audio') return `[Ref: Attached audio ${ordinal}]`;
  return `[Ref: Attached image ${ordinal}]`;
}

function modelButtonLabel(
  modelId: string,
  selected: LlmModel | undefined,
  fallbackLabel: string,
  t: (key: string) => string
): string {
  return modelId === 'auto' ? t('agent.autoToggle') : selected?.label || fallbackLabel;
}

function composerSendDisabledReason(opts: {
  t: (key: string) => string;
  attachmentsUploading: boolean;
  hasContent: boolean;
  available: boolean | null;
  modelsStatus: string;
}): string | undefined {
  const { t, attachmentsUploading, hasContent, available, modelsStatus } = opts;
  if (attachmentsUploading) return t('agent.attachWaitUpload');
  if (!hasContent) return t('agent.sendNeedContent');
  if (available !== false) return undefined;
  if (modelsStatus === 'error') return t('agent.modelsLoadFailed');
  return t('agent.modelsUnavailable');
}

type SavedComposerChip = {
  key: string;
  label: string;
  kind: string;
  thumbUrl?: string;
};

/** Rebuild a live chip from frame:/node:/group: key against the current document. */
function resolveComposerContextFromChipBase(
  document: Parameters<typeof buildComposerContext>[0],
  base: string,
  existing: ComposerContext[]
): ComposerContext | null {
  if (base.startsWith('frame:')) {
    return buildComposerContext(document, [], base.slice('frame:'.length), existing);
  }
  if (base.startsWith('node:')) {
    return buildComposerContext(document, [base.slice('node:'.length)], null, existing);
  }
  if (!base.startsWith('group:')) return null;
  const ids = base
    .slice('group:'.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return buildComposerContext(document, ids, null, existing);
}

/** Keep prior chip preview when rebuild has no image src (shapes / groups). */
function withPreservedChipThumb(
  ctx: ComposerContext,
  priorThumbUrl: string | undefined
): ComposerContext {
  if (!priorThumbUrl || ctx.thumbUrl) return ctx;
  return { ...ctx, thumbUrl: priorThumbUrl };
}

function rebuildComposerChipFromSaved(
  document: Parameters<typeof buildComposerContext>[0],
  saved: SavedComposerChip,
  existing: ComposerContext[]
): ComposerContext {
  const ctx = resolveComposerContextFromChipBase(
    document,
    chipBaseKey(saved.key),
    existing
  );
  if (!ctx) {
    return {
      key: saved.key,
      label: saved.label,
      kind: saved.kind,
      payload: '',
      ...(saved.thumbUrl ? { thumbUrl: saved.thumbUrl } : {}),
    };
  }
  return withPreservedChipThumb(ctx, saved.thumbUrl);
}

/** Agent panel: chat + model picker + Agent input. */
function AgentDock({
  open,
  openSignal = 0,
  onClose,
  className,
  floating = false,
  allowedInteractionModes,
  draftPrompt,
  autoSubmitDraft = false,
  holdAutoSubmit = false,
  onDraftConsumed,
  draftAttachments,
  draftContexts,
  draftModelId,
  draftInteractionMode,
  draftImageAspectRatio,
  draftScene,
  attachToChat,
  onAttachConsumed,
  dataTour,
  canvasUi: canvasUiProp,
  projectName,
  onGoHome,
}: AgentDockProps): ReactNode {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const document = useSelector((s: RootState) => s.editor.document);
  const activeFrameId = useSelector(
    (s: RootState) => (s.editor.document?.activeFrameId as string | null) ?? null
  );
  const { planId } = useWalletSnapshot();
  const canPickModel = planAllowsModelPick(planId);

  const [models, setModels] = useState<LlmModel[]>([]);
  const [modelsStatus, setModelsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [model, setModel] = useState('auto');
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
  const [imageAspectRatio, setImageAspectRatio] = useState<string>('auto');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const desktopShell = isDesktopShell();
  const [engineMode, setEngineMode] = useState<AgentEngineMode>(() =>
    desktopShell ? readStoredEngineMode() : 'agent'
  );
  const [codingClis, setCodingClis] = useState<CodingCliOption[]>([]);
  const [codingCliId, setCodingCliId] = useState(() =>
    desktopShell ? readStoredCodingCliId() : ''
  );
  /** @ / cube → model panel */
  const [modelPanelOpen, setModelPanelOpen] = useState(false);
  const [mentionPanelOpen, setMentionPanelOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [skillPanelOpen, setSkillPanelOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const [skillCatalog, setSkillCatalog] = useState<DesignSkillCard[]>([]);
  /** Context chips in the composer (right-click 添加到 Chat + file attachments). */
  const [contextChips, setContextChips] = useState<ComposerContext[]>([]);
  const contextChipsRef = useRef<ComposerContext[]>([]);
  contextChipsRef.current = contextChips;
  const pinnedContextKeysRef = useRef<Set<string>>(new Set());
  const contextDismissedKeyRef = useRef<string | null>(null);
  /** Dedup canvas鈫抍omposer applies (React StrictMode runs effects twice). */
  const attachToChatLockRef = useRef<string | null>(null);
  const pendingCanvasAttachLockRef = useRef<string | null>(null);
  const onlyImageInteraction =
    allowedInteractionModes?.length === 1 && allowedInteractionModes[0] === 'image';
  const [historyOpen, setHistoryOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerRunMode>(
    onlyImageInteraction ? 'image' : 'agent'
  );
  /** Agent / Ask / Image — mode switch in the composer toolbar. */
  const [interactionMode, setInteractionMode] = useState<ComposerInteractionMode>(
    onlyImageInteraction ? 'image' : 'agent'
  );
  /** Image-mode gen settings (mirrors ImageGeneratorCard). */
  const [imageResolution, setImageResolution] = useState(DEFAULT_IMAGE_RESOLUTION);
  const [imageGenAspectRatio, setImageGenAspectRatio] = useState(DEFAULT_IMAGE_ASPECT_RATIO);
  const [imageGenCountSetting, setImageGenCountSetting] = useState(DEFAULT_IMAGE_COUNT);
  const [imageModelPanelOpen, setImageModelPanelOpen] = useState(false);
  const [videoResolution, setVideoResolution] = useState(DEFAULT_VIDEO_RESOLUTION);
  const [videoGenAspectRatio, setVideoGenAspectRatio] = useState(DEFAULT_VIDEO_ASPECT_RATIO);
  const [videoGenDuration, setVideoGenDuration] = useState(DEFAULT_VIDEO_DURATION);
  const [videoModelPanelOpen, setVideoModelPanelOpen] = useState(false);
  const [styleGroupId, setStyleGroupId] = useState<number | null>(null);
  const [designScene, setDesignScene] = useState<DesignScene | null>(null);
  const designSceneRef = useRef<DesignScene | null>(null);
  /** Last design SVG per artboard — sent back on edit-in-place follow-ups. */
  const lastAgentSvgByFrameRef = useRef<Map<string, string>>(new Map());
  const lastAgentFrameIdRef = useRef<string | null>(null);
  const [designCatalog, setDesignCatalog] = useState<DesignCatalog | null>(null);
  const canvasUi = canvasUiProp || null;
  const [newChatTip, setNewChatTip] = useState(false);
  /** Edit a past user message in-place. */
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  // First paint must use stored width — a later setState(360→stored) reflows the stage.
  const [dockWidth, setDockWidth] = useState(readStoredAgentDockWidth);
  const resizeDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const currentId = useSelector((s: RootState) => s.editor.currentId as string | null);
  const canvasAttachPick = useSelector(
    (s: RootState) => s.editor.canvasAttachPick as null | { target: string }
  );
  const pickingFromCanvas = canvasAttachPick?.target === 'agent';
  const selectedNodeIds = useSelector(
    (s: RootState) => (s.editor.selectedNodeIds as string[]) ?? EMPTY_ID_LIST
  );
  const selectedFrameIds = useSelector(
    (s: RootState) => (s.editor.selectedFrameIds as string[]) ?? EMPTY_ID_LIST
  );
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>();
  const location = useLocation();
  // Prefer Redux; fall back to /editor/:projectId so we don't hit projectId=__none__ while hydrating.
  const chatScopeId =
    (currentId || '').trim() || decodeURIComponent((routeProjectId || '').trim()) || null;
  const {
    sessions,
    sessionId,
    messages,
    setMessages,
    chatTitle,
    startNewChat: resetChatSession,
    openSession: loadChatSession,
    deleteSession: removeChatSession,
    refreshSessions,
    formatChatTime,
    newMessageId,
    taskState,
    setTaskState,
    pendingLongSuggestions,
    setPendingLongSuggestions,
  } = useChatSessions(chatScopeId);
  const listRef = useRef<VirtualListHandle | null>(null);
  const inputRef = useRef<AgentComposerHandle | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const liveDesignTaskRef = useRef<string | null>(null);
  const pauseRequestedRef = useRef(false);
  /** True when the in-flight turn actually started design / canvas work. */
  const liveTurnWorkRef = useRef<{ designStarted: boolean; canvasMutated: boolean } | null>(
    null
  );
  /** Avoid re-entrant auto-resume for the same session+task. */
  const autoResumeKeyRef = useRef<string | null>(null);
  /** Home → editor auto-send; flushed when modelsStatus leaves idle/loading. */
  const pendingAutoSubmitRef = useRef<string | null>(null);
  /** Pre-command document snapshots keyed by user message id. In-memory only. */
  const checkpointsRef = useRef<Map<string, any>>(new Map());
  /** After agent mutates canvas: show Undo / Keep / Review above composer. */
  const [pendingReview, setPendingReview] = useState<{
    userMessageId: string;
    assistantId: string;
  } | null>(null);
  const newChatTipTimer = useRef<number | null>(null);
  const enabledInteractionModes = useMemo(
    () =>
      allowedInteractionModes && allowedInteractionModes.length
        ? allowedInteractionModes
        : DEFAULT_INTERACTION_MODES,
    [allowedInteractionModes]
  );

  useEffect(() => {
    const fid = taskState?.canvas?.last_agent_frame_id;
    if (fid) lastAgentFrameIdRef.current = String(fid);
  }, [sessionId, taskState?.canvas?.last_agent_frame_id]);

  const codingClisInflightRef = useRef<Promise<CodingCliOption[]> | null>(null);
  const lastHydrateSignalRef = useRef(0);
  const modelsUnavailableWarnRef = useRef(false);
  const modelsErrToastRef = useRef(false);
  const onDraftConsumedRef = useRef(onDraftConsumed);
  onDraftConsumedRef.current = onDraftConsumed;
  const draftConsumeKeyRef = useRef<string | null>(null);
  const [skillsWanted, setSkillsWanted] = useState(false);

  const modelsQuery = useQuery({
    ...apiQuery.chatGetModels.queryOptions(),
    staleTime: 60_000,
    enabled: open,
    // API often flaps on WatchFiles reload — keep retrying so Send does not stay dead.
    refetchOnWindowFocus: true,
    refetchInterval: (q) => (q.state.status === 'error' ? 5_000 : false),
    retry: 2,
  });

  const designCatalogQuery = useQuery({
    ...apiQuery.designDesignCatalog.queryOptions(),
    staleTime: 60_000,
    enabled: open,
  });

  const skillsQuery = useQuery({
    ...apiQuery.designDesignSkillsPicker.queryOptions({
      input: { query: {} },
    }),
    staleTime: 60_000,
    enabled: open && skillsWanted,
  });

  useEffect(() => {
    if (!open) return;
    if (modelsQuery.isPending) {
      setModelsStatus('loading');
      return;
    }
    if (modelsQuery.isError) {
      setModels([]);
      setModelsStatus('error');
      setAvailable(false);
      if (!modelsErrToastRef.current) {
        modelsErrToastRef.current = true;
        const err = modelsQuery.error;
        message.error(
          (err instanceof Error && err.message) ||
            '无法加载模型列表。请先启动后端：npm run dev:api（端口 8000）'
        );
      }
      return;
    }
    if (!modelsQuery.isFetched) return;
    const res = modelsQuery.data as ChatModelsResponse | undefined;
    if (!res) {
      setModels([]);
      setModelsStatus('error');
      setAvailable(false);
      return;
    }
    modelsErrToastRef.current = false;
    warmOpenrouterAvailability(res.openrouterAvailable);
    const list = normalizeModelList(res.models, res.imageModels, res.videoModels);
    setModels(list);
    setModelsStatus('ready');
    setAvailable(Boolean(res.available));
    setModel((prev) => {
      if (!canPickModel) return planAllowsModelId('free', prev) ? prev : 'auto';
      if (prev === 'auto') return prev;
      if (prev && list.some((m) => m.id === prev)) return prev;
      return 'auto';
    });
    if (!res.available && !modelsUnavailableWarnRef.current) {
      modelsUnavailableWarnRef.current = true;
      message.warning(
        '未配置 API Key。请在 apps/api/.env 中设置 DEEPSEEK_API_KEY 或 LLM_API_KEY。'
      );
    }
  }, [
    open,
    modelsQuery.data,
    modelsQuery.isPending,
    modelsQuery.isError,
    modelsQuery.isFetched,
    modelsQuery.error,
    canPickModel,
  ]);

  useEffect(() => {
    if (!open) return;
    const cat = designCatalogQuery.data as DesignCatalog | undefined;
    if (!cat) return;
    setDesignCatalog(cat);
    warmAgentRoutePresetRules(cat.global_rules);
    const keys = (cat.canvas_tools || []).map((t) => t.op_key).filter(Boolean);
    if (keys.length) setAllowedCanvasToolKeys(keys);
    setStyleGroupId((prev) => prev ?? cat.style_groups?.[0]?.id ?? null);
  }, [open, designCatalogQuery.data]);

  useEffect(() => {
    if (!skillsWanted || !skillsQuery.isFetched) return;
    if (skillsQuery.isError) {
      setSkillCatalog([]);
      return;
    }
    const items =
      ((skillsQuery.data as { items?: DesignSkillCard[] } | undefined)?.items || []);
    setSkillCatalog(items);
  }, [skillsWanted, skillsQuery.data, skillsQuery.isFetched, skillsQuery.isError]);

  const loadSkillCatalog = () => {
    setSkillsWanted(true);
  };

  const ensureCodingClisLoaded = async (): Promise<CodingCliOption[]> => {
    if (!desktopShell) return [];
    if (codingClis.length) return codingClis;
    if (codingClisInflightRef.current) return codingClisInflightRef.current;
    async function loadCodingClis(): Promise<CodingCliOption[]> {
      try {
        const rows = await listCodingClisDesktop();
        const anyAvailable = rows.some((r) => r.available);
        setCodingClis(rows);
        if (!anyAvailable) {
          setEngineMode('agent');
          persistEngineMode('agent');
          setCodingCliId('');
        } else {
          setCodingCliId((prev) => {
            if (prev && rows.some((r) => r.id === prev && r.available)) return prev;
            const next = rows.find((c) => c.available)?.id || '';
            if (next) persistCodingCliId(next);
            return next;
          });
        }
        return rows;
      } catch {
        setCodingClis([]);
        setEngineMode('agent');
        persistEngineMode('agent');
        setCodingCliId('');
        return [] as CodingCliOption[];
      } finally {
        codingClisInflightRef.current = null;
      }
    }
    const pending = loadCodingClis();
    codingClisInflightRef.current = pending;
    return pending;
  };

  const hydrateDockData = () => {
    ensureCodingClisLoaded();
  };

  useEffect(() => {
    const onWinResize = () => setDockWidth((w) => clampAgentDockWidth(w));
    window.addEventListener('resize', onWinResize);
    return () => window.removeEventListener('resize', onWinResize);
  }, []);

  useEffect(
    () => () => {
      // `document` is shadowed by the scene document from Redux.
      window.document.body.style.cursor = '';
      window.document.body.style.userSelect = '';
    },
    []
  );

  const persistDockWidth = (width: number) => {
    const next = clampAgentDockWidth(width);
    setDockWidth(next);
    try {
      localStorage.setItem(AGENT_DOCK_WIDTH_KEY, String(next));
    } catch {
      /* ignore */
    }
  };

  const onDockResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeDragRef.current = { startX: e.clientX, startW: dockWidth };
    window.document.body.style.cursor = 'col-resize';
    window.document.body.style.userSelect = 'none';
  };

  const onDockResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    // Left edge: drag left → wider
    setDockWidth(clampAgentDockWidth(drag.startW + (drag.startX - e.clientX)));
  };

  const endDockResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeDragRef.current) return;
    resizeDragRef.current = null;
    window.document.body.style.cursor = '';
    window.document.body.style.userSelect = '';
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setDockWidth((w) => {
      try {
        localStorage.setItem(AGENT_DOCK_WIDTH_KEY, String(w));
      } catch {
        /* ignore */
      }
      return w;
    });
  };

  // UI-only when dock hides — do not fetch here.
  useEffect(() => {
    if (!open) setModelPanelOpen(false);
  }, [open]);

  // openSignal bumped by EditorPage on first enter + each open click / shortcut.
  useEffect(() => {
    if (!open || openSignal < 1) return;
    if (lastHydrateSignalRef.current === openSignal) return;
    lastHydrateSignalRef.current = openSignal;
    setModelPanelOpen(false);
    hydrateDockData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signal-driven hydrate; loaders short-circuit when ready
  }, [open, openSignal]);

  useEffect(() => {
    if (canPickModel) return;
    setModel((prev) => {
      if (prev === FREE_IMAGE_MODEL_ID) {
        setComposerMode('image');
        return prev;
      }
      setComposerMode('agent');
      setInteractionMode('agent');
      return 'auto';
    });
  }, [canPickModel]);

  useEffect(() => {
    if (!open || draftPrompt == null) {
      if (draftPrompt == null) draftConsumeKeyRef.current = null;
      return;
    }
    // One-shot per draft payload — parent `onDraftConsumed` identity must not re-fire.
    const consumeKey = [
      draftPrompt,
      autoSubmitDraft ? '1' : '0',
      draftModelId || '',
      draftInteractionMode || '',
      draftImageAspectRatio || '',
      draftScene || '',
      String((draftAttachments || []).length),
      String((draftContexts || []).length),
    ].join('\0');
    if (draftConsumeKeyRef.current === consumeKey) return;
    draftConsumeKeyRef.current = consumeKey;
    const text = draftPrompt;
    const shouldAuto = autoSubmitDraft;
    const inlineDraft = draftContexts || [];
    const attachmentDraft = draftAttachments || [];
    // Attachments live in React state (square strip). Inline skills use insertContextAtCaret
    // only — same as 「添加到 Chat」— so we do not double-add via setContextChips.
    if (attachmentDraft.length) {
      setContextChips((prev) => {
        const keys = new Set(prev.map((c) => c.key));
        const merged = [...prev];
        for (const a of attachmentDraft) {
          if (!keys.has(a.key)) merged.push(a);
        }
        return merged;
      });
    }
    if (inlineDraft.length) {
      queueMicrotask(() => {
        for (const ctx of inlineDraft) {
          inputRef.current?.insertContextAtCaret(ctx);
        }
      });
    }
    if (draftModelId) {
      applyDraftModelId({
        draftModelId,
        canPickModel,
        setModel,
        setComposerMode,
      });
    }
    if (draftInteractionMode) {
      applyDraftInteractionMode({
        mode: draftInteractionMode,
        draftModelId,
        canPickModel,
        planId,
        models,
        setModel,
        setComposerMode,
        setInteractionMode,
      });
    }
    if (draftImageAspectRatio) {
      setImageAspectRatio(draftImageAspectRatio);
      // Home Image chat passes gen aspect here — seed the image-mode picker too.
      if (draftInteractionMode === 'image') {
        setImageGenAspectRatio(draftImageAspectRatio as typeof imageGenAspectRatio);
      }
      if (draftInteractionMode === 'video') {
        setVideoGenAspectRatio(draftImageAspectRatio);
      }
    }
    if (draftScene) {
      setDesignScene(draftScene);
      designSceneRef.current = draftScene;
    }
    onDraftConsumedRef.current?.();
    if (shouldAuto && text.trim()) {
      // Queue only — do not close over modelsStatus/send (stale interval never fires).
      pendingAutoSubmitRef.current = text;
      // Show in composer immediately so a failed/late send still leaves the prompt visible.
      setInput(text);
    } else {
      setInput(text);
      queueMicrotask(() => inputRef.current?.focus());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot draft consume; callback via ref
  }, [open, draftPrompt, autoSubmitDraft]);

  /** Fallback: home boot still in sessionStorage but parent never passed draftPrompt (route remount). */
  useEffect(() => {
    if (!open) return;
    // Wait until createNew finished — otherwise chat lands on the previous project scope.
    if (new URLSearchParams(location.search).get('createNew') === '1') return;
    if (draftPrompt != null) return;
    if (pendingAutoSubmitRef.current) return;
    const boot = peekHomeAgentBoot();
    if (!boot) return;
    const text = String(boot.prompt || '').trim();
    const inline = contextsFromBoot(boot);
    const attachments = attachmentsFromBoot(boot);
    if (!text && !inline.length && !attachments.length) return;
    if (attachments.length) {
      setContextChips((prev) => {
        const keys = new Set(prev.map((c) => c.key));
        return [...prev, ...attachments.filter((a) => !keys.has(a.key))];
      });
    }
    if (inline.length) {
      queueMicrotask(() => {
        for (const ctx of inline) {
          inputRef.current?.insertContextAtCaret(ctx);
        }
      });
    }
    if (boot.modelId) {
      setModel(boot.modelId);
      setComposerMode(composerModeForModelId(boot.modelId));
    }
    applyBootInteractionMode(boot.interactionMode, setInteractionMode, setComposerMode);
    // Design agent is always Smart (auto) — never import home category stock WxH
    // (e.g. website 1440×900) as CLIENT_SIZE_LOCK; LLM must pick create_frame size.
    const bootMode = String(boot.interactionMode || '').trim().toLowerCase();
    if (bootMode === 'image' || bootMode === 'video') {
      if (boot.imageAspectRatio) setImageAspectRatio(boot.imageAspectRatio);
    } else {
      setImageAspectRatio('auto');
    }
    if (boot.scene) {
      setDesignScene(boot.scene);
      designSceneRef.current = boot.scene;
    }
    if (boot.autoSubmit && text) {
      pendingAutoSubmitRef.current = text;
      setInput(text);
    } else {
      setInput(text);
      queueMicrotask(() => inputRef.current?.focus());
    }
    clearHomeAgentBoot();
  }, [open, draftPrompt, location.search]);

  /** Mark tool selections → insert @ chips into the composer. */
  const pendingAgentContexts = useSelector(
    (s: RootState) =>
      (s.editor.pendingAgentContexts || []) as Array<{
        key: string;
        label: string;
        kind: string;
        payload: string;
        dataUrl?: string;
        thumbUrl?: string;
      }>
  );
  const pendingAgentContextsLockRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !pendingAgentContexts.length) {
      if (!pendingAgentContexts.length) pendingAgentContextsLockRef.current = null;
      return;
    }
    const token = pendingAgentContexts.map((c) => c.key).join('|');
    if (pendingAgentContextsLockRef.current === token) {
      dispatch(consumePendingAgentContexts());
      return;
    }
    pendingAgentContextsLockRef.current = token;
    const list = pendingAgentContexts.slice();
    dispatch(consumePendingAgentContexts());
    queueMicrotask(() => {
      for (const ctx of list) {
        pinnedContextKeysRef.current.add(ctx.key);
        contextDismissedKeyRef.current = null;
        inputRef.current?.insertContextAtCaret(ctx);
      }
      inputRef.current?.focusEnd();
    });
  }, [open, pendingAgentContexts, dispatch]);

  useEffect(() => {
    listRef.current?.scrollToBottom();
  }, [messages, open, historyOpen]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const showAlreadyNewTip = () => {
    setNewChatTip(true);
    if (newChatTipTimer.current) window.clearTimeout(newChatTipTimer.current);
    newChatTipTimer.current = window.setTimeout(() => {
      setNewChatTip(false);
      newChatTipTimer.current = null;
    }, 1800);
  };

  const startNewChat = () => {
    if (messages.length === 0 && !historyOpen) {
      showAlreadyNewTip();
      return;
    }
    abortRef.current?.abort();
    setSending(false);
    dispatch(setAgentBusy(false));
    resetChatSession();
    setInput('');
    setEditDraft('');
    setEditingUserId(null);
    setContextChips([]);
    pinnedContextKeysRef.current.clear();
    setPendingReview(null);
    contextDismissedKeyRef.current = null;
    setHistoryOpen(false);
    setModelPanelOpen(false);
    setMentionPanelOpen(false);
    setMentionQuery('');
  };

  const handleSessionControl = (action: string) => {
    if (action === 'clear_context') {
      abortRef.current?.abort();
      setSending(false);
      dispatch(setAgentBusy(false));
      // Keep the intent-LLM reply that just streamed; drop the rest of the thread.
      window.setTimeout(() => {
        let tip = '';
        setMessages((prev) => {
          tip = String(
            [...prev].reverse().find((m) => m.role === 'assistant')?.content || ''
          ).trim();
          return prev;
        });
        resetChatSession();
        setInput('');
        setEditDraft('');
        setEditingUserId(null);
        setContextChips([]);
        pinnedContextKeysRef.current.clear();
        setPendingReview(null);
        contextDismissedKeyRef.current = null;
        setHistoryOpen(false);
        setModelPanelOpen(false);
        setMentionPanelOpen(false);
        setMentionQuery('');
        if (tip) {
          setMessages([
            {
              id: `sess-clear-${Date.now()}`,
              role: 'assistant',
              content: tip,
            },
          ]);
        }
      }, 80);
      return;
    }
    if (action === 'stop') {
      abortRef.current?.abort();
      setSending(false);
      dispatch(setAgentBusy(false));
    }
  };

  useEffect(
    () => () => {
      if (newChatTipTimer.current) window.clearTimeout(newChatTipTimer.current);
    },
    []
  );

  const openSession = (s: ChatSession) => {
    abortRef.current?.abort();
    dispatch(setAgentBusy(false));
    setSending(false);
    loadChatSession(s.id);
    setHistoryOpen(false);
    setInput('');
    setEditDraft('');
    setEditingUserId(null);
    setPendingReview(null);
  };

  const deleteSession = (id: string) => {
    removeChatSession(id);
    if (id === sessionId) {
      abortRef.current?.abort();
      setSending(false);
      setInput('');
      setEditDraft('');
      setEditingUserId(null);
      setPendingReview(null);
      setHistoryOpen(false);
    }
  };


  const formatAgentDuration = useCallback(
    (totalSeconds: number) => {
      const s = Math.max(1, totalSeconds);
      const lang = i18n.language || 'en';
      if (s < 60) {
        if (lang.startsWith('zh')) return `${s} 秒`;
        if (lang.startsWith('ja')) return `${s}秒`;
        return `${s}s`;
      }
      const m = Math.floor(s / 60);
      const r = s % 60;
      if (lang.startsWith('zh')) return r ? `${m} 分 ${r} 秒` : `${m} 分`;
      if (lang.startsWith('ja')) return r ? `${m} 分 ${r} 秒` : `${m} 分`;
      return r ? `${m}m ${r}s` : `${m}m`;
    },
    [i18n.language]
  );

  const [processTick, setProcessTick] = useState(0);
  useEffect(() => {
    if (!messages.some((m) => m.streaming)) return;
    const id = window.setInterval(() => setProcessTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [messages]);

  const formatWorked = useCallback(
    (assistant?: ChatUiMessage) => {
      if (!assistant) return null;
      if (assistant.streaming) {
        if (assistant.drawing) return t('agent.liveDrawing');
        if (assistant.startedAt) {
          const s = Math.max(1, Math.round((Date.now() - assistant.startedAt) / 1000));
          return t('agent.workedFor', { duration: formatAgentDuration(s) });
        }
        if (assistant.intent?.trim() || (assistant.steps && assistant.steps.length > 0)) {
          return t('agent.workedFor', { duration: formatAgentDuration(1) });
        }
        return t('agent.working');
      }
      if (assistant.durationMs != null) {
        const s = Math.max(1, Math.round(assistant.durationMs / 1000));
        return t('agent.workedFor', { duration: formatAgentDuration(s) });
      }
      if (assistant.intent?.trim() || (assistant.steps && assistant.steps.length > 0)) {
        return t('agent.workLog');
      }
      return null;
    },
    [formatAgentDuration, t]
  );

  const chatTurns = useMemo(() => {
    const turns: Array<{ user: ChatUiMessage | null; assistant?: ChatUiMessage }> = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === 'user') {
        const next = messages[i + 1];
        if (next?.role === 'assistant') {
          turns.push({ user: m, assistant: next });
          i += 1;
        } else {
          turns.push({ user: m });
        }
      } else {
        turns.push({ user: null, assistant: m });
      }
    }
    return turns;
  }, [messages]);

  const clearContextChips = (opts?: { purgeUploads?: boolean }) => {
    if (opts?.purgeUploads) {
      for (const c of contextChips) {
        if (c.kind === 'attachment' && c.uploadKey) {
          async function purgeContextAttachment() {
            try {
              await deleteUploadedFile(c.uploadKey);
            } catch {
              /* ignore */
            }
          }
          purgeContextAttachment();
        }
      }
    }
    const keys = contextChips.map((c) => c.key);
    if (keys.length) contextDismissedKeyRef.current = keys[keys.length - 1];
    keys.forEach((k) => pinnedContextKeysRef.current.delete(k));
    setContextChips([]);
  };

  const onContextsChange = (next: ComposerContext[]) => {
    const removed = contextChips.filter((c) => !next.some((n) => n.key === c.key));
    for (const c of removed) {
      pinnedContextKeysRef.current.delete(c.key);
      contextDismissedKeyRef.current = c.key;
      if (c.kind === 'attachment' && c.uploadKey) {
        async function deleteRemovedAttachmentUpload() {
          try {
            await deleteUploadedFile(c.uploadKey);
          } catch {
            /* ignore */
          }
        }
        deleteRemovedAttachmentUpload();
      }
    }
    setContextChips(next);
  };

  const handleAttachFiles = async (files: File[], opts?: { mention?: boolean }) => {
    const MAX_IMAGE = 10 * 1024 * 1024;
    const MAX_VIDEO = 100 * 1024 * 1024;
    const MAX_AUDIO = 100 * 1024 * 1024;
    const pickedModel = models.find((m) => m.id === model);
    const isVideoMode =
      interactionMode === 'video' ||
      composerMode === 'video' ||
      isVideoKind(pickedModel);
    const isImageMode =
      !isVideoMode &&
      (interactionMode === 'image' ||
        composerMode === 'image' ||
        isImageKind(pickedModel));
    const limit = agentAttachmentLimit({
      models,
      modelId: model,
      isImageMode: isImageMode || isVideoMode,
      rules: designCatalog?.global_rules,
      routedImageId: routeOverridesForApi(loadAgentRoutePrefs(designCatalog?.global_rules))?.image,
      freeImageId: cloudImageFallbackId() || undefined,
      autoModel: AUTO_MODEL,
    });
    let remaining = Math.max(
      0,
      limit - contextChips.filter((c) => c.kind === 'attachment').length
    );
    if (remaining <= 0) {
      message.warning(t('agent.attachMaxReached', { count: limit }));
      return;
    }

    const accepted: File[] = [];
    for (const file of files) {
      if (remaining <= 0) {
        message.warning(t('agent.attachMaxReached', { count: limit }));
        break;
      }
      const mime = (file.type || '').toLowerCase();
      const isVideo = mime.startsWith('video/');
      const isImage = mime.startsWith('image/');
      const isAudio = mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name || '');
      const isLottie = mime === 'application/json' || mime === 'text/json' || /\.json$/i.test(file.name || '');
      if (!isImage && !isVideo && !isAudio && !isLottie) {
        message.warning(t('agent.attachImageOnly', { name: file.name }));
        continue;
      }
      let maxBytes = MAX_IMAGE;
      if (isVideo) maxBytes = MAX_VIDEO;
      else if (isAudio) maxBytes = MAX_AUDIO;
      if (file.size > maxBytes) {
        message.warning(t('agent.attachTooLarge', { name: file.name }));
        continue;
      }
      accepted.push(file);
      remaining -= 1;
    }
    if (!accepted.length) return;

    const previews = await Promise.all(
      accepted.map(async (file) => {
        try {
          const preview = await readFileAsDataUrl(file);
          let thumb = preview;
          if (file.type.startsWith('video/')) {
            try {
              thumb = await captureVideoPosterFrame(preview);
            } catch {
              /* poster optional */
            }
          }
          return { file, preview, thumb, ok: true as const };
        } catch {
          message.error(t('agent.attachReadFailed', { name: file.name }));
          return { file, preview: '', thumb: '', ok: false as const };
        }
      })
    );
    const readable = previews.filter((p) => p.ok);
    if (!readable.length) return;

    let mentionOrdinal = contextChipsRef.current.filter((c) => c.kind === 'attachment').length;
    const batch: Array<{
      file: File;
      key: string;
      preview: string;
      pending: ComposerContext;
      mentionCtx: ComposerContext | null;
    }> = readable.map(({ file, preview, thumb }) => {
      const key = `attachment:${file.name}:${file.size}:${file.lastModified}:${Math.random().toString(36).slice(2, 8)}`;
      const isVideo = file.type.startsWith('video/');
      const isAudio = file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name || '');
      const isLottie = file.type === 'application/json' || file.type === 'text/json' || /\.json$/i.test(file.name || '');
      let attachmentPayload = `[Attached image]\nname: ${file.name}\nmime: ${file.type}`;
      if (isVideo) {
        attachmentPayload = `[Attached video]\nname: ${file.name}\nmime: ${file.type}`;
      } else if (isAudio) {
        attachmentPayload = `[Attached audio]\nname: ${file.name}\nmime: ${file.type}`;
      } else if (isLottie) {
        attachmentPayload = `[Attached lottie]\nname: ${file.name}\nmime: ${file.type || 'application/json'}`;
      }
      const pending: ComposerContext = {
        key,
        label: file.name,
        kind: 'attachment',
        payload: attachmentPayload,
        dataUrl: preview,
        thumbUrl: thumb,
        uploadStatus: 'uploading',
      };
      pinnedContextKeysRef.current.add(key);
      mentionOrdinal += 1;
      const n = mentionOrdinal;
      let mentionCtx: ComposerContext | null = null;
      if (opts?.mention) {
        mentionCtx = {
          key: `attach-ref:${chipBaseKey(key)}`,
          label: t('agent.mentionAttachImageN', { n }),
          kind: 'image',
          payload: pending.payload || `[User attachment ${n}]`,
          dataUrl: preview,
          thumbUrl: thumb,
        };
      }
      return { file, key, preview, pending, mentionCtx };
    });

    setContextChips((prev) => {
      const extra: ComposerContext[] = [];
      for (const item of batch) {
        extra.push(item.pending);
        if (item.mentionCtx) extra.push(item.mentionCtx);
      }
      return [...prev, ...extra];
    });
    queueMicrotask(() => inputRef.current?.focusEnd());

    await Promise.all(
      batch.map(async ({ file, key, preview, pending }) => {
        try {
          const poster = String(pending.thumbUrl || '').trim();
          const uploaded = await uploadComposerAttachment(file, {
            previewDataUrl:
              file.type.startsWith('video/') && poster.startsWith('data:image/')
                ? poster
                : preview,
          });
          const imageRef = String(uploaded.imageRef || '').trim();
          const localPreview = String(uploaded.previewDataUrl || poster || preview).trim();
          setContextChips((prev) => {
            if (!prev.some((c) => c.key === key)) {
              if (uploaded.uploadKey) {
                async function purgeOrphanUpload() {
                  try {
                    await deleteUploadedFile(uploaded.uploadKey);
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
                    dataUrl: imageRef || localPreview,
                    thumbUrl:
                      (c.thumbUrl && c.thumbUrl.startsWith('data:image/')
                        ? c.thumbUrl
                        : null) ||
                      (localPreview.startsWith('data:image/') ? localPreview : null) ||
                      c.thumbUrl ||
                      localPreview ||
                      imageRef,
                    uploadKey: uploaded.uploadKey || undefined,
                    uploadStatus: 'ready' as const,
                  }
                : c
            );
          });
        } catch {
          pinnedContextKeysRef.current.delete(key);
          setContextChips((prev) => prev.filter((c) => c.key !== key));
          message.error(t('agent.uploadFailed', { name: file.name }));
        }
      })
    );
  };

  const composerImagesOnly =
    interactionMode === 'image' ||
    (composerMode === 'image' && interactionMode !== 'video') ||
    (isImageKind(models.find((m) => m.id === model)) && interactionMode !== 'video');

  /** Arc fly into Agent composer only (`data-fly-land="agent"`), then apply attach. */
  async function flyPayloadIntoComposer(
    payload: string | string[],
    imagesOnly: boolean
  ) {
    if (!document) return;
    noteCanvasFlyLand('agent');
    const from = resolveNextFlyOrigin({ document, payload });
    const label = resolveAttachFlyLabel(document, payload);
    try {
      await playFlyChipToChat({
        from,
        label,
        landId: 'agent',
        onLand: async () => {
          await applyCanvasAttachPayload({
            document,
            payload,
            existingChips: contextChipsRef.current,
            onAttachFiles: handleAttachFiles,
            insertChip: (ctx) => {
              pinnedContextKeysRef.current.add(ctx.key);
              contextDismissedKeyRef.current = null;
              inputRef.current?.insertContextAtCaret(ctx);
              inputRef.current?.focusEnd();
            },
            pushAttachment: (att) => {
              pinnedContextKeysRef.current.add(att.key);
              setContextChips((prev) => {
                if (prev.some((c) => c.key === att.key)) return prev;
                return [...prev, att];
              });
              queueMicrotask(() => inputRef.current?.focusEnd());
            },
            imagesOnly,
          });
        },
      });
    } catch {
      /* ignore */
    }
  }

  /** Right-click / pick 「添加到 Chat」— shapes → chips; images/videos → attachment strip. */
  useEffect(() => {
    if (attachToChat == null) {
      attachToChatLockRef.current = null;
      return;
    }
    if (!open || !document) return;
    const token = canvasAttachToken(attachToChat);
    if (attachToChatLockRef.current === token) {
      onAttachConsumed?.();
      return;
    }
    attachToChatLockRef.current = token;
    const payload = attachToChat;
    onAttachConsumed?.();
    flyPayloadIntoComposer(payload, composerImagesOnly);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot attach; flyPayload reads latest via closure
  }, [open, attachToChat, document, composerImagesOnly]);

  /** Composer "Add from canvas" pick result (node composers use pending; agent uses attachToChat). */
  const pendingCanvasAttach = useSelector(
    (s: RootState) =>
      s.editor.pendingCanvasAttach as null | { target: string; payload: string | string[] }
  );
  useEffect(() => {
    if (!pendingCanvasAttach) {
      pendingCanvasAttachLockRef.current = null;
      return;
    }
    if (!open || !document) return;
    if (pendingCanvasAttach.target !== 'agent') return;
    const token = `pending:${pendingCanvasAttach.target}:${canvasAttachToken(pendingCanvasAttach.payload)}`;
    if (pendingCanvasAttachLockRef.current === token) {
      dispatch(consumePendingCanvasAttach());
      return;
    }
    pendingCanvasAttachLockRef.current = token;
    const payload = pendingCanvasAttach.payload;
    dispatch(consumePendingCanvasAttach());
    flyPayloadIntoComposer(payload, composerImagesOnly);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingCanvasAttach, document, dispatch, composerImagesOnly]);

  const selectedModel =
    model === 'auto' ? AUTO_MODEL : models.find((m) => m.id === model);
  const selectedModelLabel = selectedModel?.label || (models[0]?.label ?? 'Agent');
  const isVideoInteraction = interactionMode === 'video';
  const isVideoModelSelected =
    isVideoInteraction ||
    composerMode === 'video' ||
    isVideoKind(selectedModel);
  const isImageInteraction = interactionMode === 'image';
  const isImageModelSelected =
    !isVideoInteraction &&
    (isImageInteraction || composerMode === 'image' || isImageKind(selectedModel));
  const rules = designCatalog?.global_rules;
  const attachmentLimit = agentAttachmentLimit({
    models,
    modelId: model,
    isImageMode: isImageModelSelected || isVideoModelSelected,
    rules,
    routedImageId: routeOverridesForApi(loadAgentRoutePrefs(rules))?.image,
    freeImageId: cloudImageFallbackId() || undefined,
    autoModel: AUTO_MODEL,
  });
  const attachmentCount = contextChips.filter((c) => c.kind === 'attachment').length;
  const attachmentsUploading = contextChips.some(
    (c) => c.kind === 'attachment' && c.uploadStatus === 'uploading'
  );
  const attachFull = attachmentCount >= attachmentLimit;

  const imageAspectProps = {
    // Agent canvas size defaults to Smart (auto) — no manual size popover.
    showDesignSizePicker: false,
    imageAspectRatio,
    onImageAspectRatioChange: setImageAspectRatio,
    aspectMenuPlacement: 'top-start' as const,
  };
  const attachProps = {
    onAttachFiles: attachFull ? undefined : handleAttachFiles,
    attachTooltip: attachFull
      ? t('agent.attachMaxReached', { count: attachmentLimit })
      : t('agent.uploadImage'),
    // Mobile floating dock: canvas pick is not usable — hide the control.
    onPickFromCanvas: floating
      ? undefined
      : () => {
          if (pickingFromCanvas) {
            dispatch(clearCanvasAttachPick());
            return;
          }
          // Image chat mode — stills only; video chat mode allows media.
          const imagesOnly = isImageModelSelected && !isVideoModelSelected;
          // If the canvas already has a selection, attach it immediately without entering pick mode.
          // Entering pick mode after attaching would cause the user to re-click the same node
          // and attach it a second time.
          const doc = document;
          const attachable = selectedNodeIds.filter((id) =>
            canAttachNodeToChat(doc?.deltaSetLike?.[id], { imagesOnly })
          );
          const frameId = selectedFrameIds.find(Boolean) || null;
          noteCanvasFlyLand('agent');
          if (attachable.length || frameId) {
            async function attachSelectionWithFly() {
              if (attachable.length) {
                await flyPayloadIntoComposer(
                  attachable.length === 1 ? attachable[0]! : attachable,
                  imagesOnly
                );
              }
              if (frameId) {
                await flyPayloadIntoComposer(`frame:${frameId}`, imagesOnly);
              }
            }
            attachSelectionWithFly();
          } else {
            dispatch(
              startCanvasAttachPick({
                target: 'agent',
                accept: imagesOnly ? 'image' : 'media',
              })
            );
          }
        },
    pickingFromCanvas: floating ? false : pickingFromCanvas,
    pickFromCanvasTooltip: pickingFromCanvas
      ? t('agent.pickFromCanvasCancel')
      : t('agent.pickFromCanvas'),
  };

  const buildUserMessage = (text: string) => buildComposerChipPrompt(contextChips, text);

  const finishAssistantPatch = (
    m: ChatUiMessage,
    patch: Partial<ChatUiMessage> = {}
  ): ChatUiMessage => ({
    ...m,
    ...patch,
    streaming: false,
    durationMs: assistantDurationMs(m, patch),
  });

  /** Fill a shape node with an image (rect / ellipse / …). Returns false if not fillable. */
  const fillNodeWithImage = useCallback(
    (nodeId: string, src: string, skipHistory = false): boolean => {
      const url = String(src || '').trim();
      const id = String(nodeId || '').trim();
      if (!url || !id) return false;
      const doc = store.getState().editor?.document;
      const node = doc?.deltaSetLike?.[id];
      if (!node) return false;
      const key = String(node.key || '').toLowerCase();
      if (['text', 'frame', 'artboard', 'group'].includes(key)) return false;
      if (key === 'image') {
        if (!skipHistory) dispatch(pushEditorHistory());
        dispatch(
          patchDocumentNode({
            nodeId: id,
            skipHistory: true,
            patch: { attrs: { src: url } },
          })
        );
        return true;
      }
      const shape = String(node.attrs?.shapeType || key || '').toLowerCase();
      if (['line', 'arrow', 'pen', 'pencil'].includes(shape)) return false;
      if (!skipHistory) dispatch(pushEditorHistory());
      dispatch(
        patchDocumentNode({
          nodeId: id,
          skipHistory: true,
          patch: {
            attrs: {
              'fill-type': 'image',
              'fill-enabled': 'true',
              'fill-visible': 'true',
              'fill-image-src': url,
              'fill-image-fit': 'fill',
            },
          },
        })
      );
      return true;
    },
    [dispatch, store]
  );

  const stopGeneration = () => {
    const tid = liveDesignTaskRef.current;
    pauseRequestedRef.current = true;
    if (tid) {
      async function pauseLiveDesignRun() {
        try {
          await pauseDesignRun(tid);
        } catch {
          /* ignore */
        }
      }
      pauseLiveDesignRun();
    }
    abortRef.current?.abort();
    if (desktopShell && engineMode === 'cli') {
      async function killCodingCliOnStop() {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('kill_coding_cli');
        } catch {
          /* ignore */
        }
      }
      killCodingCliOnStop();
    }
    dispatch(setAgentBusy(false));
    setSending(false);
    setMessages((prev) =>
      prev.map((m) => {
        if (!m.streaming) return m;
        const taskId = tid || m.designTaskId;
        if (taskId) {
          return finishAssistantPatch(m, {
            content: (m.content || '').trim(),
            designTaskId: taskId,
            canResume: true,
          });
        }
        return finishAssistantPatch(m, {
          content: (m.content || '').trim(),
          canResume: false,
        });
      })
    );
  };

  const resumeGeneration = async (assistantId?: string) => {
    if (sending) return;
    const target =
      (assistantId
        ? messages.find((m) => m.id === assistantId)
        : [...messages].reverse().find((m) => m.canResume && m.designTaskId)) ||
      null;
    const taskId = String(target?.designTaskId || '').trim();
    if (!target || !taskId) return;

    const userMsg =
      [...messages].reverse().find((m) => m.role === 'user' && m.id !== target.id) ||
      messages.find((m) => m.role === 'user') ||
      null;
    if (!userMsg) return;

    const ac = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ac;
    pauseRequestedRef.current = false;
    liveDesignTaskRef.current = taskId;
    setSending(true);
    dispatch(setAgentBusy(true));
    setMessages((prev) =>
      prev.map((m) =>
        m.id === target.id
          ? {
              ...m,
              streaming: true,
              canResume: false,
              startedAt: m.startedAt || Date.now(),
            }
          : m
      )
    );

    const designMutable: DesignSendMutable = {
      designStarted: true,
      canvasMutated: false,
      nodesPainted: false,
    };
    const chipNorm = 'auto';
    const onDesignEvent = createDesignAgentEventRouter({
      t,
      assistantId: target.id,
      userMsg,
      chipNorm,
      setMessages,
      setImageAspectRatio,
      setDesignScene,
      designSceneRef,
      lastAgentFrameIdRef,
      lastAgentSvgByFrameRef,
      checkpointsRef,
      store,
      finishAssistantPatch,
      mutable: designMutable,
      onSessionControl: handleSessionControl,
    });

    try {
      await runDesignAgent({
        userMessage: userMsg.content || '',
        runMode: 'agent',
        interactionMode: 'agent',
        paintMode: 'ops',
        resumeTaskId: taskId,
        resumeToken: target.designResumeToken || undefined,
        scene: null,
        styleGroupId: styleGroupId ?? designCatalog?.style_groups?.[0]?.id ?? null,
        model: resolveAgentSendModel(canPickModel, model),
        routeOverrides: resolveAgentRouteOverrides(canPickModel, model),
        canvasSize: 'auto',
        canvasId: chatScopeId || undefined,
        sessionId,
        projectId: chatScopeId || '__none__',
        locale: i18n.language || 'zh-CN',
        designIntensity,
        dispatch,
        getDocument: () => store.getState().editor.document,
        signal: ac.signal,
        onEvent: (ev) => {
          if (ev.type === 'task') liveDesignTaskRef.current = ev.taskId;
          if (ev.type === 'paused' && ev.taskId) liveDesignTaskRef.current = ev.taskId;
          onDesignEvent(ev);
        },
      });
    } finally {
      dispatch(setAgentBusy(false));
      setSending(false);
      if (ac.signal.aborted && pauseRequestedRef.current) {
        /* stopGeneration already patched the message */
      } else if (ac.signal.aborted) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === target.id && m.streaming
              ? finishAssistantPatch(m, {
                  content: (m.content || '').trim(),
                  designTaskId: taskId,
                  canResume: true,
                })
              : m
          )
        );
      }
    }
  };

  // Reopen editor / switch session: if a paused design task is still resumable, continue it.
  useEffect(() => {
    if (sending || !open || pauseRequestedRef.current) return;
    const target = [...messages]
      .reverse()
      .find((m) => m.role === 'assistant' && m.canResume && m.designTaskId);
    const taskId = String(target?.designTaskId || '').trim();
    if (!target || !taskId) return;
    const key = `${sessionId}:${taskId}`;
    if (autoResumeKeyRef.current === key) return;
    autoResumeKeyRef.current = key;
    let cancelled = false;
    async function autoResumePausedDesign() {
      try {
        const st = await fetchDesignRunStatus(taskId);
        if (cancelled) return;
        if (!st?.resumable) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === target.id ? { ...m, canResume: false } : m
            )
          );
          return;
        }
        await resumeGeneration(target.id);
      } catch {
        /* keep Resume button; user can retry */
      }
    }
    autoResumePausedDesign();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, open, sending, messages]);

  const send = async (
    opts?:
      | string
      | {
          text?: string;
          priorMessages?: ChatUiMessage[];
          displayContent?: string;
          raw?: boolean;
          /** Ask confirm: apply proposed ops (forces Design / agent path). */
          applyOps?: ChatUiMessage['proposedOps'];
          proposalId?: string;
          proposalTaskId?: string;
          forceAgent?: boolean;
        }
  ) => {
    const options = typeof opts === 'string' ? { text: opts } : opts || {};
    const text = (options.text ?? input).trim();
    const hasChips = contextChipsRef.current.length > 0;
    if (!text && !options.applyOps?.length && !hasChips) return;
    // New turn while busy: abort prior run, then let intent LLM classify
    // (including session_action clear/stop).
    if (sending) {
      abortRef.current?.abort();
      setSending(false);
      dispatch(setAgentBusy(false));
    }

    // Typed confirm/revise/dismiss: attach proposal ids; intent LLM judges.
    // Chip Confirm still passes applyOps (fast path).
    const lastAsk = findLastAskMessage(messages);
    const pendingProposal =
      !options.applyOps?.length && !options.proposalId && lastAsk?.proposedOps?.length
        ? askProposalBind(lastAsk)
        : {};

    const sendText = resolveSendDisplayText({
      text,
      hasChips,
      hasApplyOps: Boolean(options.applyOps?.length),
    });
    const forceAgent = Boolean(
      options.forceAgent ||
        options.applyOps?.length ||
        options.proposalId ||
        pendingProposal.proposalId
    );

    if (
      contextChips.some(
        (c) => c.kind === 'attachment' && c.uploadStatus === 'uploading'
      )
    ) {
      message.warning(t('agent.attachWaitUpload'));
      return;
    }
    const useCodingCli =
      desktopShell &&
      engineMode === 'cli' &&
      codingClis.some((c) => c.available) &&
      !forceAgent &&
      !options.applyOps?.length;
    if (available === false && !useCodingCli) {
      message.warning(
        composerSendDisabledReason({
          t,
          attachmentsUploading: false,
          hasContent: true,
          available,
          modelsStatus,
        }) || t('agent.modelsUnavailable')
      );
      setInput(sendText);
      queueMicrotask(() => inputRef.current?.focus());
      void modelsQuery.refetch();
      return;
    }

    const baseMessages = options.priorMessages ?? messages;
    const { inlineContexts, bubbleContexts } = splitBubbleContexts(contextChips);
    const userFacing = options.displayContent ?? sendText;
    const markedFromDom =
      !options.raw && inlineContexts.length
        ? String(inputRef.current?.getMarkedText?.() || '')
        : '';
    const contentMarked = resolveUserContentMarked({
      markedFromDom,
      displayContextsLen: inlineContexts.length,
      userFacing,
    });
    const userMsg: ChatUiMessage = {
      id: newMessageId(),
      role: 'user',
      content: userFacing,
      ...(bubbleContexts.length && !options.raw
        ? {
            contexts: bubbleContexts,
            ...(contentMarked ? { contentMarked } : {}),
          }
        : {}),
    };
    const assistantId = newMessageId();

    setInput('');
    setModelPanelOpen(false);
    setMentionPanelOpen(false);
    setMentionQuery('');
    setEditingUserId(null);
    setEditDraft('');
    setPendingReview(null);
    const {
      frameChip,
      chipFrameId: chipFrameIdFromContext,
      mentionNodeIds,
      attachedImages,
      mentionImageSrcs,
      skillRefs,
    } = collectSendChipContext(contextChips);
    // Build API prompt while chips still exist — clearing first drops [Target element]
    // so the backend never sees @ and may create a new artboard instead of edit/delete.
    const userMessageForApi = options.raw
      ? sendText
      : buildUserMessage(sendText);
    const docForFill = store.getState().editor?.document;
    const {
      imageGenCount,
      imageGenAspect,
      imageGenResolution,
      imageFillTargets,
    } = resolveImageGenPlan({
      isImageInteraction,
      imageGenCountSetting,
      isImageModelSelected,
      imageResolution,
      imageGenAspectRatio,
      mentionNodeIds,
      docForFill,
    });
    const runVideoGen =
      !useCodingCli &&
      shouldRunVideoGenPath({
        isVideoModelSelected,
        forceAgent,
        hasApplyOps: Boolean(options.applyOps?.length),
      });
    const videoGenAspect =
      String(videoGenAspectRatio).trim() !== 'smart'
        ? String(videoGenAspectRatio).trim() || undefined
        : undefined;
    clearContextChips();
    setSending(true);
    // Clear prior Ask chips in the same write — a separate setMessages(clear)
    // would be overwritten by this replace with stale baseMessages.
    setMessages([
      ...baseMessages.map(clearAskProposalFields),
      userMsg,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        ...(runVideoGen
          ? buildVideoAssistantSeed({
              videoGenAspect,
              videoGenAspectRatio,
              canPickModel,
              model,
              selectedModel,
            })
          : buildStreamingAssistantSeed({
              imageGenCount,
              imageGenAspect,
              imageGenAspectRatio,
              canPickModel,
              model,
              selectedModel,
              models,
              t,
            })),
        streaming: true,
        startedAt: Date.now(),
      },
    ]);

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    pauseRequestedRef.current = false;
    liveDesignTaskRef.current = null;

    // Video model → gallery in chat; takes precedence over image gen.
    if (runVideoGen) {
      dispatch(setAgentBusy(true));
      const aspect = videoGenAspect;
      const resolution = videoResolution;
      const duration = videoGenDuration;
      const videoModel = !canPickModel
        ? cloudVideoFallbackId()
        : model || pickPreferredVideoModelId(models) || cloudVideoFallbackId();
      const refImages = attachedImages.filter((u) => Boolean(u) && !u.startsWith('data:video/'));
      const patchAssistant = (
        pred: (m: ChatUiMessage) => boolean,
        patch: (m: ChatUiMessage) => ChatUiMessage
      ) => {
        setMessages((prev) => prev.map((m) => (pred(m) ? patch(m) : m)));
      };
      try {
        const body: Parameters<typeof generateVideo>[0] = {
          prompt: text,
          model: videoModel,
          aspect_ratio: aspect,
          resolution,
          duration,
        };
        if (refImages.length) body.images = refImages;
        const res = await generateVideo(body, { signal: ac.signal });
        const url = firstGeneratedVideoUrl(res);
        if (ac.signal.aborted) return;
        if (!url) {
          patchAssistant(
            (m) => m.id === assistantId,
            (m) =>
              finishAssistantPatch(m, {
                content: t('agent.requestFailed'),
                videoPendingCount: undefined,
                imageAspectRatio: aspect || videoGenAspectRatio,
                steps: [],
              })
          );
          return;
        }
        patchAssistant(
          (m) => m.id === assistantId,
          (m) =>
            finishAssistantPatch(m, {
              content: '',
              videos: [url],
              videoPendingCount: undefined,
              imageAspectRatio: aspect || videoGenAspectRatio,
              steps: [],
            })
        );
      } catch (err) {
        if (ac.signal.aborted) return;
        patchAssistant(
          (m) => m.id === assistantId,
          (m) =>
            finishAssistantPatch(m, {
              content: humanizeDesignError(t, 'internal_error'),
              videoPendingCount: undefined,
              steps: [],
            })
        );
      } finally {
        dispatch(setAgentBusy(false));
        setSending(false);
      }
      return;
    }

    // Local coding CLI — mutually exclusive with Design Agent (LangGraph untouched).
    if (useCodingCli) {
      dispatch(setAgentBusy(true));
      const cliId = codingCliId || codingClis.find((c) => c.available)?.id || '';
      let streamed = '';
      const appendToken = (chunk: string) => {
        if (!chunk) return;
        streamed += chunk;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `${m.content || ''}${chunk}` }
              : m
          )
        );
      };
      try {
        if (!cliId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? finishAssistantPatch(m, { content: t('agent.engineCliMissing') })
                : m
            )
          );
          return;
        }
        const docNow = store.getState().editor?.document;
        const {
          chipFrameId,
          targetFrameId,
          sceneNodes,
          sceneFrames,
          spatialSummary,
        } = buildDesignSceneSnapshot({
          docNow,
          chipFrameId: chipFrameIdFromContext,
          frameChip,
          mentionNodeIds,
          lastAgentFrameId: lastAgentFrameIdRef.current,
          taskStateFrameId: taskState?.canvas?.last_agent_frame_id || null,
          canvasUi,
        });
        if (docNow) {
          checkpointsRef.current.set(userMsg.id, cloneDocument(docNow) ?? docNow);
        }
        const cwd = await prepareCodingCliWorkspaceDesktop({
          projectId: chatScopeId || '__none__',
          files: buildCodingCliWorkspaceFiles({
            userPrompt: userMessageForApi,
            skillRefs,
            scene: {
              focusFrameId: chipFrameId || targetFrameId,
              frames: sceneFrames,
              nodes: sceneNodes,
              spatial: spatialSummary,
            },
          }),
        });
        appendToken(`${t('agent.engineCliRunning')}\n\n`);
        await runCodingCliDesktop({
          cliId,
          cwd,
          prompt: buildCodingCliEnrichedPrompt({
            userPrompt: userMessageForApi,
            cwd,
            skillRefs,
          }),
          signal: ac.signal,
          onChunk: appendToken,
        });
        if (ac.signal.aborted) return;
        const ops = extractToolOpsFromText(streamed);
        let applied = { created: 0, updated: 0, deleted: 0 };
        if (ops.length) {
          const paint = await applyAgentToolOps({
            ops,
            dispatch,
            getDocument: () => store.getState().editor?.document,
            frameId: targetFrameId,
            signal: ac.signal,
            sceneNodes,
            canvasUi,
          });
          applied = {
            created: paint.created,
            updated: paint.updated,
            deleted: paint.deleted,
          };
          if (paint.frameId) lastAgentFrameIdRef.current = paint.frameId;
        }
        const footer = codingCliApplyFooter({ t, ops, applied });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? finishAssistantPatch(m, {
                  content: m.content?.trim()
                    ? `${m.content.trim()}\n\n_${footer}_`
                    : footer,
                })
              : m
          )
        );
      } catch (err) {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        const msg =
          err instanceof Error && err.message ? err.message : t('agent.requestFailed');
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? finishAssistantPatch(m, {
                  content: m.content?.trim()
                    ? `${m.content.trim()}\n\n${msg}`
                    : msg,
                })
              : m
          )
        );
      } finally {
        dispatch(setAgentBusy(false));
        setSending(false);
      }
      return;
    }

    // Image model → Seedream gallery; Ask / forceAgent stay on design agent.
    if (
      shouldRunImageGenPath({
        isImageModelSelected,
        forceAgent,
        hasApplyOps: Boolean(options.applyOps?.length),
      })
    ) {
      dispatch(setAgentBusy(true));
      const count = imageGenCount;
      const fillTargets = imageFillTargets;
      const aspect = imageGenAspect;
      const resolution = imageGenResolution;
      const patchAssistant = (
        pred: (m: ChatUiMessage) => boolean,
        patch: (m: ChatUiMessage) => ChatUiMessage
      ) => {
        setMessages((prev) => prev.map((m) => (pred(m) ? patch(m) : m)));
      };
      const finishImageGen = (kind: ImageGenFinishKind, urls: string[]) => {
        switch (kind) {
          case 'aborted':
            patchAssistant(
              (m) => m.id === assistantId && Boolean(m.streaming),
              (m) =>
                finishAssistantPatch(m, {
                  content: (m.content || '').trim(),
                  images: urls.length ? urls : m.images?.filter(Boolean),
                  imagePendingCount: undefined,
                  imageAspectRatio: aspect,
                  steps: [],
                })
            );
            return;
          case 'failed':
            patchAssistant(
              (m) => m.id === assistantId,
              (m) =>
                finishAssistantPatch(m, {
                  content: t('agent.requestFailed'),
                  imagePendingCount: undefined,
                  imageAspectRatio: aspect,
                  steps: [],
                })
            );
            return;
          case 'success': {
            let filled = 0;
            if (fillTargets.length) {
              dispatch(pushEditorHistory());
              const n = Math.min(fillTargets.length, urls.length);
              for (let i = 0; i < n; i += 1) {
                if (fillNodeWithImage(fillTargets[i], urls[i], true)) filled += 1;
              }
            }
            patchAssistant(
              (m) => m.id === assistantId,
              (m) =>
                finishAssistantPatch(m, {
                  content: filled
                    ? t('agent.imageFilledOnCanvas', {
                        defaultValue: 'Filled selection with image',
                      })
                    : '',
                  images: urls,
                  imagePendingCount: undefined,
                  imageAspectRatio: aspect,
                  steps: [],
                })
            );
          }
        }
      };
      try {
        // Parallel per-slot gens (Seedream `n` is unreliable). Each ready card unlocks
        // immediately — no more 「第 2 张一直扫光」while waiting on a serial queue.
        const slotUrls = Array.from({ length: count }, () => '');
        const publishSlots = () => {
          patchAssistant(
            (m) => m.id === assistantId,
            (m) => ({
              ...m,
              images: [...slotUrls],
              imagePendingCount: count,
              imageAspectRatio: aspect || imageGenAspectRatio,
            })
          );
        };
        await Promise.all(
          Array.from({ length: count }, async (_, i) => {
            if (ac.signal.aborted) return;
            try {
              const refImages = uniqueVisionUrls([...attachedImages, ...mentionImageSrcs]);
              const imageBody = buildImageGenRequestBody({
                prompt: contextChips.length ? userMessageForApi : text,
                canPickModel,
                model,
                aspect,
                resolution,
                isImageInteraction,
                attachedImages: refImages,
              });
              const res = await generateImage(imageBody, { signal: ac.signal });
              const url = firstGeneratedImageUrl(res);
              if (!url) return;
              slotUrls[i] = url;
              publishSlots();
            } catch {
              // Leave this slot as shimmer until the batch settles.
            }
          })
        );
        const urls = slotUrls.filter(Boolean);
        finishImageGen(
          resolveImageGenFinishKind({ aborted: ac.signal.aborted, urls }),
          urls
        );
      } catch (err) {
        if (ac.signal.aborted) return;
        patchAssistant(
          (m) => m.id === assistantId,
          (m) =>
            finishAssistantPatch(m, {
              content: humanizeDesignError(t, 'internal_error'),
              imagePendingCount: undefined,
              steps: [],
            })
        );
      } finally {
        dispatch(setAgentBusy(false));
        setSending(false);
      }
      return;
    }

    // P0 agent: lean canvas digest (sync) — no focus-frame screenshot (that stalled 40s).
    const docNow = store.getState().editor.document;
    const {
      chipFrameId,
      targetFrameId,
      sceneNodes,
      sceneFrames,
      spatialSummary,
      seedLiveNodeIds,
    } = buildDesignSceneSnapshot({
      docNow,
      chipFrameId: chipFrameIdFromContext,
      frameChip,
      mentionNodeIds,
      lastAgentFrameId: lastAgentFrameIdRef.current,
      taskStateFrameId: taskState?.canvas?.last_agent_frame_id || null,
      canvasUi,
    });
    const sendImages = uniqueVisionUrls(
      await Promise.all(
        [...attachedImages, ...mentionImageSrcs].map((src) => resolveVisionImageUrl(src))
      )
    );

    const designMutable: DesignSendMutable = {
      designStarted: false,
      canvasMutated: false,
      nodesPainted: false,
    };
    if (docNow) {
      checkpointsRef.current.set(userMsg.id, cloneDocument(docNow) ?? docNow);
    }

    dispatch(setAgentBusy(true));
    const memoryMedium = buildTaskStateFromDocument({
      doc: docNow,
      sessionId,
      projectId: chatScopeId || '__none__',
      focusFrameId: chipFrameId || targetFrameId,
      lastAgentFrameId: lastAgentFrameIdRef.current,
      config: {
        style_group_id: styleGroupId ?? designCatalog?.style_groups?.[0]?.id ?? null,
        model: model || 'auto',
      },
      prior:
        taskState ||
        emptyTaskState({ sessionId, projectId: chatScopeId || '__none__' }),
    });
    const memoryShort = buildShortTermFromMessages(
      [...baseMessages, userMsg].map((m) => ({
        role: m.role,
        content: m.content || '',
      }))
    );
    try {
      const chipNorm = normalizeCanvasSizeChip(imageAspectRatio);
      const sendScene = null;
      // Design agent: always Smart — LLM create_frame picks WxH (no CLIENT_SIZE_LOCK).
      const sendCanvasSize = 'auto';
      const onDesignEvent = createDesignAgentEventRouter({
        t,
        assistantId,
        userMsg,
        chipNorm: 'auto',
        setMessages,
        setImageAspectRatio,
        setDesignScene,
        designSceneRef,
        lastAgentFrameIdRef,
        lastAgentSvgByFrameRef,
        checkpointsRef,
        store,
        finishAssistantPatch,
        mutable: designMutable,
        onSessionControl: handleSessionControl,
      });

      // P0: lean scene + memory; skip canvas screenshot preview.
      await runDesignAgent({
        userMessage: userMessageForApi,
        runMode: 'agent',
        interactionMode: 'agent',
        paintMode: 'ops',
        applyOps: options.applyOps?.length ? options.applyOps : undefined,
        proposalId: options.proposalId || pendingProposal.proposalId || undefined,
        proposalTaskId:
          options.proposalTaskId || pendingProposal.proposalTaskId || undefined,
        scene: sendScene,
        styleGroupId: styleGroupId ?? designCatalog?.style_groups?.[0]?.id ?? null,
        model: resolveAgentSendModel(canPickModel, model),
        routeOverrides: resolveAgentRouteOverrides(canPickModel, model),
        canvasSize: sendCanvasSize,
        canvasId: chatScopeId || undefined,
        sceneNodes: sceneNodes.length ? sceneNodes : undefined,
        sceneFrames: sceneFrames.length ? sceneFrames : undefined,
        spatialSummary: spatialSummary || undefined,
        focusFrameId: targetFrameId || undefined,
        seedLiveNodeIds: seedLiveNodeIds.length ? seedLiveNodeIds : undefined,
        skillRefs: skillRefs.length ? skillRefs : undefined,
        images: sendImages.length ? sendImages : undefined,
        sessionId,
        projectId: chatScopeId || '__none__',
        locale: i18n.language || 'zh-CN',
        designIntensity,
        canvasUi,
        processLabels: {
          preparing: t('agent.canvasProcessPreparing'),
          thinking: t('agent.canvasProcessThinking'),
          exploring: t('agent.canvasProcessExploring'),
          editing: t('agent.canvasProcessEditing'),
          reviewing: t('agent.canvasProcessReviewing'),
        },
        memory: {
          medium: memoryMedium,
          short: memoryShort,
          retrieve_long: true,
        },
        onMemoryPatch: (patch: MemoryPatch, hints) => {
          setTaskState((prev) => {
            const base =
              prev ||
              emptyTaskState({ sessionId, projectId: chatScopeId || '__none__' });
            let next = applyMemoryPatch(base, patch);
            next = applyClientFrameHints(next, {
              lastAgentFrameId: hints.lastAgentFrameId || undefined,
            });
            return next;
          });
          if (hints.lastAgentFrameId) {
            lastAgentFrameIdRef.current = String(hints.lastAgentFrameId);
          }
          setPendingLongSuggestions((prev) =>
            mergeLongSuggestions(prev, patch.long_suggestions)
          );
        },
        dispatch,
        getDocument: () => store.getState().editor.document,
        targetFrameId,
        // Explicit @ frame / @ node→frame only — not last-agent inference.
        pinnedFrameId: chipFrameId || null,
        signal: ac.signal,
        onEvent: (ev) => {
          if (ev.type === 'task') liveDesignTaskRef.current = ev.taskId;
          if (ev.type === 'paused' && ev.taskId) liveDesignTaskRef.current = ev.taskId;
          onDesignEvent(ev);
        },
      });
    } finally {
      dispatch(setAgentBusy(false));
      if (designMutable.canvasMutated && checkpointsRef.current.has(userMsg.id)) {
        setMessages((prev) =>
          prev.map((m) => (m.id === userMsg.id ? { ...m, canRestore: true } : m))
        );
        setPendingReview({ userMessageId: userMsg.id, assistantId });
      }
    }

    if (ac.signal.aborted) {
      const tid = liveDesignTaskRef.current;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId || !m.streaming) return m;
          if (tid || m.designTaskId || pauseRequestedRef.current) {
            return finishAssistantPatch(m, {
              content: (m.content || '').trim(),
              designTaskId: tid || m.designTaskId,
              canResume: Boolean(tid || m.designTaskId),
            });
          }
          return finishAssistantPatch(m, {
            content: (m.content || '').trim(),
          });
        })
      );
    }

    setSending(false);
  };

  function handleAskChoice(pick: AskChoicePick) {
    if (sending) return;
    const next = resolveAskChoiceSend(messages, pick);
    switch (next.kind) {
      case 'dismiss':
        setMessages((prev) =>
          prev.map((m) => (m.id === next.messageId ? clearAskProposalFields(m) : m))
        );
        return;
      case 'apply':
        send({
          text: next.text,
          raw: true,
          displayContent: next.text,
          applyOps: next.ops,
          proposalId: next.proposalId,
          proposalTaskId: next.proposalTaskId,
          forceAgent: true,
        });
        return;
      case 'reply':
        send({ text: next.text, raw: true, displayContent: next.displayText || next.text });
        return;
      default:
        return;
    }
  }

  /** Flush home-agent auto-submit once model list has settled (ready or error). */
  useEffect(() => {
    if (!open) return;
    if (holdAutoSubmit) return;
    if (new URLSearchParams(location.search).get('createNew') === '1') return;
    // Prefer scoped project id so the user message is not wiped by createTemplate scope switch.
    const routeId = decodeURIComponent((routeProjectId || '').trim());
    if (currentId && routeId && routeId !== currentId) return;
    const text = pendingAutoSubmitRef.current;
    if (!text) return;
    if (modelsStatus === 'loading' || modelsStatus === 'idle') return;
    pendingAutoSubmitRef.current = null;
    send(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    holdAutoSubmit,
    modelsStatus,
    draftPrompt,
    location.search,
    currentId,
    routeProjectId,
  ]);

  const dismissPendingReview = (opts?: { dropCheckpoint?: boolean }) => {
    if (opts?.dropCheckpoint && pendingReview) {
      checkpointsRef.current.delete(pendingReview.userMessageId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingReview.userMessageId ? { ...m, canRestore: false } : m
        )
      );
    }
    setPendingReview(null);
  };

  const undoPendingReview = () => {
    if (!pendingReview) return;
    restoreCheckpoint(pendingReview.userMessageId);
  };

  const keepPendingReview = () => {
    dismissPendingReview({ dropCheckpoint: true });
  };

  const reviewPendingChanges = () => {
    if (!pendingReview) return;
    const el = listRef.current?.getScrollElement()?.querySelector(
      `[data-assistant-id="${CSS.escape(pendingReview.assistantId)}"]`
    );
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };


  const beginEditUserMessage = (m: ChatUiMessage) => {
    if (m.role !== 'user' || sending || m.streaming) return;
    setEditingUserId(m.id);
    // Legacy bubbles stored `@label\ntext` — strip leading @ lines when chips exist.
    let draft = m.content || '';
    if (m.contexts?.length) {
      const lines = draft.split('\n');
      while (lines[0]?.trim().startsWith('@')) lines.shift();
      draft = lines.join('\n').replace(/^\n+/, '');
      const rebuilt: ComposerContext[] = [];
      for (const c of m.contexts) {
        rebuilt.push(rebuildComposerChipFromSaved(document, c, rebuilt));
      }
      setContextChips(rebuilt);
      // Keep U+FFFC slots so the edit composer matches bubble chip order
      // (stripping markers used to dump every chip at the end).
      const inlineLen = rebuilt.filter((c) => c.kind !== 'attachment').length;
      if (m.contentMarked?.includes('\uFFFC')) {
        draft = m.contentMarked;
      } else if (inlineLen > 0) {
        draft = `${'\uFFFC'.repeat(inlineLen)}${draft}`;
      }
    } else {
      clearContextChips();
    }
    setEditDraft(draft);
    queueMicrotask(() => inputRef.current?.focus());
  };

  const cancelEditUserMessage = () => {
    setEditingUserId(null);
    setEditDraft('');
    clearContextChips();
  };

  const submitEditUserMessage = () => {
    const id = editingUserId;
    if (!id || sending) return;
    if (
      contextChips.some(
        (c) => c.kind === 'attachment' && c.uploadStatus === 'uploading'
      )
    ) {
      message.warning(t('agent.attachWaitUpload'));
      return;
    }
    // Prefer live DOM marked→plain (chips may still be mid-text); strip any leftover U+FFFC.
    const fromDom = String(inputRef.current?.getMarkedText?.() || '')
      .replace(/\uFFFC/g, '')
      .trim();
    const draft = (fromDom || editDraft.replace(/\uFFFC/g, '')).trim();
    if (!draft) return;
    const idx = messages.findIndex((x) => x.id === id);
    if (idx < 0) return;
    send({
      text: draft,
      priorMessages: messages.slice(0, idx),
    });
  };

  const restoreCheckpoint = (userMessageId: string) => {
    const snap = checkpointsRef.current.get(userMessageId);
    if (!snap) {
      message.warning(t('agent.checkpointInvalid'));
      return;
    }
    dispatch(setDocument(cloneDocument(snap) ?? snap));
    checkpointsRef.current.delete(userMessageId);
    setMessages((prev) =>
      prev.map((m) => (m.id === userMessageId ? { ...m, canRestore: false } : m))
    );
    // Bubble undo and Canvas updated Undo/Keep/Review share one checkpoint.
    setPendingReview((prev) =>
      prev?.userMessageId === userMessageId ? null : prev
    );
    message.success(t('agent.restored'));
  };

  const closePopovers = () => {
    setModelPanelOpen(false);
    setMentionPanelOpen(false);
    setMentionQuery('');
    setSkillPanelOpen(false);
    setSkillQuery('');
  };

  const handleToggleHistory = () => {
    closePopovers();
    setHistoryOpen((v) => {
      const next = !v;
      if (next) refreshSessions();
      return next;
    });
  };

  const handleHeaderClose = () => {
    abortRef.current?.abort();
    if (desktopShell && engineMode === 'cli') {
      async function killCodingCliOnClose() {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('kill_coding_cli');
        } catch {
          /* ignore */
        }
      }
      killCodingCliOnClose();
    }
    dispatch(setAgentBusy(false));
    setSending(false);
    closePopovers();
    setHistoryOpen(false);
    onClose();
  };

  const handleEngineModeChange = (mode: AgentEngineMode) => {
    setEngineMode(mode);
    persistEngineMode(mode);
  };

  const handleCodingCliChange = (id: string) => {
    setCodingCliId(id);
    persistCodingCliId(id);
  };

  const slashTriggerIndex = (value: string): number => {
    for (let i = value.length - 1; i >= 0; i -= 1) {
      if (value[i] !== '/') continue;
      if (/\s/.test(value.slice(i + 1))) return -1;
      if (i > 0 && !/\s/.test(value[i - 1]!)) continue;
      return i;
    }
    return -1;
  };

  /** `@` attachments or `/` skills — prefer the later trigger. */
  const maybeOpenComposerMentions = (value: string) => {
    if (onlyImageInteraction) {
      setMentionPanelOpen(false);
      setMentionQuery('');
      setSkillPanelOpen(false);
      setSkillQuery('');
      return;
    }
    const at = parseAtMentionQuery(value);
    const slash = parseSlashSkillQuery(value);
    const atIdx = at.open ? value.lastIndexOf('@') : -1;
    const slashIdx = slash.open ? slashTriggerIndex(value) : -1;
    const preferSkill = slash.open && (!at.open || slashIdx > atIdx);
    if (preferSkill) {
      setModelPanelOpen(false);
      setMentionPanelOpen(false);
      setMentionQuery('');
      setSkillQuery(slash.query);
      setSkillPanelOpen(true);
      loadSkillCatalog();
      return;
    }
    if (at.open) {
      setModelPanelOpen(false);
      setSkillPanelOpen(false);
      setSkillQuery('');
      setMentionQuery(at.query);
      setMentionPanelOpen(true);
      return;
    }
    setMentionPanelOpen(false);
    setMentionQuery('');
    setSkillPanelOpen(false);
    setSkillQuery('');
  };

  const mentionItems = useMemo((): MentionAttachItem[] => {
    const attachments = contextChips.filter((c) => c.kind === 'attachment');
    return attachments.map((c, i) => {
      const kind = composerAttachmentMediaKind(c);
      const thumb = String(c.thumbUrl || c.dataUrl || '').trim();
      return {
        id: c.key,
        label: mentionAttachKindLabel(kind, i + 1, t),
        ...(kind === 'image' && thumb ? { thumbUrl: thumb } : {}),
      };
    });
  }, [contextChips, t]);

  const skillMentionItems = useMemo((): MentionAttachItem[] => {
    const mineLabel = t('agent.skillsMine');
    const officialLabel = t('agent.skillsOfficial');
    return skillCatalog.map((s) => ({
      id: String(s.skillKey || ''),
      label: s.name,
      hint: s.whenToUse || undefined,
      group: s.mine ? mineLabel : officialLabel,
      ...(s.logo ? { thumbUrl: s.logo } : {}),
    }));
  }, [skillCatalog, t]);

  const insertMentionAttachChip = (att: ComposerContext, ordinal: number) => {
    const kind = composerAttachmentMediaKind(att);
    const ctx = buildAttachRefMentionContext(
      att,
      mentionAttachKindLabel(kind, ordinal, t),
      mentionAttachRefPayload(kind, ordinal)
    );
    pinnedContextKeysRef.current.add(ctx.key);
    contextDismissedKeyRef.current = null;
    if (editingUserId) setEditDraft(stripTrailingAtQuery);
    else setInput(stripTrailingAtQuery);
    setMentionPanelOpen(false);
    setMentionQuery('');
    queueMicrotask(() => {
      inputRef.current?.insertContextAtCaret(ctx);
      inputRef.current?.focus();
    });
  };

  const pickMentionAttach = (pickId: string) => {
    const attachments = contextChipsRef.current.filter((c) => c.kind === 'attachment');
    const idx = attachments.findIndex((c) => c.key === pickId);
    if (idx < 0) return;
    insertMentionAttachChip(attachments[idx]!, idx + 1);
  };

  const pickMentionLibraryAsset = (asset: UserAsset) => {
    const kind = normalizeMediaAssetKind(asset.kind);
    const upserted = upsertLibraryAssetAttachment(
      contextChipsRef.current,
      asset,
      mediaAssetKindFallbackLabel(kind, t)
    );
    if (!upserted) return;
    pinnedContextKeysRef.current.add(upserted.attachment.key);
    setContextChips(upserted.contexts);
    contextChipsRef.current = upserted.contexts;
    insertMentionAttachChip(upserted.attachment, upserted.ordinal);
  };

  const pickSkillMention = (pickId: string) => {
    const skill = skillCatalog.find((s) => String(s.skillKey) === pickId);
    if (!skill) return;
    const key = String(skill.skillKey);
    const ctx: ComposerContext = {
      key: `skill:${key}`,
      label: skill.name,
      kind: 'skill',
      payload: key,
      ...(skill.logo ? { thumbUrl: skill.logo } : {}),
    };
    pinnedContextKeysRef.current.add(ctx.key);
    contextDismissedKeyRef.current = null;
    if (editingUserId) setEditDraft(stripTrailingSlashQuery);
    else setInput(stripTrailingSlashQuery);
    setSkillPanelOpen(false);
    setSkillQuery('');
    queueMicrotask(() => {
      inputRef.current?.insertContextAtCaret(ctx);
      inputRef.current?.focus();
    });
  };

  const onInputChange = (value: string) => {
    setInput(value);
    maybeOpenComposerMentions(value);
  };

  const onEditDraftChange = (value: string) => {
    setEditDraft(value);
    maybeOpenComposerMentions(value);
  };

  const applyInteractionMode = useCallback((mode: ComposerInteractionMode) => {
    // Product: one ChatGPT-style chat. Ask is retired; image/video only via home category boot.
    if (mode === 'ask') {
      setInteractionMode('agent');
      setComposerMode('agent');
      setModel('auto');
      setImageModelPanelOpen(false);
      setVideoModelPanelOpen(false);
      setModelPanelOpen(false);
      return;
    }
    setInteractionMode(mode);
    setImageModelPanelOpen(false);
    setVideoModelPanelOpen(false);
    setModelPanelOpen(false);
    if (mode === 'video') {
      setComposerMode('video');
      if (!canPickModel) {
        setModel(cloudVideoFallbackId() || 'auto');
        return;
      }
      setModel(pickPreferredVideoModelId(models, model));
      return;
    }
    if (mode === 'image') {
      setComposerMode('image');
      if (!canPickModel) {
        setModel(cloudImageFallbackId() || 'auto');
        return;
      }
      setModel(pickPreferredImageModelId(models, model));
      return;
    }
    setComposerMode('agent');
    setModel('auto');
  }, [canPickModel, models, model]);

  useEffect(() => {
    if (enabledInteractionModes.includes(interactionMode)) return;
    applyInteractionMode(enabledInteractionModes[enabledInteractionModes.length - 1] || 'image');
  }, [enabledInteractionModes, interactionMode, applyInteractionMode]);

  useEffect(() => {
    if (!onlyImageInteraction) return;
    setModelPanelOpen(false);
    setMentionPanelOpen(false);
    setSkillPanelOpen(false);
    setImageModelPanelOpen(false);
    setVideoModelPanelOpen(false);
  }, [onlyImageInteraction]);

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
  const mentionSetPositionReference = useRef(mentionFloating.refs.setPositionReference);
  mentionSetPositionReference.current = mentionFloating.refs.setPositionReference;

  const skillFloating = useFloating({
    open: skillPanelOpen,
    onOpenChange: (open) => {
      setSkillPanelOpen(open);
      if (!open) setSkillQuery('');
      else loadSkillCatalog();
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
  const skillDismiss = useDismiss(skillFloating.context);
  const skillIx = useInteractions([skillDismiss]);
  const skillSetPositionReference = useRef(skillFloating.refs.setPositionReference);
  skillSetPositionReference.current = skillFloating.refs.setPositionReference;

  /** Anchor pickers to the caret without updating the reference on every keystroke. */
  useLayoutEffect(() => {
    if (!mentionPanelOpen) return;
    const editor =
      (window.document.querySelector(
        '[data-fly-land="agent"] [data-agent-composer], [data-fly-land="agent"][data-agent-composer-root]'
      ) as HTMLElement | null) ||
      (window.document.querySelector('[data-tour="editor-agent"] [data-agent-composer]') as HTMLElement | null);
    mentionSetPositionReference.current({
      contextElement: editor,
      getBoundingClientRect: () =>
        inputRef.current?.getAtMentionAnchorRect?.() ?? editor?.getBoundingClientRect() ?? new DOMRect(),
    });
  }, [mentionPanelOpen]);

  useLayoutEffect(() => {
    if (!skillPanelOpen) return;
    const editor =
      (window.document.querySelector(
        '[data-fly-land="agent"] [data-agent-composer], [data-fly-land="agent"][data-agent-composer-root]'
      ) as HTMLElement | null) ||
      (window.document.querySelector('[data-tour="editor-agent"] [data-agent-composer]') as HTMLElement | null);
    skillSetPositionReference.current({
      contextElement: editor,
      getBoundingClientRect: () =>
        inputRef.current?.getSlashMentionAnchorRect?.() ?? editor?.getBoundingClientRect() ?? new DOMRect(),
    });
  }, [skillPanelOpen]);

  if (!open) return null;

  const askPlaceholder = [...messages]
    .reverse()
    .find(
      (m) =>
        m.role === 'assistant' &&
        (m.proposedOps?.length || m.choiceUi) &&
        !m.streaming
    )?.choiceUi?.placeholder;

  const composerPlaceholder = resolveComposerPlaceholder(t, {
    isImageModel: isImageModelSelected,
    isImageMode: isImageInteraction,
    isVideoMode: isVideoInteraction,
    hasContextChips: contextChips.length > 0,
    askPlaceholder,
  });

  const imageModeControls = buildImageModeControls({
    active: isImageInteraction,
    models,
    modelId: model,
    modelsStatus,
    resolution: imageResolution,
    aspectRatio: imageGenAspectRatio,
    imageCount: imageGenCountSetting,
    modelOpen: imageModelPanelOpen,
    onResolutionChange: (r) => setImageResolution(r as typeof imageResolution),
    onAspectRatioChange: (r) => setImageGenAspectRatio(r as typeof imageGenAspectRatio),
    onImageCountChange: (n) => setImageGenCountSetting(clampComposerImageCount(n)),
    onModelOpenChange: setImageModelPanelOpen,
    onPickModel: (id) => {
      setModel(id);
      setComposerMode('image');
      setImageModelPanelOpen(false);
    },
  });

  const videoModeControls = buildVideoModeControls({
    active: isVideoInteraction,
    models,
    modelId: model,
    modelsStatus,
    resolution: videoResolution,
    aspectRatio: videoGenAspectRatio,
    duration: videoGenDuration,
    modelOpen: videoModelPanelOpen,
    onResolutionChange: setVideoResolution,
    onAspectRatioChange: setVideoGenAspectRatio,
    onDurationChange: (d) =>
      setVideoGenDuration(Math.max(1, Math.round(d) || DEFAULT_VIDEO_DURATION)),
    onModelOpenChange: setVideoModelPanelOpen,
    onPickModel: (id) => {
      setModel(id);
      setComposerMode('video');
      setVideoModelPanelOpen(false);
    },
  });

  const modelButtonProps = {
    label: modelButtonLabel(model, selectedModel, selectedModelLabel, t),
    labelSuffix: t(`agent.designIntensity.${designIntensity}.short`),
    variant: 'chip' as const,
    open: modelPanelOpen,
    onOpenChange: (next: boolean) => {
      if (next) {
        setMentionPanelOpen(false);
        setMentionQuery('');
      }
      setModelPanelOpen(next);
    },
    // Dropdown keeps portal mounted when closed — only mount prefs (catalog/models) when open.
    panel: modelPanelOpen ? (
      <AgentRoutePrefsEditor
        compact
        selectedModelId={model}
        autoOnly={!canPickModel}
        onPickModel={(id) => {
          setModel(id);
        }}
      />
    ) : (
      <span className="hidden" aria-hidden />
    ),
  };

  const escapeComposer = (opts?: { cancelEdit?: boolean }) => {
    if (mentionPanelOpen || skillPanelOpen || modelPanelOpen) {
      closePopovers();
      return;
    }
    if (contextChips.length) {
      clearContextChips({ purgeUploads: true });
      return;
    }
    if (opts?.cancelEdit) cancelEditUserMessage();
    else closePopovers();
  };

  const editComposerNode = editingUserId ? (
      <AgentComposerShell
        inputRef={inputRef}
        contexts={contextChips}
        onContextsChange={onContextsChange}
        value={editDraft}
        onChange={onEditDraftChange}
        onSubmit={() => submitEditUserMessage()}
        onEscape={() => escapeComposer({ cancelEdit: true })}
        sending={sending}
        onStop={stopGeneration}
        disabled={false}
        placeholder={composerPlaceholder}
        flyLandId="agent"
        canSend={
          !sending &&
          !!editDraft.replace(/\uFFFC/g, '').trim() &&
          !attachmentsUploading &&
          available !== false
        }
        sendVariant="circle"
        sendTone="ink"
        {...attachProps}
        interactionMode={interactionMode}
        onInteractionModeChange={applyInteractionMode}
        allowedInteractionModes={enabledInteractionModes}
        showInteractionModePicker
        imageModeControls={imageModeControls}
        videoModeControls={videoModeControls}
        modelButtonProps={modelButtonProps}
        {...imageAspectProps}
      />
  ) : null;

  return (
    <aside
      data-tour={dataTour}
      style={floating ? undefined : { width: dockWidth }}
      className={cn(
        floating
          ? 'fixed inset-x-0 bottom-0 top-0 z-50 flex flex-col overflow-hidden bg-[var(--surface)]'
          : 'relative flex shrink-0 flex-col overflow-hidden border-l border-[var(--line)] bg-[var(--surface)]',
        className
      )}
    >
      {!floating ? (
        <AgentDockResizeHandle
          width={dockWidth}
          minWidth={AGENT_DOCK_MIN_W}
          maxWidth={AGENT_DOCK_MAX_W}
          onPointerDown={onDockResizePointerDown}
          onPointerMove={onDockResizePointerMove}
          onPointerUp={endDockResize}
          onPointerCancel={endDockResize}
          onResetWidth={() => persistDockWidth(AGENT_DOCK_DEFAULT_W)}
        />
      ) : null}
      <AgentDockHeader
        title={chatTitle}
        historyOpen={historyOpen}
        showNewChatTip={!onlyImageInteraction && newChatTip}
        showClose={!floating}
        onNewChat={startNewChat}
        onToggleHistory={handleToggleHistory}
        onClose={handleHeaderClose}
        engineMode={desktopShell ? engineMode : undefined}
        onEngineModeChange={desktopShell ? handleEngineModeChange : undefined}
        codingClis={desktopShell ? codingClis : undefined}
        codingCliId={desktopShell ? codingCliId : undefined}
        onCodingCliChange={desktopShell ? handleCodingCliChange : undefined}
      />

      <AgentMessageList
        ref={listRef}
        historyOpen={historyOpen}
        sessions={sessions}
        sessionId={sessionId}
        turns={chatTurns}
        editingUserId={editingUserId}
        editComposer={editComposerNode}
        sending={sending}
        formatWorked={formatWorked}
        hasCheckpoint={(id) => checkpointsRef.current.has(id)}
        onBeginEdit={beginEditUserMessage}
        onCancelEdit={cancelEditUserMessage}
        onRestore={restoreCheckpoint}
        onChoice={handleAskChoice}
        onResume={(id) => {
          resumeGeneration(id);
        }}
        onOpenSession={openSession}
        onDeleteSession={deleteSession}
        formatChatTime={formatChatTime}
      />

      {historyOpen || editingUserId ? null : (
        <AgentDockComposerFooter
          pendingReview={Boolean(pendingReview && !sending)}
          onUndoReview={undoPendingReview}
          onKeepReview={keepPendingReview}
          onReview={reviewPendingChanges}
          pendingLongSuggestions={!sending ? pendingLongSuggestions : []}
          onIgnoreLongSuggestion={(i) =>
            setPendingLongSuggestions((prev) => prev.filter((_, j) => j !== i))
          }
          onSavedLongSuggestion={(i) =>
            setPendingLongSuggestions((prev) => prev.filter((_, j) => j !== i))
          }
          composer={
            <AgentComposerShell
              className="min-h-[120px] rounded-none border-0 shadow-none"
              inputRef={inputRef}
              contexts={contextChips}
              onContextsChange={onContextsChange}
              value={input}
              onChange={onInputChange}
              onSubmit={() => send()}
              onEscape={() => escapeComposer()}
              sending={sending}
              onStop={stopGeneration}
              placeholder={composerPlaceholder}
              flyLandId="agent"
              canSend={
                !sending &&
                (!!input.trim() || contextChips.length > 0) &&
                !attachmentsUploading &&
                available !== false
              }
              sendDisabledReason={composerSendDisabledReason({
                t,
                attachmentsUploading,
                hasContent: Boolean(input.trim() || contextChips.length),
                available,
                modelsStatus,
              })}
              sendVariant="circle"
              sendTone="ink"
              {...attachProps}
              interactionMode={interactionMode}
              onInteractionModeChange={applyInteractionMode}
              allowedInteractionModes={enabledInteractionModes}
              showInteractionModePicker
              imageModeControls={imageModeControls}
              videoModeControls={videoModeControls}
              modelButtonProps={modelButtonProps}
              {...imageAspectProps}
            />
          }
        />
      )}

      <AgentDockFloatingPanels
        historyOpen={historyOpen}
        mentionPanelOpen={mentionPanelOpen}
        skillPanelOpen={skillPanelOpen}
        mentionFloating={mentionFloating}
        mentionIx={mentionIx}
        mentionItems={mentionItems}
        mentionQuery={mentionQuery}
        onPickMention={pickMentionAttach}
        onPickMentionLibraryAsset={pickMentionLibraryAsset}
        skillFloating={skillFloating}
        skillIx={skillIx}
        skillMentionItems={skillMentionItems}
        skillQuery={skillQuery}
        onPickSkillMention={pickSkillMention}
      />
    </aside>
  );
}

export default memo(AgentDock);
