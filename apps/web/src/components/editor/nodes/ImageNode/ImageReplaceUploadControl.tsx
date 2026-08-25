import { message } from '@/components/base';
import { getHttpErrorMessage } from '@/service/client';
import { uploadImageFile, readFileAsDataUrl, beginNodeUpload, finishNodeUpload, waitForImageReady } from '@/utils/uploadImage';
import {
  measureImageNaturalSize
} from '@/components/rcb/scene/document/nodeFactories';
import { finishImageProcess, patchDocumentNode, resumePendingImageProcess } from '@/store/modules/editor';

type DispatchLike = (action: unknown) => unknown;

/**
 * Replace an image node's media (upload to COS). Keeps node width; height follows aspect.
 */
export async function replaceImageNodeFromFile(opts: {
  dispatch: DispatchLike;
  nodeId: string;
  keepWidth: number;
  file: File;
  isAlive?: () => boolean;
}): Promise<void> {
  const { dispatch, nodeId, file } = opts;
  const keepWidth = Math.max(1, Math.round(opts.keepWidth));
  const alive = opts.isAlive ?? (() => true);
  if (!file.type.startsWith('image/')) return;

  try {
    const preview = await readFileAsDataUrl(file);
    const naturalPreview = await measureImageNaturalSize(preview);
    const previewH = Math.max(
      1,
      Math.round((keepWidth * naturalPreview.height) / Math.max(1, naturalPreview.width))
    );
    if (!alive()) return;
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          width: keepWidth,
          height: previewH,
          attrs: {
            src: preview,
            processStatus: 'running',
            processKind: 'upload',
            processLabel: '上传中',
            // Local replace — drop AI prompt / multi-gen stack so Quick Edit stays empty.
            genPrompt: '',
            imageVariants: '',
          },
        },
      })
    );

    dispatch(resumePendingImageProcess({ nodeId }));
    const signal = beginNodeUpload(nodeId);
    try {
      const uploaded = await uploadImageFile(file, {
        signal,
        dispatch,
        nodeId,
      });
    const src = uploaded.url;
    if (!alive()) return;

    const remoteReady = await waitForImageReady(src);
    if (!alive()) return;

    let naturalW = Number(uploaded.width) || 0;
    let naturalH = Number(uploaded.height) || 0;
    if (!(naturalW > 0 && naturalH > 0)) {
      const natural = await measureImageNaturalSize(remoteReady ? src : preview);
      naturalW = natural.width;
      naturalH = natural.height;
    }
    const height = Math.max(1, Math.round((keepWidth * naturalH) / Math.max(1, naturalW)));
    const assetKind =
      file.type === 'image/svg+xml' || String(uploaded.mime || '').includes('svg')
        ? 'icon'
        : 'image';

    dispatch(
      finishImageProcess({
        nodeId,
        ...(remoteReady ? { src } : {}),
        attrs: {
          assetKind,
          genPrompt: '',
          imageVariants: '',
          ...(uploaded.key ? { uploadKey: uploaded.key } : {}),
        },
      })
    );
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          width: keepWidth,
          height,
          attrs: { genPrompt: '', imageVariants: '' },
        },
        skipHistory: true,
      })
    );
    } finally {
      finishNodeUpload(nodeId);
    }
  } catch (err: any) {
    if (alive()) {
      dispatch(finishImageProcess({ nodeId }));
      message.error(getHttpErrorMessage(err, '替换图片失败'));
    }
  }
}
