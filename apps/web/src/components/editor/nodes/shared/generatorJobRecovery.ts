import type { Dispatch } from '@reduxjs/toolkit';
import {
  listImageVariantUrls,
  writeImageVariantsAttr,
} from '@/components/rcb/scene/document/mediaLifecycle';
import {
  isAudioGeneratorNode,
  isImageGeneratorNode,
  isLottieGeneratorNode,
  isVideoGeneratorNode,
} from '@/components/rcb/scene/document/nodeCapabilities';
import { readProcessJobIds, isStaleProcessJob } from '@/components/rcb/scene/document/processJobAttrs';
import { AI_IMAGE_PROCESS_KINDS } from '@/service/imageTools';
import {
  captureVideoPosterFrame,
  parseLottieAnimationData,
} from '@/components/rcb/scene/document/nodeFactories';
import { hasActiveGeneratorSession } from '@/components/editor/nodes/shared/generatorSessionRegistry';
import { waitForImageBatchJobs } from '@/service/generateImageBatch';
import {
  waitForAudioJob,
  waitForLottieJob,
  waitForVideoJob,
} from '@/service/chat';
import {
  clearImageProcess,
  finishAudioGenerator,
  finishImageGenerator,
  finishImageProcess,
  finishLottieGenerator,
  finishVideoGenerator,
} from '@/store/modules/editor';
import type { SceneDocument, SceneNodeInput } from '@/components/rcb/sceneNode';

const RECOVERABLE_KINDS = new Set(['generate', 'quickEdit']);

import {
  pickAudioUrl,
  pickVideoUrl,
  probeAudioDuration,
} from '@/components/editor/nodes/shared/mediaProbe';

export function listRecoverableGeneratorNodes(
  document: SceneDocument | null | undefined
): Array<{ nodeId: string; node: SceneNodeInput }> {
  if (!document?.deltaSetLike) return [];
  const out: Array<{ nodeId: string; node: SceneNodeInput }> = [];
  for (const [nodeId, node] of Object.entries(document.deltaSetLike)) {
    if (!node || String(node.attrs?.processStatus || '') !== 'running') continue;
    const kind = String(node.attrs?.processKind || '').trim();
    if (!RECOVERABLE_KINDS.has(kind)) continue;
    out.push({ nodeId, node });
  }
  return out;
}

/** First upload placeholder that UploadJobWatcher should resume after refresh. */
export function findResumableUploadNodeId(
  document: SceneDocument | null | undefined
): string | null {
  if (!document?.deltaSetLike) return null;
  for (const [nodeId, node] of Object.entries(document.deltaSetLike)) {
    if (!node || String(node.attrs?.processStatus || '') !== 'running') continue;
    if (String(node.attrs?.processKind || '').trim() !== 'upload') continue;
    return nodeId;
  }
  return null;
}

/** First AI-tool process placeholder that ImageProcessWatcher should resume. */
export function findResumableAiProcessNodeId(
  document: SceneDocument | null | undefined
): string | null {
  if (!document?.deltaSetLike) return null;
  for (const [nodeId, node] of Object.entries(document.deltaSetLike)) {
    if (!node || String(node.attrs?.processStatus || '') !== 'running') continue;
    const kind = String(node.attrs?.processKind || '').trim();
    if (AI_IMAGE_PROCESS_KINDS.has(kind)) return nodeId;
  }
  return null;
}

/**
 * Resume a generator / quick-edit job after refresh.
 * - With job ids → SSE until done / failed.
 * - Without job ids / stale → clear SoftGlow (idle plate).
 */
export async function recoverGeneratorNode(
  dispatch: Dispatch,
  document: SceneDocument,
  nodeId: string,
  node: SceneNodeInput,
  opts?: { signal?: AbortSignal }
): Promise<'done' | 'cleared' | 'skipped' | 'failed'> {
  if (hasActiveGeneratorSession(nodeId)) return 'skipped';

  const kind = String(node.attrs?.processKind || '').trim();
  const jobIds = readProcessJobIds(node);

  // No persisted job ids (refresh mid-create) — stop loading and surface failure.
  if (!jobIds.length) {
    dispatch(clearImageProcess({ nodeId }));
    return 'failed';
  }

  // Job ids present but started too long ago — do not poll silently.
  if (isStaleProcessJob(node)) {
    dispatch(clearImageProcess({ nodeId }));
    return 'failed';
  }

  try {
    if (kind === 'quickEdit') {
      const urls = await waitForImageBatchJobs(jobIds, { signal: opts?.signal });
      const nextSrc = urls[0] || '';
      if (!nextSrc) throw new Error('image generation returned no results');

      const prev = listImageVariantUrls(node);
      const stack = [...new Set([nextSrc, ...urls, ...prev.filter((u) => u !== nextSrc)])];
      const variantAttrs: Record<string, unknown> = {};
      writeImageVariantsAttr(variantAttrs, stack);

      dispatch(
        finishImageProcess({
          nodeId,
          src: nextSrc,
          attrs: {
            genPrompt: String(node.attrs?.genPrompt || '').trim() || undefined,
            ...variantAttrs,
          },
        })
      );
      return 'done';
    }

    if (kind === 'generate' && isImageGeneratorNode(node)) {
      const urls = await waitForImageBatchJobs(jobIds, { signal: opts?.signal });
      const src = urls[0] || '';
      if (!src) throw new Error('image generation returned no results');
      dispatch(
        finishImageGenerator({
          nodeId,
          src,
          variants: urls,
          genPrompt: String(node.attrs?.genPrompt || '').trim() || undefined,
        })
      );
      return 'done';
    }

    if (kind === 'generate' && isVideoGeneratorNode(node)) {
      const res = await waitForVideoJob(jobIds[0], { signal: opts?.signal });
      const src = pickVideoUrl(res);
      if (!src) throw new Error('video generation returned no results');
      let poster = '';
      try {
        poster = await captureVideoPosterFrame(src);
      } catch {
        /* optional */
      }
      dispatch(
        finishVideoGenerator({
          nodeId,
          src,
          ...(poster ? { poster } : {}),
          genPrompt: String(node.attrs?.genPrompt || '').trim() || undefined,
        })
      );
      return 'done';
    }

    if (kind === 'generate' && isAudioGeneratorNode(node)) {
      const res = await waitForAudioJob(jobIds[0], { signal: opts?.signal });
      const src = pickAudioUrl(res);
      if (!src) throw new Error('audio generation returned no results');
      const duration = (await probeAudioDuration(src)) || undefined;
      dispatch(
        finishAudioGenerator({
          nodeId,
          src,
          genPrompt: String(node.attrs?.genPrompt || '').trim() || undefined,
          duration,
        })
      );
      return 'done';
    }

    if (kind === 'generate' && isLottieGeneratorNode(node)) {
      const res = await waitForLottieJob(jobIds[0], { signal: opts?.signal });
      const animationData = parseLottieAnimationData(res?.animationData) || null;
      if (!animationData) throw new Error('lottie generation returned no results');
      const sceneW = Math.max(32, Number(node.width) || 200);
      const sceneH = Math.max(32, Number(node.height) || 200);
      const sceneX = Number(node.x) || 0;
      const sceneY = Number(node.y) || 0;
      const aw = Math.max(1, Number(animationData.w) || sceneW);
      const ah = Math.max(1, Number(animationData.h) || sceneH);
      const fit = Math.min(sceneW / aw, sceneH / ah);
      const outW = Math.max(32, Math.round(aw * fit));
      const outH = Math.max(32, Math.round(ah * fit));
      const outX = Math.round(sceneX + (sceneW - outW) / 2);
      const outY = Math.round(sceneY + (sceneH - outH) / 2);
      dispatch(
        finishLottieGenerator({
          nodeId,
          animationData,
          genPrompt: String(node.attrs?.genPrompt || '').trim() || undefined,
          name: String(node.attrs?.genPrompt || '').trim() || undefined,
          width: outW,
          height: outH,
          x: outX,
          y: outY,
        })
      );
      return 'done';
    }

    dispatch(clearImageProcess({ nodeId }));
    return 'failed';
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'skipped';
    if (document.deltaSetLike?.[nodeId]) {
      dispatch(clearImageProcess({ nodeId }));
    }
    return 'failed';
  }
}
