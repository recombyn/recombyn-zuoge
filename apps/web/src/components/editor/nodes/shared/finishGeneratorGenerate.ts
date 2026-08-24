import type { MutableRefObject } from 'react';
import type { Dispatch } from '@reduxjs/toolkit';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import {
  clearGeneratorProcessOverlay,
  ensureGeneratorProcessCleared,
} from '@/components/editor/nodes/shared/clearGeneratorProcess';
import { unregisterGeneratorSession } from '@/components/editor/nodes/shared/generatorSessionRegistry';
import store from '@/store';

export function finishGeneratorGenerateSession(opts: {
  dispatch: Dispatch;
  nodeId: string;
  finished: boolean;
  abortRef: MutableRefObject<AbortController | null>;
  ac: AbortController;
  setSending: (v: boolean) => void;
}) {
  const { dispatch, nodeId, finished, abortRef, ac, setSending } = opts;
  unregisterGeneratorSession(nodeId);
  const doc = (store.getState() as { editor?: { document?: SceneDocument } }).editor?.document;
  if (!finished) {
    clearGeneratorProcessOverlay(dispatch, doc, nodeId);
  } else {
    ensureGeneratorProcessCleared(dispatch, doc, nodeId);
  }
  if (abortRef.current === ac) abortRef.current = null;
  setSending(false);
}
