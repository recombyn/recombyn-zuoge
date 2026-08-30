/**
 * Shared canvas upload-placeholder flow (spawn node → upload → finish SoftGlow).
 */

import { formatProcessProgressLabel } from '@/components/rcb/scene/document/processJobAttrs';
import type { UploadedFileItem } from '@/service/upload';
import { finishImageProcess, patchDocumentNode } from '@/store/modules/editor';
import {
  beginNodeUpload,
  finishNodeUpload,
  uploadImageFile,
  uploadImageFromSrc,
  waitForImageReady,
  revokeNodePreviewSrc,
} from '@/utils/uploadImage';
import store from '@/store';

type DispatchLike = (action: unknown) => unknown;

export function buildUploadFinishAttrs(
  nodeAttrs: Record<string, unknown> | undefined,
  uploaded: Pick<UploadedFileItem, 'key'>
): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  if (uploaded.key) attrs.uploadKey = uploaded.key;
  const assetKind = String(nodeAttrs?.assetKind || '').trim();
  if (assetKind) attrs.assetKind = assetKind;
  const poster = String(nodeAttrs?.poster || '').trim();
  if (poster) attrs.poster = poster;
  const duration = Number(nodeAttrs?.duration);
  if (Number.isFinite(duration) && duration > 0) attrs.duration = duration;
  return attrs;
}

async function withManagedNodeUpload<T>(
  nodeId: string,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T | undefined> {
  const id = String(nodeId || '').trim();
  if (!id) return fn(new AbortController().signal);
  const signal = beginNodeUpload(id);
  try {
    return await fn(signal);
  } finally {
    finishNodeUpload(id);
  }
}

function finishPlaceholderUpload(
  dispatch: DispatchLike,
  nodeId: string,
  uploaded: UploadedFileItem,
  opts: {
    extraAttrs?: Record<string, unknown>;
    remoteReady?: boolean;
    waitDecode?: boolean;
  }
): void {
  const attrs = {
    ...(uploaded.key ? { uploadKey: uploaded.key } : {}),
    ...opts.extraAttrs,
  };
  const useRemote = opts.waitDecode === false || opts.remoteReady;
  // Only drop the local blob after a usable remote URL is applied — otherwise a
  // bad S3/public URL leaves a huge empty plate with a revoked blob: src.
  if (useRemote) {
    const doc = (store.getState() as { editor?: { document?: unknown } }).editor?.document;
    revokeNodePreviewSrc(doc as Parameters<typeof revokeNodePreviewSrc>[0], nodeId);
  }
  dispatch(
    finishImageProcess({
      nodeId,
      ...(useRemote ? { src: uploaded.url } : {}),
      attrs,
    })
  );
}

/** Upload a file for a spawned placeholder node. */
export async function uploadCanvasPlaceholderFile(opts: {
  dispatch: DispatchLike;
  nodeId: string;
  file: File;
  extraAttrs?: Record<string, unknown>;
  /** Default true — decode remote image before swapping off local preview. */
  waitDecode?: boolean;
}): Promise<boolean> {
  const id = String(opts.nodeId || '').trim();
  if (!id) return false;
  const waitDecode = opts.waitDecode !== false;

  const done = await withManagedNodeUpload(id, async (signal) => {
    const uploaded = await uploadImageFile(opts.file, {
      signal,
      dispatch: opts.dispatch,
      nodeId: id,
      onProgress: (pct) => {
        if (signal.aborted) return;
        opts.dispatch(
          patchDocumentNode({
            nodeId: id,
            skipHistory: true,
            patch: {
              attrs: { processLabel: formatProcessProgressLabel('上传中', pct, '上传中') },
            },
          })
        );
      },
    });
    if (signal.aborted) return false;

    const remoteReady = waitDecode
      ? await waitForImageReady(uploaded.url, { signal })
      : true;
    if (signal.aborted) return false;

    finishPlaceholderUpload(opts.dispatch, id, uploaded, {
      extraAttrs: opts.extraAttrs,
      remoteReady,
      waitDecode,
    });
    return true;
  });
  return done ?? false;
}

/** Upload a remote/data URL into a spawned placeholder node. */
export async function uploadCanvasPlaceholderSrc(opts: {
  dispatch: DispatchLike;
  nodeId: string;
  src: string;
  filename?: string;
  extraAttrs?: Record<string, unknown>;
}): Promise<boolean> {
  const id = String(opts.nodeId || '').trim();
  if (!id) return false;

  const done = await withManagedNodeUpload(id, async (signal) => {
    const uploaded = await uploadImageFromSrc(opts.src, opts.filename || 'upload.png', {
      signal,
      dispatch: opts.dispatch,
      nodeId: id,
    });
    if (signal.aborted) return false;
    if (!uploaded?.url) throw new Error('upload returned no url');

    const remoteReady = await waitForImageReady(uploaded.url, { signal });
    if (signal.aborted) return false;
    finishPlaceholderUpload(opts.dispatch, id, uploaded, {
      extraAttrs: opts.extraAttrs,
      remoteReady,
      waitDecode: true,
    });
    return true;
  });
  return done ?? false;
}
