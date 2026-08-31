/**
 * Design-tool test harness backed by the real Zustand editor store.
 */
import { useAppStore } from '@/store';
import {
  editorInitialState,
  type EditorState,
} from '@/store/modules/editor';
import { createEmptyDocument } from '@/components/rcb/scene/document/sceneDocument';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import type { DesignToolContext } from '../designTools';

function writeEditor(partial: Partial<EditorState>) {
  useAppStore.setState((prev) => ({
    ...prev,
    editor: {
      ...prev.editor,
      ...partial,
    },
  }));
}

export function createDesignToolHarness(opts?: {
  doc?: SceneDocument;
  targetFrameId?: string | null;
  width?: number;
  height?: number;
}) {
  const doc =
    opts?.doc ||
    createEmptyDocument({
      width: opts?.width ?? 1440,
      height: opts?.height ?? 900,
    });

  writeEditor({
    ...editorInitialState,
    document: doc,
    currentId: 'harness',
  });

  const ctx = {
    getDocument: () => useAppStore.getState().editor.document,
    skipHistory: true,
    allowDestructive: true,
    targetFrameId: opts?.targetFrameId ?? null,
  } as DesignToolContext;

  return {
    ctx,
    getDoc: () => useAppStore.getState().editor.document as SceneDocument,
    setDoc: (next: SceneDocument) => {
      writeEditor({ document: next });
    },
    getActiveTool: () => useAppStore.getState().editor.activeTool,
    getGridMode: () => Boolean(useAppStore.getState().editor.isGridMode),
  };
}
