/**
 * Audio generator composer under the empty plate.
 * Prompt → OpenRouter TTS via POST /api/v1/chat/audio/jobs; optional local upload shortcut.
 * Attachments use the same strip + `@` mention chips as image/video generators.
 */
import type { SceneDocument } from '@/components/rcb/sceneNode';
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { FloatingPortal } from '@floating-ui/react';
import { HiArrowUp, HiOutlineBolt } from 'react-icons/hi2';
import { createAudioJob, waitForAudioJob } from '@/service/chat';
import { getHttpErrorMessage } from '@/service/client';
import { useBillingEnabled } from '@/service/wallet';
import { Dropdown, message, Tooltip } from '@/components/base';
import {
  useChromePointerActivate,
  useGeneratorComposerScreenStyle,
} from '@/components/rcb/selection/chrome/SelectionToolbarShell';
import { RcbOverlayPortal } from '@/components/rcb';
import AgentComposerInput, {
  chipBaseKey,
  composerAttachmentMediaKind,
  upsertLibraryAssetAttachment,
  type AgentComposerHandle,
  type ComposerContext,
} from '@/components/editor/panels/AgentComposerInput';
import {
  CanvasMediaComposerShell,
  ComposerAttachmentStrip,
  ComposerFooterBar,
  ComposerPromptRegion,
} from '@/components/editor/panels/agent/composer/CanvasMediaComposerShell';
import MentionAttachPanel, {
  type MentionAttachItem,
} from '@/components/editor/panels/agent/composer/MentionAttachPanel';
import { useComposerSlashSkills } from '@/components/editor/panels/agent/composer/useComposerSlashSkills';
import { useComposerMentionPanel } from '@/components/editor/panels/agent/composer/useComposerMentionPanel';
import { useGeneratorModelsCatalog } from '@/components/editor/panels/agent/composer/useGeneratorModelsCatalog';
import { insertMentionFromAttachment } from '@/components/editor/panels/agent/composer/composerMentionHelpers';
import type { UserAsset } from '@/models/assets';
import ModelPickerPanel, {
  ModelBrandIcon,
} from '@/components/editor/panels/agent/models/ModelPickerPanel';
import {
  buildAudioGeneratorModelList,
  nextAudioModelId,
} from '@/components/editor/nodes/shared/generatorModelLists';
import { finishGeneratorGenerateSession } from '@/components/editor/nodes/shared/finishGeneratorGenerate';
import { probeAudioDuration, pickAudioUrl } from '@/components/editor/nodes/shared/mediaProbe';
import { clearGeneratorProcessOverlay } from '@/components/editor/nodes/shared/clearGeneratorProcess';
import { processJobAttrPatch } from '@/components/rcb/scene/document/processJobAttrs';
import { registerGeneratorSession } from '@/components/editor/nodes/shared/generatorSessionRegistry';
import {
  finishAudioGenerator,
  patchDocumentNode,
} from '@/store/modules/editor';
import { cn } from '@/utils/classnames';
import { estimateAudioCredits } from '@/utils/imageCredits';
import { readFileAsDataUrl, uploadComposerAttachment } from '@/utils/uploadImage';
import { cloudOnlyModelId } from '@/components/editor/panels/agent/llmModelMeta';
import store from '@/store';

type Props = {
  nodeId: string;
  sceneBox: { x: number; y: number; width: number; height: number };
  disabled?: boolean;
};

const DEFAULT_AUDIO_MODEL_ID = 'or-gemini-3-1-flash-tts';

function AudioGeneratorCard({
  nodeId,
  sceneBox,
  disabled,
}: Props): ReactNode {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const chromePointer = useChromePointerActivate();
  const inputRef = useRef<AgentComposerHandle | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [prompt, setPrompt] = useState('');
  const [contexts, setContexts] = useState<ComposerContext[]>([]);
  const [sending, setSending] = useState(false);
  const composerVisible = !sending;
  const [modelId, setModelId] = useState(() => cloudOnlyModelId(DEFAULT_AUDIO_MODEL_ID));
  const { models, status: modelsStatus } = useGeneratorModelsCatalog({
    buildList: buildAudioGeneratorModelList,
    modelId,
    setModelId,
    resolveModelId: nextAudioModelId,
  });
  const [modelOpen, setModelOpen] = useState(false);
  const contextsRef = useRef<ComposerContext[]>([]);
  contextsRef.current = contexts;

  const {
    mentionOpen,
    mentionQuery,
    closeMention,
    openMention,
    mentionFloating,
    mentionIx,
  } = useComposerMentionPanel(inputRef);

  const attachments = useMemo(
    () => contexts.filter((c) => c.kind === 'attachment'),
    [contexts]
  );
  const attachmentsUploading = attachments.some((c) => c.uploadStatus === 'uploading');
  const inlineContexts = useMemo(
    () => contexts.filter((c) => c.kind !== 'attachment'),
    [contexts]
  );
  const readyAudioAtt = useMemo(
    () =>
      attachments.find(
        (c) =>
          composerAttachmentMediaKind(c) === 'audio' &&
          c.uploadStatus !== 'uploading' &&
          String(c.dataUrl || '').trim()
      ) || null,
    [attachments]
  );

  const wasComposerVisibleRef = useRef(false);
  useEffect(() => {
    if (!composerVisible || disabled) {
      wasComposerVisibleRef.current = false;
      return;
    }
    if (wasComposerVisibleRef.current) return;
    wasComposerVisibleRef.current = true;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [composerVisible, disabled]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const selectedModel = models.find((m) => m.id === modelId);
  const billingEnabled = useBillingEnabled();
  const creditCost = estimateAudioCredits(selectedModel);

  const removeContext = (key: string) =>
    setContexts((prev) =>
      prev.filter((c) => c.key !== key && chipBaseKey(c.key) !== chipBaseKey(key))
    );

  const attachAudioFiles = async (files: File[]) => {
    const media = files.filter((f) => String(f.type || '').startsWith('audio/'));
    if (!media.length) {
      message.warning(t('editor.tools.audioGenUpload', { defaultValue: '请上传音频文件' }));
      return;
    }

    const staged: Array<{
      file: File;
      key: string;
      preview: string;
      pending: ComposerContext;
    }> = [];
    for (let i = 0; i < media.length; i++) {
      const file = media[i]!;
      try {
        const preview = await readFileAsDataUrl(file);
        const key = `attach:${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${i}`;
        staged.push({
          file,
          key,
          preview,
          pending: {
            key,
            label: file.name || t('editor.tools.audioGenerator'),
            kind: 'attachment',
            payload: `[Attached audio]\nname: ${file.name}\nmime: ${file.type}`,
            dataUrl: preview,
            thumbUrl: preview,
            uploadStatus: 'uploading',
          },
        });
      } catch {
        message.error(t('agent.attachReadFailed', { name: file.name }));
      }
    }
    if (!staged.length) return;
    setContexts((prev) => [...prev, ...staged.map((s) => s.pending)]);
    queueMicrotask(() => inputRef.current?.focusEnd());

    await Promise.all(
      staged.map(async ({ file, key, preview }) => {
        try {
          const uploaded = await uploadComposerAttachment(file, {
            previewDataUrl: preview,
          });
          const serverUrl = String(uploaded.url || '').trim();
          const mediaUrl =
            serverUrl.startsWith('http://') || serverUrl.startsWith('https://')
              ? serverUrl
              : preview;
          setContexts((prev) => {
            if (!prev.some((c) => c.key === key)) return prev;
            return prev.map((c) =>
              c.key === key
                ? {
                    ...c,
                    dataUrl: mediaUrl,
                    thumbUrl: preview.startsWith('data:audio/') ? preview : mediaUrl,
                    uploadKey: uploaded.uploadKey || undefined,
                    uploadStatus: 'ready' as const,
                  }
                : c
            );
          });
        } catch (err: any) {
          setContexts((prev) => prev.filter((c) => c.key !== key));
          message.error(
            getHttpErrorMessage(err, t('agent.uploadFailed', { name: file.name }))
          );
        }
      })
    );
  };

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    await attachAudioFiles(files);
  };

  const {
    skillOpen,
    skillQuery,
    skillItems,
    skillFloating,
    skillIx,
    maybeOpenComposerMentions,
    pickSkill,
  } = useComposerSlashSkills({
    inputRef,
    setPrompt,
    onCloseAtMention: closeMention,
    onOpenAtMention: openMention,
  });

  const mentionItems = useMemo((): MentionAttachItem[] => {
    return attachments.map((c, i) => ({
      id: c.key,
      label: t('agent.mentionAttachAudioN', { n: i + 1 }),
      mediaKind: 'audio' as const,
    }));
  }, [attachments, t]);

  const pickMentionAttach = (pickId: string) => {
    const list = contextsRef.current.filter((c) => c.kind === 'attachment');
    const idx = list.findIndex((c) => c.key === pickId);
    if (idx < 0) return;
    const att = list[idx]!;
    insertMentionFromAttachment({
      att,
      n: idx + 1,
      label: t('agent.mentionAttachAudioN', { n: idx + 1 }),
      payload: att.payload || `[User attachment ${idx + 1}]`,
      prompt,
      setPrompt,
      closeMention,
      inputRef,
    });
  };

  const pickMentionLibraryAsset = (asset: UserAsset) => {
    if (asset.kind !== 'audio') return;
    const upserted = upsertLibraryAssetAttachment(
      contextsRef.current,
      asset,
      t('me.assetKindAudio')
    );
    if (!upserted) return;
    setContexts(upserted.contexts);
    contextsRef.current = upserted.contexts;
    insertMentionFromAttachment({
      att: upserted.attachment,
      n: upserted.ordinal,
      label: t('agent.mentionAttachAudioN', { n: upserted.ordinal }),
      payload: upserted.attachment.payload || `[User attachment ${upserted.ordinal}]`,
      prompt,
      setPrompt,
      closeMention,
      inputRef,
    });
  };

  const promoteAudio = async (opts: {
    src: string;
    name: string;
    genPrompt: string;
    previewForDuration?: string;
    uploadKey?: string;
  }) => {
    const duration =
      (await probeAudioDuration(opts.previewForDuration || opts.src)) || undefined;
    dispatch(
      finishAudioGenerator({
        nodeId,
        src: opts.src,
        name: opts.name,
        genPrompt: opts.genPrompt,
        duration,
        uploadKey: opts.uploadKey,
      })
    );
  };

  const onGenerate = async () => {
    if (sending || disabled || attachmentsUploading) return;

    // Local upload shortcut — promote ready attachment (no TTS).
    if (readyAudioAtt) {
      setSending(true);
      let finished = false;
      const src = String(readyAudioAtt.dataUrl || '').trim();
      const text =
        prompt.trim() ||
        t('editor.tools.audioGenerator', { defaultValue: 'Audio' });
      dispatch(
        patchDocumentNode({
          nodeId,
          patch: {
            attrs: {
              processStatus: 'running',
              processKind: 'generate',
              processLabel: t('editor.tools.audioGenerating'),
              genPrompt: text,
            },
          },
        })
      );
      try {
        if (!src) throw new Error('missing audio url');
        await promoteAudio({
          src,
          name: text.slice(0, 48),
          genPrompt: text,
          previewForDuration: src,
          uploadKey: readyAudioAtt.uploadKey || undefined,
        });
        finished = true;
      } catch (err: unknown) {
        message.error(getHttpErrorMessage(err, t('editor.tools.audioGenFail')));
      } finally {
        if (!finished) {
          const doc = (store.getState() as { editor?: { document?: SceneDocument } }).editor
            ?.document;
          clearGeneratorProcessOverlay(dispatch, doc, nodeId);
        }
        setSending(false);
      }
      return;
    }

    const text = prompt.trim();
    if (!text) {
      message.warning(t('editor.tools.audioGenNeedPrompt'));
      return;
    }
    if (!models.length && modelsStatus === 'ready') {
      message.warning(t('editor.tools.audioGenNeedModel'));
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSending(true);
    registerGeneratorSession(nodeId);
    let finished = false;
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          attrs: {
            processStatus: 'running',
            processKind: 'generate',
            processLabel: t('editor.tools.audioGenerating'),
            processStartedAt: String(Date.now()),
            genPrompt: text,
            audioGenModel: modelId,
          },
        },
      })
    );
    try {
      const jobId = await createAudioJob({ prompt: text, model: modelId }, { signal: ac.signal });
      dispatch(
        patchDocumentNode({
          nodeId,
          skipHistory: true,
          patch: { attrs: processJobAttrPatch([jobId]) },
        })
      );
      const res = await waitForAudioJob(jobId, { signal: ac.signal });
      const src = pickAudioUrl(res);
      if (!src) throw new Error(t('editor.tools.audioGenEmpty'));
      await promoteAudio({
        src,
        name: text.slice(0, 48) || t('editor.tools.audioGenerator'),
        genPrompt: text,
      });
      finished = true;
    } catch (err: unknown) {
      if (!ac.signal.aborted) {
        message.error(getHttpErrorMessage(err, t('editor.tools.audioGenFail')));
      }
    } finally {
      finishGeneratorGenerateSession({
        dispatch,
        nodeId,
        finished,
        abortRef,
        ac,
        setSending,
      });
    }
  };

  const composerStyle = useGeneratorComposerScreenStyle(sceneBox);
  const canSubmit = Boolean(readyAudioAtt || prompt.trim()) && !attachmentsUploading;

  return (
    <>
      {composerVisible ? (
        <RcbOverlayPortal>
          <div
            style={composerStyle}
            data-audio-generator
            data-sel-toolbar
            data-scene-node-id={nodeId}
            className="pointer-events-auto z-[32] overflow-visible"
            {...chromePointer}
          >
        <CanvasMediaComposerShell
          panelSize="compact"
          attachment={
            <ComposerAttachmentStrip
              attachments={attachments}
              disabled={disabled || sending}
              onRemove={removeContext}
              attachTooltip={t('editor.tools.audioGenUpload')}
              attachAriaLabel={t('editor.tools.audioGenUpload')}
              onAttachClick={() => fileRef.current?.click()}
              fileInput={{
                ref: fileRef,
                accept: 'audio/*',
                onChange: onPickFile,
              }}
            />
          }
          prompt={
            <ComposerPromptRegion onFocusInput={() => inputRef.current?.focus()}>
              <AgentComposerInput
                ref={inputRef}
                contexts={inlineContexts}
                onContextsChange={(next) => {
                  setContexts([...attachments, ...next]);
                }}
                value={prompt}
                onChange={(next) => {
                  setPrompt(next);
                  maybeOpenComposerMentions(next);
                }}
                disabled={disabled || sending}
                placeholder={t('editor.tools.audioGenPlaceholder')}
                onSubmit={() => onGenerate()}
                className="min-h-full w-full text-[13px]"
              />
            </ComposerPromptRegion>
          }
          footer={
            <ComposerFooterBar align="end">
            {!readyAudioAtt ? (
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
                      tab="video"
                      models={models}
                      selectedId={modelId}
                      status={modelsStatus}
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
                <Tooltip
                  tip={selectedModel?.label || modelId}
                  placement="top"
                  disabled={modelOpen}
                >
                  <button
                    type="button"
                    disabled={disabled || sending}
                    aria-label={selectedModel?.label || modelId}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)] disabled:opacity-40"
                  >
                    <ModelBrandIcon
                      model={selectedModel || { id: modelId }}
                      className="h-3.5 w-3.5 shrink-0"
                    />
                  </button>
                </Tooltip>
              </Dropdown>
            ) : null}
            <Tooltip
              tip={
                readyAudioAtt
                  ? t('editor.tools.audioGenerate')
                  : billingEnabled
                    ? t('wallet.creditCostTip', { count: creditCost })
                    : t('agent.send')
              }
              placement="top"
            >
              <button
                type="button"
                disabled={disabled || sending || !canSubmit}
                aria-label={t('editor.tools.audioGenSubmit')}
                onClick={() => onGenerate()}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[12px] font-medium',
                  'bg-[var(--ink)] text-[var(--on-brand)] transition hover:opacity-90',
                  'disabled:opacity-45',
                  !billingEnabled && !readyAudioAtt && !sending && 'h-8 w-8 justify-center px-0'
                )}
              >
                {sending ? (
                  t('editor.tools.audioGenerating')
                ) : readyAudioAtt ? (
                  <>
                    <HiOutlineBolt className="h-4 w-4" strokeWidth={2} />
                    {t('editor.tools.audioGenerate')}
                  </>
                ) : billingEnabled ? (
                  <>
                    <HiOutlineBolt className="h-4 w-4" strokeWidth={2} />
                    <span className="tabular-nums">{creditCost}</span>
                  </>
                ) : (
                  <HiArrowUp className="h-4 w-4" strokeWidth={2.5} />
                )}
              </button>
            </Tooltip>
            </ComposerFooterBar>
          }
        />
          </div>
        </RcbOverlayPortal>
      ) : null}

      {composerVisible && mentionOpen ? (
        <FloatingPortal>
          <div
            ref={mentionFloating.refs.setFloating}
            style={mentionFloating.floatingStyles as CSSProperties}
            className="z-[95]"
            {...mentionIx.getFloatingProps()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <MentionAttachPanel
              items={mentionItems}
              query={mentionQuery}
              onPick={pickMentionAttach}
              onPickLibraryAsset={pickMentionLibraryAsset}
              assetKinds={['audio']}
            />
          </div>
        </FloatingPortal>
      ) : null}

      {composerVisible && skillOpen ? (
        <FloatingPortal>
          <div
            ref={skillFloating.refs.setFloating}
            style={skillFloating.floatingStyles as CSSProperties}
            className="z-[95]"
            {...skillIx.getFloatingProps()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <MentionAttachPanel
              variant="skill"
              items={skillItems}
              query={skillQuery}
              onPick={pickSkill}
            />
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}

export default memo(AudioGeneratorCard);
