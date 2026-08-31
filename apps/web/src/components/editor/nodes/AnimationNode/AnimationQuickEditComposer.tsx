import type { SceneDocument } from '@/components/rcb/sceneNode';
/**
 * Floating quick-edit chat under a selected 动画工作台 (toolbar → 快速编辑).
 * Regenerates animation in place via POST /api/v1/chat/lottie/jobs (animation track).
 */
import {
  memo,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import {
  HiArrowUp,
  HiOutlineChevronDown,
  HiOutlinePlus,
} from 'react-icons/hi2';
import { BiExit } from 'react-icons/bi';
import { createLottieJob, waitForLottieJob, type LlmModel } from '@/service/chat';
import { getHttpErrorMessage } from '@/service/client';
import { Dropdown, DropdownPanel, message, Tooltip } from '@/components/base';
import {
  SelectionToolbarShell,
} from '@/components/rcb/selection/chrome/SelectionToolbarShell';
import AgentComposerInput, {
  type AgentComposerHandle,
  type ComposerContext,
} from '@/components/editor/panels/AgentComposerInput';
import {
  ComposerAttachmentChip,
  composerAttachActionClass,
} from '@/components/editor/panels/agent/composer/AgentComposerShell';
import { GeneratorComposerPanel } from '@/components/editor/panels/agent/composer/GeneratorComposerPanel';
import ModelPickerPanel, {
  ModelBrandIcon,
} from '@/components/editor/panels/agent/models/ModelPickerPanel';
import {
  DEFAULT_LOTTIE_DURATION,
  AnimationSettingsPanel,
} from '@/components/editor/panels/agent/shared/AnimationSettingsPanel';
import { buildLottieChatModelList, nextLottieChatModelId } from '@/components/editor/nodes/shared/generatorModelLists';
import { useGeneratorModelsCatalog } from '@/components/editor/panels/agent/composer/useGeneratorModelsCatalog';
import { MEDIA_QUICK_EDIT_ATTR } from '@/components/editor/panels/agent/composer/composerMentionHelpers';
import { clearGeneratorProcessOverlay } from '@/components/editor/nodes/shared/clearGeneratorProcess';
import {
  parseLottieAnimationData,
  serializeLottieAnimationData
} from '@/components/rcb/scene/document/nodeFactories';
import {
  closeImageToolPanel,
  closeAnimationFramePanel,
  patchDocumentNode,
  pushEditorHistory,
} from '@/store/modules/editor';
import { cn } from '@/utils/classnames';
import { createFilePreviewUrl } from '@/utils/uploadImage';
import store from '@/store';

type SceneBox = { left: number; top: number; width: number; height: number };

function AnimationQuickEditComposer({
  document,
  nodeId,
  box,
}: {
  document: SceneDocument;
  nodeId: string;
  box: SceneBox;
}): ReactNode {
  const { t } = useTranslation();  const inputRef = useRef<AgentComposerHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const node = document?.deltaSetLike?.[nodeId];
  const savedPrompt = String(node?.attrs?.genPrompt || '').trim();

  const [prompt, setPrompt] = useState(savedPrompt);
  const [contexts, setContexts] = useState<ComposerContext[]>([]);
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelId, setModelId] = useState('');
  const [duration, setDuration] = useState(DEFAULT_LOTTIE_DURATION);

  const { models } = useGeneratorModelsCatalog({
    buildList: buildLottieChatModelList,
    modelId,
    setModelId,
    resolveModelId: nextLottieChatModelId,
    resetKey: nodeId,
  });

  useEffect(() => {
    setPrompt(savedPrompt);
  }, [nodeId, savedPrompt]);

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [nodeId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const attachments = contexts.filter((c) => c.kind === 'attachment');
  const inlineContexts = contexts.filter((c) => c.kind !== 'attachment');
  const selectedModel = models.find((m) => m.id === modelId);
  const settingsSummary = `${duration}s`;

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
          const dataUrl = createFilePreviewUrl(file);
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
    if (next.length) setContexts((prev) => [...prev, ...next]);
  };

  const onGenerate = async () => {
    const text = prompt.trim();
    if (!text || sending) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSending(true);
    pushEditorHistory();
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
      });
    try {
      const imageRefUrls = attachments
        .map((c) => String(c.dataUrl || c.thumbUrl || '').trim())
        .filter(Boolean);
      const genW = Math.min(512, Math.max(32, Math.round(box.width)));
      const genH = Math.min(512, Math.max(32, Math.round(box.height)));
      const jobId = await createLottieJob(
        {
          prompt: text,
          width: genW,
          height: genH,
          duration_sec: duration,
          model: modelId || undefined,
          ...(imageRefUrls.length ? { images: imageRefUrls } : {}),
        },
        { signal: ac.signal }
      );
      const res = await waitForLottieJob(jobId, { signal: ac.signal });
      const animationData = parseLottieAnimationData(res?.animationData) || null;
      const json = serializeLottieAnimationData(animationData);
      if (!animationData || !json) throw new Error(t('editor.tools.lottieGenEmpty'));
      if (ac.signal.aborted) return;

      const aw = Math.max(1, Number(animationData.w) || genW);
      const ah = Math.max(1, Number(animationData.h) || genH);
      const fit = Math.min(box.width / aw, box.height / ah);
      const outW = Math.max(32, Math.round(aw * fit));
      const outH = Math.max(32, Math.round(ah * fit));

      patchDocumentNode({
          nodeId,
          patch: {
            width: outW,
            height: outH,
            attrs: {
              animationData: json,
              genPrompt: text,
              processStatus: null,
              processKind: null,
              processLabel: null,
            },
          },
        });
      closeImageToolPanel();
      closeAnimationFramePanel();
    } catch (err: any) {
      if (ac.signal.aborted) return;
      const doc = (store.getState() as { editor?: { document?: SceneDocument } }).editor
        ?.document;
      clearGeneratorProcessOverlay(doc, nodeId);
      message.error(getHttpErrorMessage(err, t('editor.tools.lottieGenFail')));
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setSending(false);
    }
  };

  if (!node) return null;

  const onCloseQuickEdit = () => {
    abortRef.current?.abort();
    closeAnimationFramePanel();
    closeImageToolPanel();
  };

  return (
    <SelectionToolbarShell
      box={box}
      bare
      dock="below"
      edgePadScene={12}
      zIndexClassName="z-[32]"
      data-lottie-edit-composer
      {...{ [MEDIA_QUICK_EDIT_ATTR]: true }}
      data-scene-node-id={nodeId}
    >
      <GeneratorComposerPanel overflow="visible">
        <div className="flex min-h-0 shrink-0 items-start justify-between gap-2 px-3 pt-2.5">
          <div className="flex max-h-[72px] min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-y-auto">
            {attachments.map((att) => (
              <ComposerAttachmentChip
                key={att.key}
                attachment={att}
                disabled={sending}
                onRemove={removeContext}
              />
            ))}
            <Tooltip tip={t('editor.tools.lottieGenUpload', { defaultValue: '参考图' })} placement="top">
              <button
                type="button"
                disabled={sending}
                aria-label={t('editor.tools.lottieGenUpload', { defaultValue: '参考图' })}
                onClick={() => fileRef.current?.click()}
                className={composerAttachActionClass()}
              >
                <HiOutlinePlus className="h-4 w-4" strokeWidth={2} />
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
          <Tooltip tip={t('editor.exit')} placement="top">
            <button
              type="button"
              aria-label={t('editor.exit')}
              onClick={onCloseQuickEdit}
              className={composerAttachActionClass()}
            >
              <BiExit className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>

        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- pointer padding to focus; keyboard tabs into contenteditable */}
        <div
          className="min-h-0 min-w-0 flex-1 cursor-text overflow-hidden px-3 pt-2"
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
            placeholder={t('editor.tools.lottieGenPlaceholder', {
              defaultValue: '描述要生成或修改的动画…',
            })}
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
              <DropdownPanel className="w-[min(16rem,calc(100vw-2rem))] p-3">
                <AnimationSettingsPanel
                  aspectRatio="1:1"
                  duration={duration}
                  onAspectRatioChange={() => {}}
                  onDurationChange={setDuration}
                  showAspect={false}
                />
              </DropdownPanel>
            )}
          >
            <button
              type="button"
              disabled={sending}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-full px-2 text-[12px] font-medium',
                settingsOpen ? 'bg-[var(--accent-soft)]' : 'bg-[var(--canvas)]'
              )}
            >
              <span>{settingsSummary}</span>
              <HiOutlineChevronDown className="h-3 w-3 opacity-70" strokeWidth={2} />
            </button>
          </Dropdown>

          <div className="flex-1" />

          {models.length > 0 ? (
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
                <div className="max-w-full" onPointerDown={(e) => e.stopPropagation()}>
                  <ModelPickerPanel
                    tab="design"
                    models={models}
                    selectedId={modelId}
                    hideAuto
                    useModelsAsIs
                    onPick={(id) => {
                      setModelId(id);
                      setModelOpen(false);
                    }}
                  />
                </div>
              )}
            >
              <button
                type="button"
                disabled={sending}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--canvas)]"
                title={selectedModel?.label || modelId}
              >
                <ModelBrandIcon model={selectedModel} className="h-4 w-4" />
              </button>
            </Dropdown>
          ) : null}

          <button
            type="button"
            disabled={sending || !prompt.trim()}
            aria-label={t('agent.send')}
            onClick={() => void onGenerate()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ink)] text-[var(--on-brand)] disabled:opacity-40"
          >
            <HiArrowUp className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </GeneratorComposerPanel>
    </SelectionToolbarShell>
  );
}

export default memo(AnimationQuickEditComposer);
