import { createElement } from 'react';
import type { LlmModel } from '@/service/chat';
import { getHttpErrorMessage } from '@/service/client';
import type { DesignScene } from '@/service/design';
import {
  chipBaseKey,
  type ComposerContext,
} from '@/components/editor/panels/AgentComposerInput';
import { isMarkContextKey } from '@/components/editor/nodes/ImageNode/mark/markChipSync';
import type {
  AudioModeComposerControls,
  ImageModeComposerControls,
  LottieModeComposerControls,
  VideoModeComposerControls,
} from '@/components/editor/panels/agent/composer/AgentComposerShell';
import {
  DEFAULT_LOTTIE_ASPECT,
} from '@/components/editor/panels/agent/shared/AnimationSettingsPanel';
import {
  modelIsAudioGenerator,
} from '@/components/editor/nodes/shared/generatorModelLists';
import {
  type AskChoicePick,
  type ChatUiMessage,
} from '@/components/editor/panels/agent/messages/ChatTurnList';
import { type CanvasUiBridge } from '@/components/editor/panels/agent/designTools';
import {
  DEFAULT_IMAGE_QUALITY,
  modelImageLimits,
} from '@/components/editor/panels/agent/shared/ImageAspectRatioPicker';
import {
  cloudImageFallbackId,
  cloudVideoFallbackId,
  isImageKind,
  isVideoKind,
} from '@/components/editor/panels/agent/llmModelMeta';
import ModelPickerPanel, {
  ModelBrandIcon,
} from '@/components/editor/panels/agent/models/ModelPickerPanel';
import {
  buildSceneFramesSnapshot,
  buildSceneNodesForCanvas,
  buildSpatialSummary,
  frameIdContainingNode,
  nodeIdsInsideFrame,
  resolveDesignTargetFrame,
} from '@/components/editor/panels/agent/runDesignAgent';
import {
  estimateAudioCredits,
  estimateImageCredits,
  estimateLottieCredits,
  estimateVideoCredits,
} from '@/utils/imageCredits';
import type { SceneDocument } from '@/components/rcb/sceneNode';

function resolveSeedLiveNodeIds(opts: {
  doc: SceneDocument;
  editTarget: { id: string } | null;
  freeCanvasMention: boolean;
  mentionNodeIds: string[];
}): string[] {
  const { doc, editTarget, freeCanvasMention, mentionNodeIds } = opts;
  if (editTarget && doc) return nodeIdsInsideFrame(doc, editTarget.id);
  if (freeCanvasMention && doc) return mentionNodeIds;
  return [];
}

function isHttpUrl(s: string): boolean {
  return s.startsWith('http://') || s.startsWith('https://');
}

function preferredChipThumbUrl(c: ComposerContext): string {
  const dataRef = String(c.dataUrl || '').trim();
  const thumb = String(c.thumbUrl || '').trim();
  if (isHttpUrl(dataRef)) return dataRef;
  if (isHttpUrl(thumb)) return thumb;
  if (dataRef.startsWith('data:image/') || dataRef.startsWith('blob:')) return dataRef;
  if (thumb.startsWith('data:image/') || thumb.startsWith('blob:')) return thumb;
  return dataRef || thumb;
}

function chipToBubbleContext(c: ComposerContext) {
  const preferred = preferredChipThumbUrl(c);
  const mark = isMarkContextKey(c.key);
  const textSnippet = c.kind === 'text' || String(c.key || '').startsWith('text-snippet:');
  return {
    key: chipBaseKey(c.key),
    label: c.label,
    kind: c.kind,
    ...(preferred ? { thumbUrl: preferred } : {}),
    ...(mark && c.payload ? { payload: c.payload } : {}),
    ...(mark && c.appendText ? { appendText: c.appendText } : {}),
    ...(textSnippet && c.payload ? { payload: c.payload } : {}),
  };
}

export function resolveSendDisplayText(opts: {
  text: string;
  hasChips: boolean;
  hasApplyOps: boolean;
}): string {
  if (opts.text) return opts.text;
  if (opts.hasApplyOps || !opts.hasChips) return 'apply';
  return '';
}

export function askProposalBind(m: ChatUiMessage | undefined | null): {
  proposalId?: string;
  proposalTaskId?: string;
} {
  if (!m) return {};
  return {
    ...(m.proposalId ? { proposalId: m.proposalId } : {}),
    ...(m.designTaskId ? { proposalTaskId: m.designTaskId } : {}),
  };
}

export function clearAskProposalFields(m: ChatUiMessage): ChatUiMessage {
  if (m.role !== 'assistant') return m;
  if (
    !(
      m.proposedOps?.length ||
      m.choiceUi ||
      m.proposalId
    )
  ) {
    return m;
  }
  return {
    ...m,
    proposedOps: undefined,
    proposalId: undefined,
    choiceUi: undefined,
  };
}

export function findLastAskMessage(messages: ChatUiMessage[]): ChatUiMessage | undefined {
  return [...messages]
    .reverse()
    .find(
      (m) =>
        m.role === 'assistant' &&
        Boolean(m.proposedOps?.length || m.choiceUi)
    );
}

export type AskChoiceSend =
  | { kind: 'noop' }
  | { kind: 'dismiss'; messageId: string }
  | {
      kind: 'apply';
      messageId: string;
      text: string;
      ops: NonNullable<ChatUiMessage['proposedOps']>;
      proposalId?: string;
      proposalTaskId?: string;
    }
  | { kind: 'reply'; text: string; displayText?: string };

export function resolveAskChoiceSend(
  messages: ChatUiMessage[],
  pick: AskChoicePick
): AskChoiceSend {
  const lastAsk = findLastAskMessage(messages);
  if (pick.action === 'dismiss') {
    return lastAsk ? { kind: 'dismiss', messageId: lastAsk.id } : { kind: 'noop' };
  }
  if (pick.action === 'apply' && lastAsk?.proposedOps?.length) {
    const text = pick.selectedLabels?.length
      ? `${pick.label}：${pick.selectedLabels.join('、')}`
      : pick.label;
    return {
      kind: 'apply',
      messageId: lastAsk.id,
      text,
      ops: lastAsk.proposedOps,
      ...askProposalBind(lastAsk),
    };
  }
  const text = pick.selectedLabels?.length
    ? pick.selectedLabels.join('、')
    : pick.label;
  if (!text) return { kind: 'noop' };
  const targetId = String(pick.value || '').trim();
  return targetId
    ? {
        kind: 'reply',
        text: `${text}\n\n[Target element — selected from clarification]\nid: ${targetId}`,
        displayText: text,
      }
    : { kind: 'reply', text };
}

export function splitBubbleContexts(chips: ComposerContext[]) {
  const inline = chips.filter((c) => c.kind !== 'attachment').map(chipToBubbleContext);
  const attachments = chips.filter((c) => c.kind === 'attachment').map(chipToBubbleContext);
  return {
    inlineContexts: inline,
    attachmentContexts: attachments,
    bubbleContexts: [...attachments, ...inline],
  };
}

export function shouldRunImageGenPath(opts: {
  isImageModelSelected: boolean;
  forceAgent: boolean;
  hasApplyOps: boolean;
}): boolean {
  return shouldRunDirectGenPath(
    opts.isImageModelSelected,
    opts.forceAgent,
    opts.hasApplyOps
  );
}

/** Video / audio / lottie composer modes share the same gating rules. */
export function shouldRunDirectGenPath(
  active: boolean,
  forceAgent: boolean,
  hasApplyOps: boolean
): boolean {
  return active && !forceAgent && !hasApplyOps;
}

export function shouldRunVideoGenPath(opts: {
  isVideoModelSelected: boolean;
  forceAgent: boolean;
  hasApplyOps: boolean;
}): boolean {
  return shouldRunDirectGenPath(
    opts.isVideoModelSelected,
    opts.forceAgent,
    opts.hasApplyOps
  );
}

export function shouldRunAudioGenPath(opts: {
  isAudioModelSelected: boolean;
  forceAgent: boolean;
  hasApplyOps: boolean;
}): boolean {
  return shouldRunDirectGenPath(
    opts.isAudioModelSelected,
    opts.forceAgent,
    opts.hasApplyOps
  );
}

export function shouldRunLottieGenPath(opts: {
  isLottieModelSelected: boolean;
  forceAgent: boolean;
  hasApplyOps: boolean;
}): boolean {
  return shouldRunDirectGenPath(
    opts.isLottieModelSelected,
    opts.forceAgent,
    opts.hasApplyOps
  );
}

type GeneratedMediaUrls = {
  videos?: unknown[];
  audios?: unknown[];
  images?: unknown[];
  text?: string | null;
  assets?: Array<{ url?: string | null } | null> | null;
  asset?: { url?: string | null } | null;
};

/** Optional model reply text bundled with image/video job results. */
export function pickGeneratedMediaText(
  res: { text?: string | null | undefined } | null | undefined
): string {
  return String(res?.text || '').trim();
}

function firstListMediaUrl(
  res: GeneratedMediaUrls,
  key: 'videos' | 'audios' | 'images'
): string {
  for (const u of res[key] || []) {
    if (typeof u === 'string' && u.trim()) return u.trim();
  }
  return firstAssetUrl(res);
}

function firstAssetUrl(res: GeneratedMediaUrls): string {
  const direct = typeof res.asset?.url === 'string' ? res.asset.url.trim() : '';
  if (direct) return direct;
  for (const a of res.assets || []) {
    const u = typeof a?.url === 'string' ? a.url.trim() : '';
    if (u) return u;
  }
  return '';
}

export function firstGeneratedAudioUrl(res: GeneratedMediaUrls): string {
  return firstListMediaUrl(res, 'audios');
}

export function firstGeneratedLottieUrl(res: GeneratedMediaUrls): string {
  return firstAssetUrl(res);
}

export function firstGeneratedVideoUrl(res: GeneratedMediaUrls): string {
  return firstListMediaUrl(res, 'videos');
}

export function firstGeneratedImageUrl(res: GeneratedMediaUrls): string {
  return firstListMediaUrl(res, 'images');
}

function pickCatalogModel(
  pool: LlmModel[],
  selectedId: string
): LlmModel | undefined {
  const id = String(selectedId || '').trim();
  if (id) return pool.find((m) => m.id === id);
  return pool[0];
}

export function clampComposerImageCount(n: number): 1 | 2 | 3 | 4 {
  return Math.max(1, Math.min(4, Math.round(n) || 1)) as 1 | 2 | 3 | 4;
}

export function buildImageModeControls(opts: {
  active: boolean;
  models: LlmModel[];
  modelId: string;
  modelsStatus: 'idle' | 'loading' | 'ready' | 'error';
  resolution: string;
  aspectRatio: string;
  imageCount: 1 | 2 | 3 | 4;
  modelOpen: boolean;
  onResolutionChange: (r: string) => void;
  onAspectRatioChange: (r: string) => void;
  onImageCountChange: (n: number) => void;
  onModelOpenChange: (open: boolean) => void;
  onPickModel: (id: string) => void;
}): ImageModeComposerControls | null {
  if (!opts.active) return null;
  const pool = opts.models.filter((m) => isImageKind(m));
  const selected = pickCatalogModel(pool, opts.modelId);
  return {
    resolution: opts.resolution,
    aspectRatio: opts.aspectRatio,
    imageCount: opts.imageCount,
    onResolutionChange: opts.onResolutionChange,
    onAspectRatioChange: opts.onAspectRatioChange,
    onImageCountChange: (n) => opts.onImageCountChange(clampComposerImageCount(n)),
    imageLimits: selected ? modelImageLimits(selected) : null,
    creditCost: selected ? estimateImageCredits(selected, opts.imageCount, opts.resolution) : 0,
    modelLabel: String(selected?.label || opts.modelId || ''),
    modelIcon: selected
      ? createElement(ModelBrandIcon, {
          model: selected,
          className: 'h-3.5 w-3.5 shrink-0',
        })
      : undefined,
    modelOpen: opts.modelOpen,
    onModelOpenChange: opts.onModelOpenChange,
    modelPanel: createElement(ModelPickerPanel, {
      tab: 'image',
      models: opts.models,
      selectedId: opts.modelId,
      status: opts.modelsStatus,
      onPick: opts.onPickModel,
    }),
  };
}

export function lottieGenDimensions(aspectRatio: string): { width: number; height: number } {
  const s = String(aspectRatio || DEFAULT_LOTTIE_ASPECT).trim();
  let rw = 1;
  let rh = 1;
  const m = /^(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)$/i.exec(s);
  if (m) {
    rw = Math.max(0.01, Number(m[1]));
    rh = Math.max(0.01, Number(m[2]));
  }
  const ratio = rw / rh;
  const area = 256 * 256;
  let height = Math.sqrt(area / ratio);
  let width = height * ratio;
  width = Math.min(512, Math.max(32, Math.round(width)));
  height = Math.min(512, Math.max(32, Math.round(height)));
  return { width, height };
}

export function buildAudioModeControls(opts: {
  active: boolean;
  models: LlmModel[];
  modelId: string;
  modelsStatus: 'idle' | 'loading' | 'ready' | 'error';
  modelOpen: boolean;
  onModelOpenChange: (open: boolean) => void;
  onPickModel: (id: string) => void;
}): AudioModeComposerControls | null {
  if (!opts.active) return null;
  const pool = opts.models.filter((m) => modelIsAudioGenerator(m));
  const selected = pickCatalogModel(pool, opts.modelId);
  return {
    creditCost: selected ? estimateAudioCredits(selected) : 0,
    modelLabel: String(selected?.label || opts.modelId || ''),
    modelIcon: selected
      ? createElement(ModelBrandIcon, {
          model: selected,
          className: 'h-3.5 w-3.5 shrink-0',
        })
      : undefined,
    modelOpen: opts.modelOpen,
    onModelOpenChange: opts.onModelOpenChange,
    modelPanel: createElement(ModelPickerPanel, {
      tab: 'video',
      models: opts.models,
      selectedId: opts.modelId,
      status: opts.modelsStatus,
      hideAuto: true,
      useModelsAsIs: true,
      onPick: opts.onPickModel,
    }),
  };
}

export function buildLottieModeControls(opts: {
  active: boolean;
  models: LlmModel[];
  modelId: string;
  modelsStatus: 'idle' | 'loading' | 'ready' | 'error';
  aspectRatio: string;
  duration: number;
  modelOpen: boolean;
  onAspectRatioChange: (ratio: string) => void;
  onDurationChange: (duration: number) => void;
  onModelOpenChange: (open: boolean) => void;
  onPickModel: (id: string) => void;
}): LottieModeComposerControls | null {
  if (!opts.active) return null;
  const selected = pickCatalogModel(opts.models, opts.modelId);
  return {
    aspectRatio: opts.aspectRatio,
    duration: opts.duration,
    onAspectRatioChange: opts.onAspectRatioChange,
    onDurationChange: opts.onDurationChange,
    creditCost: selected ? estimateLottieCredits(selected, opts.duration) : 0,
    modelLabel: String(selected?.label || opts.modelId || ''),
    modelIcon: selected
      ? createElement(ModelBrandIcon, {
          model: selected,
          className: 'h-3.5 w-3.5 shrink-0',
        })
      : undefined,
    modelOpen: opts.modelOpen,
    onModelOpenChange: opts.onModelOpenChange,
    modelPanel: createElement(ModelPickerPanel, {
      tab: 'design',
      models: opts.models,
      selectedId: opts.modelId,
      status: opts.modelsStatus,
      hideAuto: true,
      useModelsAsIs: true,
      onPick: opts.onPickModel,
    }),
  };
}

export function buildVideoModeControls(opts: {
  active: boolean;
  models: LlmModel[];
  modelId: string;
  modelsStatus: 'idle' | 'loading' | 'ready' | 'error';
  resolution: string;
  aspectRatio: string;
  duration: number;
  modelOpen: boolean;
  onResolutionChange: (r: string) => void;
  onAspectRatioChange: (r: string) => void;
  onDurationChange: (d: number) => void;
  onModelOpenChange: (open: boolean) => void;
  onPickModel: (id: string) => void;
}): VideoModeComposerControls | null {
  if (!opts.active) return null;
  const pool = opts.models.filter((m) => isVideoKind(m));
  const selected = pickCatalogModel(pool, opts.modelId);
  return {
    resolution: opts.resolution,
    aspectRatio: opts.aspectRatio,
    duration: opts.duration,
    onResolutionChange: opts.onResolutionChange,
    onAspectRatioChange: opts.onAspectRatioChange,
    onDurationChange: opts.onDurationChange,
    creditCost: selected ? estimateVideoCredits(selected) : 0,
    modelLabel: String(selected?.label || opts.modelId || ''),
    modelIcon: selected
      ? createElement(ModelBrandIcon, {
          model: selected,
          className: 'h-3.5 w-3.5 shrink-0',
        })
      : undefined,
    modelOpen: opts.modelOpen,
    onModelOpenChange: opts.onModelOpenChange,
    modelPanel: createElement(ModelPickerPanel, {
      tab: 'video',
      models: opts.models,
      selectedId: opts.modelId,
      status: opts.modelsStatus,
      onPick: opts.onPickModel,
    }),
  };
}

export function buildImageGenRequestBody(opts: {
  prompt: string;
  canPickModel: boolean;
  model: string;
  aspect?: string;
  resolution?: string;
  isImageInteraction: boolean;
  attachedImages: string[];
}): {
  prompt: string;
  model?: string;
  aspect_ratio?: string;
  quality?: string;
  resolution?: string;
  images?: string[];
} {
  const body: {
    prompt: string;
    model?: string;
    aspect_ratio?: string;
    quality?: string;
    resolution?: string;
    images?: string[];
  } = { prompt: opts.prompt };
  if (!opts.canPickModel) body.model = cloudImageFallbackId() || undefined;
  else if (opts.model) body.model = opts.model;
  if (opts.aspect) body.aspect_ratio = opts.aspect;
  if (opts.resolution) body.resolution = opts.resolution;
  if (opts.isImageInteraction) body.quality = DEFAULT_IMAGE_QUALITY;
  if (opts.attachedImages.length) body.images = opts.attachedImages;
  return body;
}

/** Merge mark / mention / attachment refs for image-generation `images[]`. */
export function collectComposerRefImages(
  chips: ComposerContext[],
  primarySrc?: string
): string[] {
  const out: string[] = [];
  const primary = String(primarySrc || '').trim();
  if (primary) out.push(primary);
  for (const c of chips) {
    if (c.kind === 'skill') continue;
    const src = String(c.dataUrl || c.thumbUrl || '').trim();
    if (!src) continue;
    if (
      c.kind === 'attachment' ||
      c.kind === 'image' ||
      src.startsWith('data:image/') ||
      src.startsWith('http') ||
      src.startsWith('/')
    ) {
      out.push(src);
    }
  }
  return uniqueVisionUrls(out, 8);
}

/** Agent / quick-edit: inline chip payloads + user text → model prompt. */
export function buildComposerChipPrompt(chips: ComposerContext[], userText: string): string {
  const parts: string[] = [];
  let attachIdx = 0;
  for (const c of chips) {
    if (c.kind === 'attachment') {
      attachIdx += 1;
      const payload = String(c.payload || '').trim();
      if (payload) parts.push(`${payload}\nattachment_index: ${attachIdx}`);
      else parts.push(`[Attached image ${attachIdx}]\nname: ${c.label}`);
      continue;
    }
    if (c.kind === 'skill') continue;
    const payload = String(c.payload || '').trim();
    if (payload) parts.push(payload);
  }
  const text = String(userText || '').trim();
  if (text) parts.push(`User request:\n${text}`);
  return parts.join('\n\n');
}

export function uniqueVisionUrls(urls: Array<string | null | undefined>, max = 4): string[] {
  return urls
    .filter((u): u is string => Boolean(u))
    .filter((u, i, arr) => arr.indexOf(u) === i)
    .slice(0, max);
}

/** Prefer open 动画工作台 timeline over ambient chip. */
export function resolveDesignFocusFrameId(opts: {
  freeCanvasMention: boolean;
  editTargetId: string | null | undefined;
  chipFrameId: string | null | undefined;
  /** Open 动画工作台 timeline — preferred over ambient chip. */
  animationWorkbenchFrameId?: string | null;
}): string | null {
  if (opts.freeCanvasMention) return null;
  const workbench = String(opts.animationWorkbenchFrameId || '').trim();
  if (workbench) return workbench;
  return opts.chipFrameId || null;
}

export type ImageGenFinishKind = 'aborted' | 'failed' | 'success';

export function resolveImageGenFinishKind(opts: {
  aborted: boolean;
  urls: string[];
}): ImageGenFinishKind {
  if (opts.aborted) return 'aborted';
  if (!opts.urls.length) return 'failed';
  return 'success';
}

/** User-facing chat image/video job error — display backend message as-is. */
export function formatChatMediaError(
  t: (key: string, opts?: Record<string, unknown>) => string,
  err: unknown
): string {
  const msg = getHttpErrorMessage(err, '').trim();
  if (msg) return msg;
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return t('agent.requestFailed');
}

export function mergeLongSuggestions<T extends { text: string }>(
  prev: T[],
  incoming: T[] | undefined
): T[] {
  if (!incoming?.length) return prev;
  return [
    ...prev,
    ...incoming.filter((s) => !prev.some((p) => p.text === s.text)),
  ];
}

export type SendChipContext = {
  frameChip: ComposerContext | undefined;
  chipFrameId: string | null;
  mentionNodeIds: string[];
  attachedImages: string[];
  mentionImageSrcs: string[];
  skillRefs: string[];
};

export function collectSendChipContext(chips: ComposerContext[]): SendChipContext {
  const frameChip = chips.find((c) => c.kind === 'frame');
  const chipFrameId = frameChip
    ? chipBaseKey(frameChip.key).replace(/^frame:/, '')
    : null;
  const nodeChipIds = [
    ...new Set(
      chips
        .map((c) => chipBaseKey(c.key))
        .filter((k) => k.startsWith('node:'))
        .map((k) => k.replace(/^node:/, ''))
        .filter(Boolean)
    ),
  ];
  // Mark chips: `mark:{nodeId}:{regionId}` → treat parent image as @ target.
  const markNodeIds = [
    ...new Set(
      chips
        .map((c) => chipBaseKey(c.key))
        .filter((k) => k.startsWith('mark:'))
        .map((k) => k.slice('mark:'.length).split(':')[0]?.trim() || '')
        .filter(Boolean)
    ),
  ];
  const groupChip = chips.find((c) => c.kind === 'group' || c.kind === 'multi');
  const groupMemberIds = groupChip
    ? chipBaseKey(groupChip.key)
        .replace(/^group:/, '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  let mentionNodeIds = groupMemberIds;
  if (nodeChipIds.length) mentionNodeIds = [...new Set([...nodeChipIds, ...markNodeIds])];
  else if (markNodeIds.length) mentionNodeIds = markNodeIds;
  const attachedImages = chips
    .filter((c) => c.kind === 'attachment' && c.dataUrl)
    .map((c) => String(c.dataUrl))
    .filter((u) => u.startsWith('data:image/') || u.startsWith('http'));
  const mentionImageSrcs = chips
    .filter((c) => {
      if (c.kind === 'attachment') return false;
      const src = String(c.dataUrl || c.thumbUrl || '').trim();
      return (
        c.kind === 'image' ||
        src.startsWith('data:image/') ||
        src.startsWith('http') ||
        src.startsWith('/')
      );
    })
    .map((c) => String(c.dataUrl || c.thumbUrl || '').trim())
    .filter(Boolean);
  const skillRefs = [
    ...new Set(
      chips
        .filter((c) => c.kind === 'skill')
        .map((c) => {
          const base = chipBaseKey(c.key);
          if (base.startsWith('skill:')) return base.slice(6);
          return String(c.payload || base).trim();
        })
        .filter(Boolean)
    ),
  ];
  return {
    frameChip,
    chipFrameId,
    mentionNodeIds,
    attachedImages,
    mentionImageSrcs,
    skillRefs,
  };
}

export function resolveImageGenPlan(opts: {
  isImageInteraction: boolean;
  imageGenCountSetting: number;
  isImageModelSelected: boolean;
  imageResolution: string;
  imageGenAspectRatio: string;
  mentionNodeIds: string[];
  docForFill: any;
}): {
  imageGenCount: number;
  imageGenAspect?: string;
  imageGenResolution?: string;
  imageFillTargets: string[];
} {
  let imageGenCount = 0;
  if (opts.isImageInteraction) {
    imageGenCount = Math.max(1, Math.min(4, Math.round(opts.imageGenCountSetting) || 1));
  } else if (opts.isImageModelSelected) {
    imageGenCount = 1;
  }
  let imageGenAspect: string | undefined;
  let imageGenResolution: string | undefined;
  const imageFillTargets: string[] = [];
  if (!imageGenCount) {
    return { imageGenCount, imageFillTargets };
  }
  if (opts.isImageInteraction) {
    imageGenResolution = opts.imageResolution;
    if (String(opts.imageGenAspectRatio).trim() !== 'smart') {
      imageGenAspect = String(opts.imageGenAspectRatio).trim() || undefined;
    }
  }
  for (const id of opts.mentionNodeIds) {
    const n = opts.docForFill?.deltaSetLike?.[id];
    if (!n) continue;
    const key = String(n.key || '').toLowerCase();
    if (['text', 'frame', 'artboard', 'group'].includes(key)) continue;
    const shape = String(n.attrs?.shapeType || key || '').toLowerCase();
    if (['line', 'arrow', 'pen', 'pencil'].includes(shape)) continue;
    imageFillTargets.push(id);
  }
  if (imageFillTargets[0] && opts.docForFill) {
    const n = opts.docForFill.deltaSetLike[imageFillTargets[0]];
    const tw = Math.max(1, Number(n?.width) || 0);
    const th = Math.max(1, Number(n?.height) || 0);
    if (tw > 0 && th > 0) {
      imageGenAspect = `${Math.round(tw)}:${Math.round(th)}`;
    }
  }
  return { imageGenCount, imageGenAspect, imageGenResolution, imageFillTargets };
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function resolveSeedImageModelMeta(opts: {
  canPickModel: boolean;
  model: string;
  selectedModel?: LlmModel | null;
  models: LlmModel[];
}): { id: string; label: string } {
  const fallbackId = cloudImageFallbackId();
  if (!opts.canPickModel) {
    const label =
      opts.models.find((m) => m.id === fallbackId)?.label ||
      opts.selectedModel?.id ||
      opts.model ||
      fallbackId;
    return { id: fallbackId, label: String(label) };
  }
  const id = String(opts.model || opts.selectedModel?.id || '');
  const label =
    opts.selectedModel?.label || opts.selectedModel?.id || opts.model || fallbackId;
  return { id, label: String(label) };
}

export function buildStreamingAssistantSeed(opts: {
  imageGenCount: number;
  imageGenAspect?: string;
  imageGenAspectRatio: string;
  canPickModel: boolean;
  model: string;
  selectedModel?: LlmModel | null;
  models: LlmModel[];
  t: TFn;
}): Pick<
  ChatUiMessage,
  'steps' | 'imagePendingCount' | 'imageAspectRatio' | 'imageModelId' | 'imageModelLabel'
> {
  if (!opts.imageGenCount) {
    return { steps: [] };
  }
  const meta = resolveSeedImageModelMeta(opts);
  return {
    imagePendingCount: opts.imageGenCount,
    imageAspectRatio: opts.imageGenAspect || opts.imageGenAspectRatio,
    imageModelId: meta.id,
    imageModelLabel: meta.label,
    steps: [],
  };
}

export function buildVideoAssistantSeed(opts: {
  videoGenAspect?: string;
  videoGenAspectRatio: string;
  canPickModel: boolean;
  model: string;
  selectedModel?: LlmModel | null;
}): Pick<
  ChatUiMessage,
  'videoPendingCount' | 'imageAspectRatio' | 'imageModelId' | 'imageModelLabel' | 'steps'
> {
  const fallbackId = cloudVideoFallbackId();
  return {
    videoPendingCount: 1,
    imageAspectRatio: opts.videoGenAspect || opts.videoGenAspectRatio,
    imageModelId: !opts.canPickModel
      ? fallbackId
      : String(opts.model || opts.selectedModel?.id || fallbackId),
    imageModelLabel: String(
      opts.selectedModel?.label || opts.model || fallbackId
    ),
    steps: [],
  };
}

export function buildAudioAssistantSeed(opts: {
  canPickModel: boolean;
  model: string;
  selectedModel?: LlmModel | null;
}): Pick<
  ChatUiMessage,
  'audioPendingCount' | 'imageModelId' | 'imageModelLabel' | 'steps'
> {
  const fallbackId = String(opts.selectedModel?.id || opts.model || 'or-gemini-3-1-flash-tts');
  return {
    audioPendingCount: 1,
    imageModelId: !opts.canPickModel ? fallbackId : String(opts.model || fallbackId),
    imageModelLabel: String(opts.selectedModel?.label || opts.model || fallbackId),
    steps: [],
  };
}

export function buildLottieAssistantSeed(opts: {
  lottieGenAspect?: string;
  lottieGenAspectRatio: string;
  canPickModel: boolean;
  model: string;
  selectedModel?: LlmModel | null;
}): Pick<
  ChatUiMessage,
  'lottiePendingCount' | 'imageAspectRatio' | 'imageModelId' | 'imageModelLabel' | 'steps'
> {
  const fallbackId = String(opts.selectedModel?.id || opts.model || 'auto');
  return {
    lottiePendingCount: 1,
    imageAspectRatio: opts.lottieGenAspect || opts.lottieGenAspectRatio,
    imageModelId: !opts.canPickModel ? fallbackId : String(opts.model || fallbackId),
    imageModelLabel: String(opts.selectedModel?.label || opts.model || fallbackId),
    steps: [],
  };
}

function buildCreditModelControls(opts: {
  active: boolean;
  models: LlmModel[];
  modelId: string;
  modelsStatus: 'idle' | 'loading' | 'ready' | 'error';
  modelOpen: boolean;
  onModelOpenChange: (open: boolean) => void;
  onPickModel: (id: string) => void;
  tab: 'design' | 'video';
  creditCost: number;
}): AudioModeComposerControls | null {
  if (!opts.active) return null;
  const selected = pickCatalogModel(opts.models, opts.modelId);
  return {
    creditCost: opts.creditCost,
    modelLabel: String(selected?.label || opts.modelId || ''),
    modelIcon: selected
      ? createElement(ModelBrandIcon, {
          model: selected,
          className: 'h-3.5 w-3.5 shrink-0',
        })
      : undefined,
    modelOpen: opts.modelOpen,
    onModelOpenChange: opts.onModelOpenChange,
    modelPanel: createElement(ModelPickerPanel, {
      tab: opts.tab,
      models: opts.models,
      selectedId: opts.modelId,
      status: opts.modelsStatus,
      hideAuto: true,
      useModelsAsIs: true,
      onPick: opts.onPickModel,
    }),
  };
}

export type DesignSendMutable = {
  designStarted: boolean;
  canvasMutated: boolean;
  nodesPainted: boolean;
};

export function buildDesignSceneSnapshot(opts: {
  docNow: any;
  chipFrameId: string | null;
  frameChip: ComposerContext | undefined;
  mentionNodeIds: string[];
  lastAgentFrameId: string | null;
  taskStateFrameId?: string | null;
  canvasUi?: CanvasUiBridge | null;
  /** Timeline-open 动画工作台 frame id (from lottieTimelinePanel). */
  animationWorkbenchFrameId?: string | null;
}) {
  let chipFrameId = opts.chipFrameId;
  if (!chipFrameId && opts.mentionNodeIds.length && opts.docNow) {
    chipFrameId = frameIdContainingNode(opts.docNow, opts.mentionNodeIds[0]);
  }
  const freeCanvasMention = Boolean(
    opts.mentionNodeIds.length && !chipFrameId && !opts.frameChip
  );
  let editTarget: ReturnType<typeof resolveDesignTargetFrame> | null = null;
  if (opts.docNow && chipFrameId) {
    editTarget = resolveDesignTargetFrame(opts.docNow, chipFrameId, null);
  }
  const targetFrameId = resolveDesignFocusFrameId({
    freeCanvasMention,
    editTargetId: editTarget?.id,
    chipFrameId,
    animationWorkbenchFrameId: opts.animationWorkbenchFrameId,
  });
  const sceneNodes = opts.docNow
    ? buildSceneNodesForCanvas(opts.docNow, {
        focusFrameId: targetFrameId,
        forceIds: opts.mentionNodeIds,
      })
    : [];
  const sceneFrames = opts.docNow ? buildSceneFramesSnapshot(opts.docNow) : [];
  const vp = opts.canvasUi?.getViewportSceneBounds?.() || null;
  const spatialSummary = opts.docNow
    ? buildSpatialSummary(opts.docNow, {
        focusFrameId: targetFrameId,
        viewport: vp
          ? { x: vp.x, y: vp.y, w: vp.width, h: vp.height }
          : null,
      })
    : null;
  const seedLiveNodeIds = resolveSeedLiveNodeIds({
    doc: opts.docNow,
    editTarget,
    freeCanvasMention,
    mentionNodeIds: opts.mentionNodeIds,
  });
  return {
    chipFrameId,
    targetFrameId,
    sceneNodes,
    sceneFrames,
    spatialSummary,
    seedLiveNodeIds,
  };
}
