import type { SceneDocument } from '@/components/rcb/sceneNode';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { HiOutlineBolt, HiOutlineChevronDown, HiOutlinePlus, HiOutlineViewfinderCircle } from 'react-icons/hi2';
import { LuCrosshair } from 'react-icons/lu';
import { generateImage, type ChatModelsResponse, type LlmModel } from '@/service/chat';
import { apiQuery, getHttpErrorMessage } from '@/service/client';
import { Dropdown, DropdownPanel, message, Tooltip } from '@/components/base';
import {
  RcbOverlayPortal,
  rcbScreenPxToScene,
  useRcbCamera,
  useRcbScreenToolbarStyle,
} from '@/components/rcb';
import { SELECTION_TOOLBAR_BELOW_BOX_GAP_PX } from '@/components/rcb/selection/chrome/SelectionToolbarShell';
import AgentComposerInput, {
  type AgentComposerHandle,
  type ComposerContext,
} from '@/components/editor/panels/AgentComposerInput';
import {
  ComposerAttachmentChip,
  composerAttachActionClass,
} from '@/components/editor/panels/agent/composer/AgentComposerShell';
import {
  buildImageGeneratorModelList,
  flyPickIntoImageComposer,
} from '@/components/editor/nodes/ImageGeneratorNode/ImageGeneratorCard';
import {
  buildComposerChipPrompt,
  collectComposerRefImages,
} from '@/components/editor/panels/agent/agentSendPath';
import ImageAspectRatioPicker, {
  DEFAULT_IMAGE_COUNT,
  DEFAULT_IMAGE_QUALITY,
  DEFAULT_IMAGE_ASPECT_RATIO,
  DEFAULT_IMAGE_RESOLUTION,
  modelImageLimits,
} from '@/components/editor/panels/agent/shared/ImageAspectRatioPicker';
import ModelPickerPanel, {
  ModelBrandIcon,
} from '@/components/editor/panels/agent/models/ModelPickerPanel';
import { cloudImageFallbackId } from '@/components/editor/panels/agent/llmModelMeta';
import {
  listImageVariantUrls,
  writeImageVariantsAttr,
} from '@/components/rcb/scene/document/mediaLifecycle';
import {
  clearCanvasAttachPick,
  closeImageToolPanel,
  consumePendingCanvasAttach,
  consumePendingQuickEditMarkContexts,
  finishImageProcess,
  openImageToolPanel,
  patchDocumentNode,
  pushEditorHistory,
  startCanvasAttachPick,
  type PendingMarkContextChip,
} from '@/store/modules/editor';
import { useImageToolCapabilities } from '@/service/imageTools';
import { noteCanvasFlyLand } from '@/components/editor/panels/agent/composer/flyToChat';
import { FREE_IMAGE_MODEL_ID, planAllowsModelPick } from '@/utils/wallet';
import { useWalletSnapshot } from '@/service/wallet';
import { cn } from '@/utils/classnames';
import { isDesktopLocal } from '@/utils/apiBase';
import { estimateImageCredits } from '@/utils/imageCredits';
import { readFileAsDataUrl } from '@/utils/uploadImage';
import store from '@/store';

type SceneBox = { left: number; top: number; width: number; height: number };

function insertPendingMarkChips(
  input: AgentComposerHandle | null,
  list: PendingMarkContextChip[],
  focus: boolean
) {
  for (const item of list) {
    input?.insertContextAtCaret({
      key: item.key,
      label: item.label,
      kind: item.kind,
      payload: item.payload,
      dataUrl: item.dataUrl,
      thumbUrl: item.thumbUrl,
    });
    const tail = item.appendText?.trim();
    if (tail) input?.insertPlainAtCaret(tail);
  }
  if (focus) input?.focus();
}

function nextQuickEditImageModelId(
  models: LlmModel[],
  currentId: string,
  canPickModel: boolean
): string | null {
  if (!canPickModel) {
    const fallback = cloudImageFallbackId();
    if (!fallback || currentId === fallback) return null;
    return fallback;
  }
  if (!models.length || models.some((m) => m.id === currentId)) return null;
  if (!isDesktopLocal()) {
    const preferred =
      models.find((m) => m.id === FREE_IMAGE_MODEL_ID) ||
      models.find((m) => /seedream/i.test(m.id));
    if (preferred) return preferred.id;
  }
  return models[0]?.id ?? null;
}

function ratioSummaryLabel(aspectRatio: string, t: (k: string) => string) {
  const raw = String(aspectRatio || '').trim();
  if (raw === 'smart') return t('agent.ratioSmart');
  if (/^\d+x\d+$/i.test(raw)) {
    const [a, b] = raw.toLowerCase().split('x');
    return `${a}脳${b}`;
  }
  return raw || '1:1';
}

/**
 * Floating quick-edit composer under a selected image.
 * Prefills `attrs.genPrompt`; uses the image as the primary i2i reference.
 */
function ImageQuickEditComposer({
  document,
  nodeId,
  box,
  hidden = false,
}: {
  document: SceneDocument;
  nodeId: string;
  box: SceneBox;
  hidden?: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const camera = useRcbCamera();
  const zoom = Math.max(0.05, camera.zoom || 1);
  const inputRef = useRef<AgentComposerHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const node = document?.deltaSetLike?.[nodeId];
  const src = String(node?.attrs?.src || '').trim();
  const savedPrompt = String(node?.attrs?.genPrompt || '').trim();

  const [prompt, setPrompt] = useState(savedPrompt);
  const [contexts, setContexts] = useState<ComposerContext[]>([]);
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [modelsStatus, setModelsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  );
  const [modelId, setModelId] = useState(() => cloudImageFallbackId());
  const [resolution, setResolution] = useState<string>(DEFAULT_IMAGE_RESOLUTION);
  const [aspectRatio, setAspectRatio] = useState<string>(DEFAULT_IMAGE_ASPECT_RATIO);
  const [imageCount, setImageCount] = useState<number>(DEFAULT_IMAGE_COUNT);

  const { planId } = useWalletSnapshot();
  const canPickModel = planAllowsModelPick(planId);
  const { data: imageToolCaps } = useImageToolCapabilities();
  const ilpEnabled = imageToolCaps?.ilp?.enabled === true;
  const pendingQuickEditMarks = useSelector(
    (s: any) => (s.editor.pendingQuickEditMarkContexts || []) as PendingMarkContextChip[]
  );
  const canvasAttachPick = useSelector(
    (s: any) => s.editor?.canvasAttachPick as null | { target: string }
  );
  const pendingCanvasAttach = useSelector(
    (s: any) =>
      s.editor?.pendingCanvasAttach as null | {
        target: string;
        payload: string | string[];
      }
  );
  const pickTarget = `node:${nodeId}`;
  const pickingFromCanvas = canvasAttachPick?.target === pickTarget;
  const contextsRef = useRef(contexts);
  contextsRef.current = contexts;

  useEffect(() => {
    setPrompt(savedPrompt);
  }, [nodeId, savedPrompt]);

  useEffect(() => {
    if (!pendingCanvasAttach || pendingCanvasAttach.target !== pickTarget) return;
    const payload = pendingCanvasAttach.payload;
    dispatch(consumePendingCanvasAttach());
    async function flyPendingAttach() {
      await flyPickIntoImageComposer({
        landId: pickTarget,
        document,
        payload,
        existing: contextsRef.current,
        setContexts,
        insertChip: (ctx) => {
          inputRef.current?.insertContextAtCaret(ctx);
          inputRef.current?.focus();
        },
      });
    }
    flyPendingAttach();
  }, [pendingCanvasAttach, pickTarget, document, dispatch]);

  // Auto-focus prompt when the floating chat panel opens or mark session ends.
  useEffect(() => {
    if (hidden) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [nodeId, hidden]);

  const modelsCatalogQuery = useQuery({
    ...apiQuery.chatGetModels.queryOptions(),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (modelsCatalogQuery.isPending) {
      setModelsStatus('loading');
      return;
    }
    if (modelsCatalogQuery.isError) {
      setModelsStatus('error');
      return;
    }
    if (!modelsCatalogQuery.isFetched) return;
    const res = modelsCatalogQuery.data as ChatModelsResponse | undefined;
    if (!res) {
      setModelsStatus('error');
      return;
    }
    const imgs = buildImageGeneratorModelList(res);
    setModels(imgs);
    setModelsStatus('ready');
    const nextId = nextQuickEditImageModelId(imgs, modelId, canPickModel);
    if (nextId) setModelId(nextId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per open
  }, [
    modelsCatalogQuery.data,
    modelsCatalogQuery.isPending,
    modelsCatalogQuery.isError,
    modelsCatalogQuery.isFetched,
    nodeId,
    canPickModel,
  ]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!pendingQuickEditMarks.length) return;
    const list = pendingQuickEditMarks.slice();
    dispatch(consumePendingQuickEditMarkContexts());
    insertPendingMarkChips(inputRef.current, list, !hidden);
  }, [pendingQuickEditMarks, dispatch, hidden]);

  const attachments = contexts.filter((c) => c.kind === 'attachment');
  const inlineContexts = contexts.filter((c) => c.kind !== 'attachment');
  const selectedModel = models.find((m) => m.id === modelId);
  const creditCost = estimateImageCredits(selectedModel, imageCount, resolution);
  const settingsSummary = `${resolution} · ${ratioSummaryLabel(aspectRatio, t)} · ${imageCount}`;

  const composerStyle = useRcbScreenToolbarStyle({
    left: box.left + box.width / 2,
    top: box.top + box.height + rcbScreenPxToScene(SELECTION_TOOLBAR_BELOW_BOX_GAP_PX, zoom),
    anchor: 'top',
  });

  const removeContext = (key: string) => {
    setContexts((prev) => prev.filter((c) => c.key !== key));
  };

  const onPickRef = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
    e.target.value = '';
    if (!files.length) return;
    const results = await Promise.all(
      files.map(async (file, i) => {
        try {
          const dataUrl = await readFileAsDataUrl(file);
          return {
            key: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${i}`,
            kind: 'attachment' as const,
            label: file.name || 'image',
            payload: dataUrl,
            dataUrl,
            thumbUrl: dataUrl,
          } satisfies ComposerContext;
        } catch {
          return null;
        }
      })
    );
    const next = results.filter(Boolean) as ComposerContext[];
    if (!next.length) return;
    setContexts((prev) => [...prev, ...next]);
  };

  const onGenerate = async () => {
    const text = prompt.trim();
    if (!text || sending || !src) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSending(true);
    dispatch(pushEditorHistory());
    dispatch(
      patchDocumentNode({
        nodeId,
        skipHistory: true,
        patch: {
          attrs: {
            processStatus: 'running',
            processKind: 'quickEdit',
            processLabel: t('editor.imageToolbar.processingQuickEdit'),
          },
        },
      })
    );
    try {
      const promptForApi = buildComposerChipPrompt(contexts, text);
      const body: Parameters<typeof generateImage>[0] = {
        prompt: promptForApi,
        model: canPickModel ? modelId : cloudImageFallbackId() || modelId,
        quality: DEFAULT_IMAGE_QUALITY,
        resolution,
        images: collectComposerRefImages(contexts, src),
      };
      if (aspectRatio !== 'smart') body.aspect_ratio = aspectRatio;

      const count = Math.max(1, Math.min(4, Math.round(imageCount) || 1));
      const pickUrl = (res: Awaited<ReturnType<typeof generateImage>>) => {
        const fromImages =
          Array.isArray(res?.images) && res.images.find((u) => String(u || '').trim());
        if (fromImages) return String(fromImages).trim();
        const fromAssets =
          Array.isArray(res?.assets) &&
          res.assets.map((a) => String(a?.url || '').trim()).find(Boolean);
        return fromAssets ? String(fromAssets).trim() : '';
      };
      const slotUrls = await Promise.all(
        Array.from({ length: count }, async () => {
          if (ac.signal.aborted) return '';
          try {
            const res = await generateImage(body, { signal: ac.signal });
            return pickUrl(res);
          } catch {
            return '';
          }
        })
      );
      const urls = slotUrls.filter(Boolean);
      const nextSrc = urls[0] || '';
      if (!nextSrc) throw new Error(t('editor.tools.imageGenEmpty'));

      const prev = listImageVariantUrls(node);
      const stack = [...new Set([nextSrc, ...urls, ...prev.filter((u) => u !== nextSrc)])];
      const variantAttrs: Record<string, unknown> = {};
      writeImageVariantsAttr(variantAttrs, stack);

      dispatch(
        finishImageProcess({
          nodeId,
          src: nextSrc,
          attrs: {
            genPrompt: text,
            ...variantAttrs,
          },
        })
      );
      dispatch(closeImageToolPanel());
    } catch (err: any) {
      if (ac.signal.aborted) return;
      dispatch(finishImageProcess({ nodeId }));
      message.error(getHttpErrorMessage(err, t('editor.tools.imageGenFail')));
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setSending(false);
    }
  };

  const subjectChip = useMemo(
    () =>
      src
        ? ({
            key: `subject-${nodeId}`,
            kind: 'attachment',
            label: t('editor.imageToolbar.chatSubject'),
            payload: src,
            dataUrl: src,
            thumbUrl: src,
          } satisfies ComposerContext)
        : null,
    [nodeId, src, t]
  );

  const onMark = () => {
    if (!ilpEnabled) {
      message.warning(t('editor.imageToolbar.markNeedsIntelligence'));
      return;
    }
    dispatch(openImageToolPanel({ nodeId, kind: 'mark', markSink: 'quickEdit' }));
  };

  if (!node || !src) return null;

  return (
    <RcbOverlayPortal>
      <div
        data-image-quick-edit
        data-sel-toolbar
        data-scene-node-id={nodeId}
        className={cn(
          'pointer-events-auto absolute z-[32] flex h-[200px] w-[500px] flex-col overflow-visible',
          'rounded-2xl border border-[var(--line)] bg-[var(--surface)]',
          'shadow-[0_8px_28px_rgba(15,23,42,0.12)]',
          hidden && 'invisible pointer-events-none'
        )}
        style={composerStyle}
        aria-hidden={hidden || undefined}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation?.();
        }}
      >
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
          {subjectChip ? (
            <ComposerAttachmentChip
              attachment={subjectChip}
              removable={false}
              onRemove={() => undefined}
            />
          ) : null}
          {attachments.map((att) => (
            <ComposerAttachmentChip
              key={att.key}
              attachment={att}
              disabled={sending}
              onRemove={removeContext}
            />
          ))}
          <Tooltip tip={t('editor.tools.imageGenRef')} placement="top">
            <button
              type="button"
              disabled={sending}
              aria-label={t('editor.tools.imageGenRef')}
              onClick={() => fileRef.current?.click()}
              className={composerAttachActionClass()}
            >
              <HiOutlinePlus className="h-4 w-4" strokeWidth={2} />
            </button>
          </Tooltip>
          {ilpEnabled ? (
            <Tooltip tip={t('editor.imageToolbar.mark')} placement="top">
              <button
                type="button"
                disabled={sending}
                aria-label={t('editor.imageToolbar.mark')}
                onClick={onMark}
                className={composerAttachActionClass()}
              >
                <LuCrosshair className="h-4 w-4" strokeWidth={2} />
              </button>
            </Tooltip>
          ) : null}
          <Tooltip
            tip={pickingFromCanvas ? t('agent.pickFromCanvasCancel') : t('agent.pickFromCanvas')}
            placement="top"
          >
            <button
              type="button"
              disabled={sending}
              aria-label={t('agent.pickFromCanvas')}
              aria-pressed={pickingFromCanvas}
              onClick={() => {
                if (pickingFromCanvas) {
                  dispatch(clearCanvasAttachPick());
                  return;
                }
                noteCanvasFlyLand(pickTarget);
                dispatch(startCanvasAttachPick({ target: pickTarget, accept: 'image' }));
              }}
              className={composerAttachActionClass(pickingFromCanvas)}
            >
              <HiOutlineViewfinderCircle className="h-4 w-4" strokeWidth={2} />
            </button>
          </Tooltip>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onPickRef}
          />
        </div>

        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- pointer padding to focus; keyboard tabs into contenteditable */}
        <div
          className="min-h-0 min-w-0 flex-1 cursor-text overflow-y-auto px-3 pt-2"
          onClick={(e) => {
            if ((e.target as HTMLElement | null)?.closest?.('[data-agent-composer]')) return;
            inputRef.current?.focus();
          }}
        >
          <AgentComposerInput
            ref={inputRef}
            contexts={inlineContexts}
            onContextsChange={(next) => setContexts([...attachments, ...next])}
            value={prompt}
            onChange={setPrompt}
            onSubmit={() => void onGenerate()}
            disabled={sending}
            placeholder={t('editor.tools.imageGenPlaceholder')}
            flyLandId={pickTarget}
            className="min-h-full w-full text-[13px]"
          />
        </div>

        <div className="mt-1 flex items-center gap-1.5 px-2.5 pb-2">
          <Dropdown
            trigger="click"
            placement="top-start"
            strategy="fixed"
            offset={8}
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            items={[]}
            floatingClassName="z-[90]"
            referenceClassName="inline-flex min-w-0"
            popupRender={() => (
              <DropdownPanel className="w-[min(26rem,calc(100vw-2rem))] p-3">
                <p className="mb-2.5 text-[13px] font-semibold text-[var(--ink)]">
                  {t('editor.tools.imageSettings')}
                </p>
                <ImageAspectRatioPicker
                  variant="image"
                  resolution={resolution}
                  aspectRatio={aspectRatio}
                  imageCount={imageCount}
                  imageLimits={modelImageLimits(selectedModel)}
                  onResolutionChange={(r) => setResolution(r)}
                  onAspectRatioChange={(r) => setAspectRatio(r)}
                  onImageCountChange={(n) => setImageCount(n)}
                  disabled={sending}
                />
              </DropdownPanel>
            )}
          >
            <button
              type="button"
              disabled={sending}
              className={cn(
                'inline-flex h-7 max-w-[min(100%,11rem)] items-center gap-1 truncate rounded-full px-2 text-[12px] font-medium transition-colors disabled:opacity-40',
                settingsOpen
                  ? 'bg-[var(--accent-soft)] text-[var(--ink)]'
                  : 'bg-[var(--canvas)] text-[var(--ink)] hover:bg-[var(--accent-soft)]'
              )}
            >
              <span className="truncate">{settingsSummary}</span>
              <HiOutlineChevronDown
                className={cn(
                  'h-3 w-3 shrink-0 opacity-70 transition-transform duration-150',
                  settingsOpen && 'rotate-180'
                )}
                strokeWidth={2}
              />
            </button>
          </Dropdown>

          <div className="ml-auto flex items-center gap-1">
            {canPickModel ? (
              <Dropdown
                trigger="click"
                placement="top-end"
                strategy="fixed"
                offset={8}
                open={modelOpen}
                onOpenChange={setModelOpen}
                items={[]}
                floatingClassName="z-[90]"
                referenceClassName="inline-flex"
                popupRender={() => (
                  <div onPointerDown={(e) => e.stopPropagation()}>
                    <ModelPickerPanel
                      tab="image"
                      models={models}
                      selectedId={modelId}
                      status={modelsStatus}
                      onPick={(id) => {
                        setModelId(id);
                        setModelOpen(false);
                      }}
                    />
                  </div>
                )}
              >
                <Tooltip
                  tip={selectedModel?.label || modelId}
                  placement="top"
                  disabled={modelOpen}
                >
                  <button
                    type="button"
                    disabled={sending}
                    aria-label={selectedModel?.label || modelId}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)] disabled:opacity-40"
                  >
                    <ModelBrandIcon
                      model={selectedModel || { id: modelId }}
                      className="h-3.5 w-3.5 shrink-0"
                    />
                  </button>
                </Tooltip>
              </Dropdown>
            ) : (
              <span className="inline-flex h-7 w-7 items-center justify-center">
                <ModelBrandIcon
                  model={{ id: cloudImageFallbackId() || modelId || '' }}
                  className="h-3.5 w-3.5"
                />
              </span>
            )}

            <Tooltip tip={t('wallet.creditCostTip', { count: creditCost })} placement="top">
              <button
                type="button"
                disabled={sending || !prompt.trim()}
                onClick={() => void onGenerate()}
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold transition',
                  'bg-[var(--ink)] text-[var(--on-brand)] disabled:opacity-40'
                )}
              >
                <HiOutlineBolt className="h-3.5 w-3.5" strokeWidth={2} />
                <span className="tabular-nums">{creditCost}</span>
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(ImageQuickEditComposer);
