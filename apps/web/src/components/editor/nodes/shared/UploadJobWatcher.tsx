import { useEffect, useRef, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { message } from '@/components/base';
import {
  formatProcessProgressLabel,
  readProcessJobIds,
  stripProcessProgressLabel,
  uploadRecoveryBlockReason,
  uploadRecoveryFailMessage,
} from '@/components/rcb/scene/document/processJobAttrs';
import { resumeOrWaitUploadJob } from '@/service/uploadJobs';
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
import type { SceneDocument } from '@/components/rcb/sceneNode';

function UploadJobWatcher() {
  const dispatch = useDispatch();
  const pendingId = useSelector(
    (s: { editor?: { pendingImageProcessId?: string | null } }) =>
      s.editor?.pendingImageProcessId ?? null
  );
  const document = useSelector(
    (s: { editor?: { document?: SceneDocument } }) => s.editor?.document
  );
  const documentRef = useRef(document);
  documentRef.current = document;

  useEffect(() => {
    if (!pendingId) return undefined;
    const node = documentRef.current?.deltaSetLike?.[pendingId];
    if (String(node?.attrs?.processKind || '') !== 'upload') return undefined;
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
      const liveDoc = documentRef.current;
      const liveNode = liveDoc?.deltaSetLike?.[pendingId] || node;
      const block = uploadRecoveryBlockReason(liveNode);
      if (block) {
        fail(uploadRecoveryFailMessage(block));
        return;
      }

      const labelBase = stripProcessProgressLabel(
        String(liveNode?.attrs?.processLabel || ''),
        '上传中'
      );
      const assetKind = String(liveNode?.attrs?.assetKind || '').trim();
      const isRaster = assetKind !== 'video' && assetKind !== 'audio';
      let lastProgress = -1;

      try {
        const uploaded = await resumeOrWaitUploadJob(jobIds[0], {
          signal: ac.signal,
          onProgress: (pct) => {
            if (cancelled) return;
            const rounded = Math.round(pct);
            if (rounded === lastProgress) return;
            lastProgress = rounded;
            dispatch(
              patchDocumentNode({
                nodeId: pendingId,
                skipHistory: true,
                patch: {
                  attrs: {
                    processLabel: formatProcessProgressLabel(labelBase, rounded, '上传中'),
                  },
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

        const finishNode = documentRef.current?.deltaSetLike?.[pendingId] || liveNode;
        dispatch(
          finishImageProcess({
            nodeId: pendingId,
            ...(remoteReady ? { src: uploaded.url } : {}),
            attrs: buildUploadFinishAttrs(finishNode?.attrs, uploaded),
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
  }, [pendingId, dispatch]);

  return null;
}

export default memo(UploadJobWatcher);
