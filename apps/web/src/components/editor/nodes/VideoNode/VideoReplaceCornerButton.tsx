import { message } from '@/components/base';
import { getHttpErrorMessage } from '@/service/client';
import {
  uploadImageFile,
  createFilePreviewUrl,
  beginNodeUpload,
  finishNodeUpload,
  revokeFilePreviewUrl,
} from '@/utils/uploadImage';
import {
  captureVideoPosterFrame,
  measureVideoNaturalSize,
} from '@/components/rcb/scene/document/nodeFactories';
import { finishImageProcess, patchDocumentNode } from '@/store/modules/editor';

type DispatchLike = (action: unknown) => unknown;

const CLEAR_CROP_TRIM = {
  cropX: 0,
  cropY: 0,
  cropW: 1,
  cropH: 1,
  trimStart: '',
  trimEnd: '',
} as const;

function heightForKeepWidth(keepWidth: number, nw: number, nh: number): number {
  return Math.max(1, Math.round((keepWidth * nh) / Math.max(1, nw)));
}

async function optionalVideoPoster(src: string): Promise<string> {
  try {
    return await captureVideoPosterFrame(src);
  } catch {
    return '';
  }
}

/**
 * Replace a video node's media (upload to COS). Keeps node width; height follows aspect.
 * Clears prior crop / trim for the new source.
 */
export async function replaceVideoNodeFromFile(opts: {
  nodeId: string;
  keepWidth: number;
  file: File;
  isAlive?: () => boolean;
}): Promise<void> {
  const { nodeId, file } = opts;
  const keepWidth = Math.max(1, Math.round(opts.keepWidth));
  const alive = opts.isAlive ?? (() => true);
  if (!file.type.startsWith('video/')) return;

  let preview = '';
  try {
    preview = createFilePreviewUrl(file);
    const naturalPreview = await measureVideoNaturalSize(preview);
    const previewPoster = await optionalVideoPoster(preview);
    if (!alive()) return;

    patchDocumentNode({
        nodeId,
        patch: {
          width: keepWidth,
          height: heightForKeepWidth(keepWidth, naturalPreview.width, naturalPreview.height),
          attrs: {
            src: preview,
            ...(previewPoster ? { poster: previewPoster } : {}),
            processStatus: 'running',
            processKind: 'upload',
            processLabel: '上传中',
            genPrompt: '',
            ...CLEAR_CROP_TRIM,
          },
        },
      });

    const signal = beginNodeUpload(nodeId);
    try {
      const uploaded = await uploadImageFile(file, { signal, nodeId });
      if (!alive()) return;

      const src = uploaded.url;
      let naturalW = Number(uploaded.width) || 0;
      let naturalH = Number(uploaded.height) || 0;
      if (!(naturalW > 0 && naturalH > 0)) {
        const natural = await measureVideoNaturalSize(src);
        naturalW = natural.width;
        naturalH = natural.height;
      }

      const poster = previewPoster || (await optionalVideoPoster(src));
      finishImageProcess({
          nodeId,
          src,
          attrs: {
            assetKind: 'video',
            genPrompt: '',
            ...(uploaded.key ? { uploadKey: uploaded.key } : {}),
          },
        });
      patchDocumentNode({
          nodeId,
          patch: {
            width: keepWidth,
            height: heightForKeepWidth(keepWidth, naturalW, naturalH),
            attrs: {
              poster: poster || '',
              genPrompt: '',
              ...CLEAR_CROP_TRIM,
            },
          },
          skipHistory: true,
        });
      revokeFilePreviewUrl(preview);
    } finally {
      finishNodeUpload(nodeId);
    }
  } catch (err: unknown) {
    if (!alive()) return;
    revokeFilePreviewUrl(preview);
    finishImageProcess({ nodeId });
    message.error(getHttpErrorMessage(err, '替换视频失败'));
  }
}
