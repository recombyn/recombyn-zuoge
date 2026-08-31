import type { MutableRefObject } from 'react';

import type { SceneDocument } from '@/components/rcb/sceneNode';
import {
  clearGeneratorProcessOverlay,
  ensureGeneratorProcessCleared,
} from '@/components/editor/nodes/shared/clearGeneratorProcess';
import { unregisterGeneratorSession } from '@/components/editor/nodes/shared/generatorSessionRegistry';
import store from '@/store';

export function finishGeneratorGenerateSession(opts: {
  nodeId: string;
  finished: boolean;
  abortRef: MutableRefObject<AbortController | null>;
  ac: AbortController;
  setSending: (v: boolean) => void;
}) {
  const { nodeId, finished, abortRef, ac, setSending } = opts;
  unregisterGeneratorSession(nodeId);
  const doc = (store.getState() as { editor?: { document?: SceneDocument } }).editor?.document;
  if (!finished) {
    clearGeneratorProcessOverlay(doc, nodeId);
  } else {
    ensureGeneratorProcessCleared(doc, nodeId);
  }
  if (abortRef.current === ac) abortRef.current = null;
  // May no-op if the composer already unmounted (selection cleared / processing).
  setSending(false);
}
