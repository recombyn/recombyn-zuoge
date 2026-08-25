import { useEffect, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { message } from '@/components/base';
import {
  readProcessJobIds,
  isStaleProcessJob,
  stripProcessProgressLabel,
} from '@/components/rcb/scene/document/processJobAttrs';
import { waitForUploadJob } from '@/service/uploadJobs';
import { getHttpErrorMessage } from '@/service/client';
import { buildUploadFinishAttrs } from '@/utils/canvasUploadFlow';
import {
  hasActiveNodeUpload,
  isUploadAbortError,
  waitForImageReady,
} from '@/utils/uploadImage';
import {
  failImageProcess,
  finishImageProcess,
  patchDocumentNode,
} from '@/store/modules/editor';
import type { SceneNodeInput } from '@/components/rcb/sceneNode';

/**
 * After refresh, resume in-flight upload jobs from persisted job ids.
 * Fresh uploads in the same tab are owned by canvas upload helpers (nodeUploadAborts).
 */
function UploadJobWatcher() {
  const dispatch = useDispatch();
  const pendingId = useSelector(
    (s: { editor?: { pendingImageProcessId?: string | null } }) =>
      s.editor?.pendingImageProcessId ?? null
  );
  const document = useSelector(
    (s: { editor?: { document?: { deltaSetLike?: Record<string, SceneNodeInput> } } }) =>
      s.editor?.document
  );

  useEffect(() => {
    if (!pendingId) return undefined;
    const node = document?.deltaSetLike?.[pendingId];
    const kind = String(node?.attrs?.processKind || '');
    if (kind !== 'upload') return undefined;
    if (hasActiveNodeUpload(pendingId)) return undefined;

    let cancelled = false;
    const ac = new AbortController();
    const jobIds = readProcessJobIds(node);

    const fail = (msg: string) => {
      if (cancelled) return;
      message.error(msg);
      dispatch(failImageProcess({ nodeId: pendingId }));
    };

    const run = async () => {
      if (!jobIds.length) {
        fail('上传已中断，请重新选择文件');
        return;
      }
      if (isStaleProcessJob(node)) {
        dispatch(failImageProcess({ nodeId: pendingId }));
        return;
      }

      const labelBase = stripProcessProgressLabel(String(node?.attrs?.processLabel || ''), '上传中');
      const assetKind = String(node?.attrs?.assetKind || '').trim();
      const isRaster = assetKind !== 'video' && assetKind !== 'audio';

      try {
        const uploaded = await waitForUploadJob(jobIds[0], {
          signal: ac.signal,
          onProgress: (pct) => {
            if (cancelled) return;
            dispatch(
              patchDocumentNode({
                nodeId: pendingId,
                skipHistory: true,
                patch: {
                  attrs: { processLabel: `${labelBase} ${Math.round(pct)}%` },
                },
              })
            );
          },
        });
        if (cancelled) return;

        const remoteReady = isRaster
          ? await waitForImageReady(uploaded.url, { signal: ac.signal })
          : true;
        if (cancelled) return;

        dispatch(
          finishImageProcess({
            nodeId: pendingId,
            ...(remoteReady ? { src: uploaded.url } : {}),
            attrs: buildUploadFinishAttrs(node?.attrs, uploaded),
          })
        );
      } catch (err: unknown) {
        if (cancelled || isUploadAbortError(err)) return;
        fail(getHttpErrorMessage(err, '上传失败'));
      }
    };

    run();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [pendingId, document, dispatch]);

  return null;
}

export default memo(UploadJobWatcher);
