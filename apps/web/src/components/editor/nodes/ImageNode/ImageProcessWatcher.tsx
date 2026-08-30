import { useEffect, useRef, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import i18n from '@/i18n';
import { message } from '@/components/base';
import {
  formatProcessProgressLabel,
  processJobAttrPatch,
  readProcessJobIds,
  stripProcessProgressLabel,
} from '@/components/rcb/scene/document/processJobAttrs';
import {
  AI_IMAGE_PROCESS_KINDS,
  processImageToolAsync,
  useImageToolCapabilities,
  type ImageProcessResult,
} from '@/service/imageTools';
import { isUploadAbortError, uploadImageFromSrc } from '@/utils/uploadImage';
import { getHttpErrorMessage } from '@/service/client';
import { refreshWalletAfterSpend } from '@/service/wallet';
import {
  failImageProcess,
  finishImageProcess,
  patchDocumentNode,
} from '@/store/modules/editor';
import type { SceneNodeInput } from '@/components/rcb/sceneNode';

const DECOMPOSE_KINDS = new Set(['editText', 'editElements']);

function tt(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, opts));
}

function parseMeta(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function aspectFromBox(w: number, h: number): string {
  const rw = Math.max(1, Math.round(w));
  const rh = Math.max(1, Math.round(h));
  const g = (a: number, b: number): number => (b === 0 ? a : g(b, a % b));
  const d = g(rw, rh) || 1;
  return `${Math.round(rw / d)}:${Math.round(rh / d)}`;
}

function resolutionFor(kind: string, node: SceneNodeInput): string | undefined {
  if (kind !== 'upscale') return undefined;
  const meta = parseMeta(node?.attrs?.processMeta);
  const fromMeta = String(meta.resolution || '')
    .trim()
    .toUpperCase();
  if (fromMeta === '2K' || fromMeta === '4K') return fromMeta;
  const tw = Number(node?.attrs?.processTargetWidth) || 0;
  if (tw >= 3500) return '4K';
  return '2K';
}

/** Persist tool output on our file server. */
async function persistProcessedSrc(src: string, filename: string): Promise<string> {
  const raw = String(src || '').trim();
  if (!raw) throw new Error('empty processed image');
  const uploaded = await uploadImageFromSrc(raw, filename);
  const url = String(uploaded.url || '').trim();
  if (!url) throw new Error('upload returned no url');
  return url;
}

async function refreshWallet() {
  refreshWalletAfterSpend();
}

/** Prefer backend ``message``; FE i18n only for client-only / empty fallbacks. */
function processFailMessage(err: unknown): string {
  const msg = getHttpErrorMessage(err, '');
  if (msg.trim()) return msg;
  if (
    /timeout/i.test(String((err as Error)?.message || '')) ||
    (err as { code?: string })?.code === 'ECONNABORTED'
  ) {
    return tt('editor.imageToolbar.processTimeout');
  }
  return tt('editor.imageToolbar.processFailed');
}

function buildFinishAttrsForKind(
  kind: string,
  opts: {
    sourceGenPrompt?: string;
    replacedCopy?: string;
  }
): Record<string, unknown> | undefined {
  if (kind === 'removeBg' || kind === 'eraser') {
    return {
      cutout: 'true',
      name:
        kind === 'eraser'
          ? tt('editor.imageToolbar.nameEraser')
          : tt('editor.imageToolbar.nameCutout'),
    };
  }
  if (kind === 'replaceText' && opts.replacedCopy) {
    return {
      letteringText: opts.replacedCopy,
      genPrompt: [String(opts.sourceGenPrompt || '').trim(), `Text replaced to: ${opts.replacedCopy}`]
        .filter(Boolean)
        .join('\n'),
    };
  }
  return undefined;
}

async function finishDecomposeResult(
  dispatch: ReturnType<typeof useDispatch>,
  pendingId: string,
  kind: string,
  res: ImageProcessResult,
  cancelled: () => boolean
) {
  const layers = Array.isArray(res?.layers) ? res.layers : [];
  if (!layers.length || !DECOMPOSE_KINDS.has(kind)) return false;

  const persisted = await Promise.all(
    layers.map(async (layer: any, i: number) => {
      const src = String(layer?.src || '').trim();
      if (!src || String(layer?.type) === 'text' || /^https?:\/\//i.test(src)) return layer;
      return { ...layer, src: await persistProcessedSrc(src, `${kind}-layer-${i + 1}.png`) };
    })
  );
  if (cancelled()) return true;

  dispatch(
    finishImageProcess({
      nodeId: pendingId,
      layers: persisted,
      sourceWidth: Number(res.width) || undefined,
      sourceHeight: Number(res.height) || undefined,
    })
  );
  const warn = Array.isArray(res.warnings) ? res.warnings.filter(Boolean) : [];
  if (warn.length) {
    message.warning(warn.slice(0, 3).join('；'));
  } else {
    const textCount = layers.filter((l: any) => String(l?.type) === 'text').length;
    const rasterCount = layers.filter((l: any) => l?.letteringText).length;
    if (kind === 'editElements') {
      message.success(tt('editor.imageToolbar.doneEditElementsHint'));
    } else if (rasterCount > 0 && textCount > 0) {
      message.success(
        tt('editor.imageToolbar.doneOcrMixed', { textCount, rasterCount })
      );
    } else if (textCount > 0) {
      message.success(tt('editor.imageToolbar.doneOcrEditable', { count: textCount }));
    } else {
      message.success(tt('editor.imageToolbar.doneOcr'));
    }
  }
  await refreshWallet();
  return true;
}

/**
 * Completes spawned image process jobs via async backend jobs + SSE progress.
 * Results are uploaded to our file server when still inline data URLs.
 */
function ImageProcessWatcher() {
  const dispatch = useDispatch();
  useImageToolCapabilities();
  const pendingId = useSelector((s: any) => s.editor.pendingImageProcessId as string | null);
  const document = useSelector((s: any) => s.editor.document);
  const documentRef = useRef(document);
  documentRef.current = document;

  useEffect(() => {
    if (!pendingId) return undefined;
    const doc = documentRef.current;
    const node = doc?.deltaSetLike?.[pendingId];
    const kind = String(node?.attrs?.processKind || '');
    if (kind === 'import' || kind === 'upload') return undefined;

    let cancelled = false;
    const ac = new AbortController();
    const isCancelled = () => cancelled;

    const fail = (msg: string) => {
      if (cancelled) return;
      message.error(msg);
      dispatch(failImageProcess({ nodeId: pendingId }));
    };

    const run = async () => {
      if (!AI_IMAGE_PROCESS_KINDS.has(kind)) {
        fail(`unsupported image process kind: ${kind || 'unknown'}`);
        return;
      }

      const latest = documentRef.current;
      const liveNode = latest?.deltaSetLike?.[pendingId] || node;
      const sourceId = String(liveNode?.attrs?.processSourceId || '');
      const sourceNode = sourceId ? latest?.deltaSetLike?.[sourceId] : null;
      const image = String(sourceNode?.attrs?.src || liveNode?.attrs?.src || '');
      if (!image) {
        fail(tt('editor.imageToolbar.imageNotFound'));
        return;
      }

      const w = Number(liveNode?.width) || Number(sourceNode?.width) || 1024;
      const h = Number(liveNode?.height) || Number(sourceNode?.height) || 1024;
      const meta = parseMeta(liveNode?.attrs?.processMeta);
      const labelBase = stripProcessProgressLabel(String(liveNode?.attrs?.processLabel || ''));

      try {
        const processBody: {
          kind: string;
          image: string;
          meta?: Record<string, unknown>;
          aspect_ratio?: string;
          quality?: string;
          resolution?: string;
        } = {
          kind,
          image,
          quality: 'high',
        };
        if (meta) processBody.meta = meta;
        const aspect = aspectFromBox(w, h);
        if (aspect) processBody.aspect_ratio = aspect;
        const resolution = resolutionFor(kind, liveNode);
        if (resolution) processBody.resolution = resolution;

        const existingJobIds = readProcessJobIds(liveNode);
        const res = await processImageToolAsync(processBody, {
          signal: ac.signal,
          jobId: existingJobIds[0],
          onProgress: (pct) => {
            if (cancelled) return;
            dispatch(
              patchDocumentNode({
                nodeId: pendingId,
                skipHistory: true,
                patch: {
                  attrs: {
                    processLabel: formatProcessProgressLabel(
                      labelBase,
                      pct,
                      labelBase || '处理中'
                    ),
                  },
                },
              })
            );
          },
          onJobCreated: (jobId) => {
            if (cancelled) return;
            dispatch(
              patchDocumentNode({
                nodeId: pendingId,
                skipHistory: true,
                patch: { attrs: processJobAttrPatch([jobId]) },
              })
            );
          },
        });
        if (cancelled) return;

        if (await finishDecomposeResult(dispatch, pendingId, kind, res, isCancelled)) return;

        const svgMarkup = String(res?.svg || '').trim();
        if (kind === 'vector' || svgMarkup) {
          if (!svgMarkup) {
            fail(tt('editor.imageToolbar.processNoResult'));
            return;
          }
          dispatch(
            finishImageProcess({
              nodeId: pendingId,
              svg: svgMarkup,
              attrs: { name: tt('editor.imageToolbar.nameVector') },
            })
          );
          message.success(tt('editor.imageToolbar.doneVector'));
          await refreshWallet();
          return;
        }

        if (!res?.image) {
          fail(tt('editor.imageToolbar.processNoResult'));
          return;
        }
        const storedUrl = await persistProcessedSrc(res.image, `${kind}.png`);
        if (cancelled) return;
        const replaceMeta = kind === 'replaceText' ? parseMeta(liveNode?.attrs?.processMeta) : {};
        const replacedCopy = String(replaceMeta.newText || '').trim();
        const finishAttrs = buildFinishAttrsForKind(kind, {
          sourceGenPrompt: String(sourceNode?.attrs?.genPrompt || ''),
          replacedCopy,
        });
        dispatch(
          finishImageProcess({
            nodeId: pendingId,
            src: storedUrl,
            ...(finishAttrs ? { attrs: finishAttrs } : {}),
          })
        );
        const labels: Record<string, string> = {
          removeBg: tt('editor.imageToolbar.doneRemoveBg'),
          eraser: tt('editor.imageToolbar.doneEraser'),
          upscale: tt('editor.imageToolbar.doneUpscale'),
          multiAngle: tt('editor.imageToolbar.doneMultiAngle'),
          expand: tt('editor.imageToolbar.doneExpand'),
          editText: tt('editor.imageToolbar.doneEditText'),
          editElements: tt('editor.imageToolbar.doneEditElements'),
          replaceText: tt('editor.imageToolbar.doneReplaceText'),
          vector: tt('editor.imageToolbar.doneVector'),
          adjust: tt('editor.imageToolbar.doneAdjust'),
        };
        message.success(labels[kind] || tt('editor.imageToolbar.doneGeneric'));
        await refreshWallet();
      } catch (err: any) {
        if (cancelled || isUploadAbortError(err)) return;
        fail(processFailMessage(err));
      }
    };

    run();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [pendingId, dispatch]);

  return null;
}

export default memo(ImageProcessWatcher);
