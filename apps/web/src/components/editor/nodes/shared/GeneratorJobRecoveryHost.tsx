import { memo, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { message } from '@/components/base';
import {
  findResumableAiProcessNodeId,
  findResumableUploadNodeId,
  listRecoverableGeneratorNodes,
  recoverGeneratorNode,
} from '@/components/editor/nodes/shared/generatorJobRecovery';
import { resumePendingImageProcess } from '@/store/modules/editor';
import type { SceneDocument } from '@/components/rcb/sceneNode';

function GeneratorJobRecoveryHost() {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const document = useSelector((s: { editor?: { document?: SceneDocument } }) => s.editor?.document);
  const sceneReloadToken = useSelector(
    (s: { editor?: { sceneReloadToken?: number } }) => s.editor?.sceneReloadToken ?? 0
  );
  const pendingImageProcessId = useSelector(
    (s: { editor?: { pendingImageProcessId?: string | null } }) =>
      s.editor?.pendingImageProcessId ?? null
  );
  const documentRef = useRef(document);
  documentRef.current = document;
  const inflightRef = useRef(new Set<string>());

  useEffect(() => {
    const doc = documentRef.current;
    if (!doc) return undefined;

    if (!pendingImageProcessId) {
      const uploadId = findResumableUploadNodeId(doc);
      if (uploadId) dispatch(resumePendingImageProcess({ nodeId: uploadId }));
      else {
        const aiId = findResumableAiProcessNodeId(doc);
        if (aiId) dispatch(resumePendingImageProcess({ nodeId: aiId }));
      }
    }

    const targets = listRecoverableGeneratorNodes(doc).filter(
      ({ nodeId }) => !inflightRef.current.has(nodeId)
    );
    if (!targets.length) return undefined;

    for (const { nodeId, node } of targets) {
      inflightRef.current.add(nodeId);
      void recoverGeneratorNode(dispatch, doc, nodeId, node)
        .then((result) => {
          if (result === 'cleared') {
            message.warning(t('editor.tools.genRecoverCleared'));
          } else if (result === 'failed') {
            message.error(t('editor.tools.genRecoverFailed'));
          }
        })
        .finally(() => {
          inflightRef.current.delete(nodeId);
        });
    }

    return undefined;
  }, [dispatch, sceneReloadToken, pendingImageProcessId, t]);

  return null;
}

export default memo(GeneratorJobRecoveryHost);
