import type { SceneDocument } from '@/components/rcb/sceneNode';
/**
 * Floating quick-edit chat under a selected audio plate (toolbar → 快速编辑).
 * Same strip as AudioGenerator: TTS regenerate, or upload local audio in place.
 */
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from '@/store';
import { HiArrowUp, HiOutlinePlus } from 'react-icons/hi2';
import { generateAudio, type LlmModel } from '@/service/chat';
import { getHttpErrorMessage } from '@/service/client';
import { Dropdown, message, Tooltip } from '@/components/base';
import {
  SelectionToolbarShell,
} from '@/components/rcb/selection/chrome/SelectionToolbarShell';
import AgentComposerInput, {
  chipBaseKey,
  composerAttachmentMediaKind,
  type AgentComposerHandle,
  type ComposerContext,
} from '@/components/editor/panels/AgentComposerInput';
import {
  ComposerAttachmentChip,
  composerAttachActionClass,
} from '@/components/editor/panels/agent/composer/AgentComposerShell';
import { GeneratorComposerPanel } from '@/components/editor/panels/agent/composer/GeneratorComposerPanel';
import ModelPickerPanel, { ModelBrandIcon } from '@/components/editor/panels/agent/models/ModelPickerPanel';
import { buildAudioGeneratorModelList, nextAudioModelId } from '@/components/editor/nodes/shared/generatorModelLists';
import { probeAudioDuration, pickAudioUrl } from '@/components/editor/nodes/shared/mediaProbe';
import { useGeneratorModelsCatalog } from '@/components/editor/panels/agent/composer/useGeneratorModelsCatalog';
import { MEDIA_QUICK_EDIT_ATTR } from '@/components/editor/panels/agent/composer/composerMentionHelpers';
import { clearGeneratorProcessOverlay } from '@/components/editor/nodes/shared/clearGeneratorProcess';
import {
  closeImageToolPanel,
  patchDocumentNode,
  pushEditorHistory,
} from '@/store/modules/editor';
import { cn } from '@/utils/classnames';
import { estimateAudioCredits } from '@/utils/imageCredits';
import { createFilePreviewUrl, finishComposerAttachmentUpload, revokeComposerPreviewUrls } from '@/utils/uploadImage';
import store from '@/store';

type SceneBox = { left: number; top: number; width: number; height: number };

const DEFAULT_AUDIO_MODEL_ID = 'or-gemini-3-1-flash-tts';

function AudioQuickEditComposer({
  document,
  nodeId,
  box,
}: {
  document: SceneDocument;
  nodeId: string;
  box: SceneBox;
}): ReactNode {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const inputRef = useRef<AgentComposerHandle>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const node = document?.deltaSetLike?.[nodeId];
  const src = String(node?.attrs?.src || '').trim();
  const savedPrompt = String(node?.attrs?.genPrompt || '').trim();

  const [prompt, setPrompt] = useState(savedPrompt);
  const [contexts, setContexts] = useState<ComposerContext[]>([]);
  const [sending, setSending] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelId, setModelId] = useState(DEFAULT_AUDIO_MODEL_ID);

  const { models } = useGeneratorModelsCatalog({
    buildList: buildAudioGeneratorModelList,
    modelId,
    setModelId,
    resolveModelId: nextAudioModelId,
    resetKey: nodeId,
  });

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

  useEffect(() => {
    setPrompt(savedPrompt);
  }, [nodeId, savedPrompt]);

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [nodeId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const selectedModel = models.find((m) => m.id === modelId);

  const removeContext = (key: string) =>
    setContexts((prev) => {
      const removed = prev.find((c) => c.key === key);
      if (removed) revokeComposerPreviewUrls(removed);
      return prev.filter((c) => c.key !== key && chipBaseKey(c.key) !== chipBaseKey(key));
    });

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
        const preview = createFilePreviewUrl(file);
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
          const { dataUrl, thumbUrl, uploadKey } = await finishComposerAttachmentUpload(
            file,
            preview
          );
          setContexts((prev) => {
            if (!prev.some((c) => c.key === key)) return prev;
            return prev.map((c) =>
              c.key === key
                ? {
                    ...c,
                    dataUrl,
                    thumbUrl,
                    uploadKey: uploadKey || undefined,
                    uploadStatus: 'ready' as const,
                  }
                : c
            );
          });
        } catch (err: unknown) {
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

  const applyAudioToNode = async (opts: {
    nextSrc: string;
    name: string;
    genPrompt: string;
    uploadKey?: string;
  }) => {
    const duration =
      (await probeAudioDuration(opts.nextSrc)) || undefined;
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          attrs: {
            src: opts.nextSrc,
            genPrompt: opts.genPrompt,
            name: opts.name,
            ...(opts.uploadKey ? { uploadKey: opts.uploadKey } : {}),
            ...(duration != null ? { duration } : {}),
            processStatus: null,
            processKind: null,
            processLabel: null,
          },
        },
      })
    );
    dispatch(closeImageToolPanel());
  };

  const onGenerate = async () => {
    if (sending || attachmentsUploading) return;

    // Local upload shortcut — replace plate src (no TTS).
    if (readyAudioAtt) {
      setSending(true);
      const nextSrc = String(readyAudioAtt.dataUrl || '').trim();
      const text =
        prompt.trim() ||
        String(readyAudioAtt.label || '').trim() ||
        t('editor.tools.audioGenerator', { defaultValue: 'Audio' });
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
              genPrompt: text,
            },
          },
        })
      );
      try {
        if (!nextSrc) throw new Error('missing audio url');
        await applyAudioToNode({
          nextSrc,
          name: text.slice(0, 48),
          genPrompt: text,
          uploadKey: readyAudioAtt.uploadKey || undefined,
        });
      } catch (err: any) {
        const doc = (store.getState() as { editor?: { document?: SceneDocument } }).editor
          ?.document;
        clearGeneratorProcessOverlay(dispatch, doc, nodeId);
        message.error(getHttpErrorMessage(err, t('editor.tools.audioGenFail')));
      } finally {
        setSending(false);
      }
      return;
    }

    const text = prompt.trim();
    if (!text) return;
    if (!models.length) {
      message.warning(t('editor.tools.audioGenNeedModel'));
      return;
    }
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
            genPrompt: text,
          },
        },
      })
    );
    try {
      const res = await generateAudio(
        { prompt: text, model: modelId },
        { signal: ac.signal }
      );
      const nextSrc = pickAudioUrl(res);
      if (!nextSrc) throw new Error(t('editor.tools.audioGenEmpty'));
      if (ac.signal.aborted) return;

      await applyAudioToNode({
        nextSrc,
        name: text.slice(0, 48) || String(node?.attrs?.name || ''),
        genPrompt: text,
      });
    } catch (err: any) {
      if (ac.signal.aborted) return;
      const doc = (store.getState() as { editor?: { document?: SceneDocument } }).editor
        ?.document;
      clearGeneratorProcessOverlay(dispatch, doc, nodeId);
      message.error(getHttpErrorMessage(err, t('editor.tools.audioGenFail')));
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setSending(false);
    }
  };

  if (!node || !src) return null;

  const canSubmit = Boolean(readyAudioAtt || prompt.trim()) && !attachmentsUploading;

  return (
    <SelectionToolbarShell
      box={box}
      bare
      dock="below"
      zIndexClassName="z-[32]"
      data-audio-quick-edit
      {...{ [MEDIA_QUICK_EDIT_ATTR]: true }}
      data-scene-node-id={nodeId}
    >
      <GeneratorComposerPanel size="audio" overflow="visible">
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
          {attachments.map((att) => (
            <ComposerAttachmentChip
              key={att.key}
              attachment={att}
              disabled={sending}
              onRemove={removeContext}
            />
          ))}
          <Tooltip tip={t('editor.tools.audioGenUpload')} placement="top">
            <button
              type="button"
              disabled={sending}
              aria-label={t('editor.tools.audioGenUpload')}
              onClick={() => fileRef.current?.click()}
              className={composerAttachActionClass()}
            >
              <HiOutlinePlus className="h-4 w-4" strokeWidth={2} />
            </button>
          </Tooltip>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              onPickFile(e);
            }}
          />
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
            onSubmit={() => {
              onGenerate();
            }}
            disabled={sending}
            placeholder={t('editor.tools.audioGenPlaceholder')}
            className="min-h-full w-full text-[13px]"
          />
        </div>

        <div className="mt-1 flex items-center gap-1.5 px-2.5 pb-2">
          <div className="flex-1" />
          {!readyAudioAtt && models.length > 0 ? (
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
            disabled={sending || !canSubmit}
            aria-label={t('agent.send')}
            onClick={() => {
              onGenerate();
            }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ink)] text-[var(--on-brand)] disabled:opacity-40"
          >
            <HiArrowUp className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </GeneratorComposerPanel>
    </SelectionToolbarShell>
  );
}

export default memo(AudioQuickEditComposer);
