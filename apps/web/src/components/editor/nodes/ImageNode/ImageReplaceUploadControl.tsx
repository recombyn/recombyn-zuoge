import { message } from '@/components/base';
import { getHttpErrorMessage } from '@/service/client';
import {
  uploadImageFile,
  createFilePreviewUrl,
  beginNodeUpload,
  finishNodeUpload,
  revokeFilePreviewUrl,
  waitForImageReady,
} from '@/utils/uploadImage';
import { measureImageNaturalSize } from '@/components/rcb/scene/document/nodeFactories';
import { finishImageProcess, patchDocumentNode } from '@/store/modules/editor';

type DispatchLike = (action: unknown) => unknown;

function heightForKeepWidth(keepWidth: number, nw: number, nh: number): number {
  return Math.max(1, Math.round((keepWidth * nh) / Math.max(1, nw)));
}

/**
 * Replace an image node's media (upload to COS). Keeps node width; height follows aspect.
 */
export async function replaceImageNodeFromFile(opts: {
  nodeId: string;
  keepWidth: number;
  file: File;
  isAlive?: () => boolean;
}): Promise<void> {
  const { nodeId, file } = opts;
  const keepWidth = Math.max(1, Math.round(opts.keepWidth));
  const alive = opts.isAlive ?? (() => true);
  if (!file.type.startsWith('image/')) return;

  let preview = '';
  try {
    preview = createFilePreviewUrl(file);
    const naturalPreview = await measureImageNaturalSize(preview);
    if (!alive()) return;

    patchDocumentNode({
        nodeId,
        patch: {
          width: keepWidth,
          height: heightForKeepWidth(keepWidth, naturalPreview.width, naturalPreview.height),
          attrs: {
            src: preview,
            processStatus: 'running',
            processKind: 'upload',
            processLabel: '上传中',
            processStartedAt: String(Date.now()),
            genPrompt: '',
            imageVariants: '',
          },
        },
      });

    const signal = beginNodeUpload(nodeId);
    try {
      const uploaded = await uploadImageFile(file, { signal, nodeId });
      if (!alive()) return;

      const src = uploaded.url;
      const remoteReady = await waitForImageReady(src);
      if (!alive()) return;

      let naturalW = Number(uploaded.width) || 0;
      let naturalH = Number(uploaded.height) || 0;
      if (!(naturalW > 0 && naturalH > 0)) {
        const natural = await measureImageNaturalSize(remoteReady ? src : preview);
        naturalW = natural.width;
        naturalH = natural.height;
      }

      const assetKind =
        file.type === 'image/svg+xml' || String(uploaded.mime || '').includes('svg')
          ? 'icon'
          : 'image';

      finishImageProcess({
          nodeId,
          ...(remoteReady ? { src } : {}),
          attrs: {
            assetKind,
            genPrompt: '',
            imageVariants: '',
            ...(uploaded.key ? { uploadKey: uploaded.key } : {}),
          },
        });
      revokeFilePreviewUrl(preview);
      patchDocumentNode({
          nodeId,
          patch: {
            width: keepWidth,
            height: heightForKeepWidth(keepWidth, naturalW, naturalH),
            attrs: { genPrompt: '', imageVariants: '' },
          },
          skipHistory: true,
        });
    } finally {
      finishNodeUpload(nodeId);
    }
  } catch (err: unknown) {
    if (!alive()) return;
    revokeFilePreviewUrl(preview);
    finishImageProcess({ nodeId });
    message.error(getHttpErrorMessage(err, '替换图片失败'));
  }
}
