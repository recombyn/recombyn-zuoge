/**
 * Design Engine V3 acceptance 06–09 (Phase 1 gate).
 * 01–05 / 07 host / 10 live in apps/api/tests/design_engine/test_v3_acceptance.py
 */
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import store from '@/store';
import {
  editorReducers,
  reduceEditor,
  applyCollabDocument,
  beginAiSceneMutation,
  endAiSceneMutation,
  patchDocumentNode,
  setAiOperationState,
  setDocument,
} from '@/store/modules/editor';
import { createEmptyDocument } from '@/components/rcb/scene/document/sceneDocument';
import {
  applyLocalSceneToY,
  sceneFromYDoc,
  yBootMap,
} from '@/components/editor/collab/sceneYBridge';
import {
  applySceneMutation,
  rebaseSceneMutationOps,
} from '../designTools';
import { setAllowedCanvasToolKeys } from '../toolOpsContract';
import {
  aiQueueAckStatus,
  aiQueueBegin,
  aiQueueCancel,
  aiQueueEnqueue,
  aiQueueMarkApplied,
  aiQueueRollback,
  aiQueueShouldSkipHistory,
  createAiOperationQueue,
} from '../runDesignAgent';

const op = (id: string) => ({ name: 'create_text', op_id: id, args: { id } });

function editorStore() {
  return {
    getState: () => ({ editor: store.getState().editor }),
  };
}

function sceneDoc(nodeIds: string[], frameIds = ['f1']) {
  return {
    deltaSetLike: Object.fromEntries(nodeIds.map((id) => [id, { id }])),
    frames: frameIds.map((id) => ({ id })),
    activeFrameId: frameIds[0] || null,
  };
}

describe('V3 acceptance 06 — AI Transaction Undo', () => {
  it('one transaction is one history group; rollback undoes once', () => {
    const q = createAiOperationQueue();
    aiQueueBegin(q, { transactionId: 'tx_undo', phase: 'paint', baseRevision: 3 });
    expect(aiQueueShouldSkipHistory(q, 'tx_undo')).toBe(false);
    expect(aiQueueEnqueue(q, [op('a'), op('b')])).toBe(true);
    aiQueueMarkApplied(q, {
      historyPushed: true,
      opResults: [
        { op_id: 'a', name: 'create_text', ok: true },
        { op_id: 'b', name: 'create_text', ok: true },
      ],
    });
    expect(aiQueueShouldSkipHistory(q, 'tx_undo')).toBe(true);
    expect(aiQueueEnqueue(q, [op('c')])).toBe(true);
    aiQueueMarkApplied(q, {
      historyPushed: false,
      opResults: [{ op_id: 'c', name: 'create_text', ok: true }],
    });
    expect(aiQueueRollback(q, 'tx_undo')).toBe(true);
    expect(aiQueueAckStatus(q)).toBe('rollback');
    expect(aiQueueRollback(q, 'tx_undo')).toBe(false);
  });
});

describe('V3 acceptance 07 — AI mid-fail Rollback', () => {
  it('cancel after partial apply reports rollback once', () => {
    const q = createAiOperationQueue();
    aiQueueBegin(q, { transactionId: 'tx_fail' });
    aiQueueEnqueue(q, [op('a')]);
    aiQueueMarkApplied(q, { historyPushed: true, opResults: [{ op_id: 'a', name: 'create_text', ok: true }] });
    expect(aiQueueCancel(q)).toBe(true);
    expect(q.status).toBe('cancelled');
    expect(q.pending).toHaveLength(0);
    expect(aiQueueAckStatus(q)).toBe('rollback');
    expect(aiQueueCancel(q)).toBe(false);
  });
});

describe('V3 acceptance 08 — user edit then AI revision conflict', () => {
  it('rebases living updates; rejects live deletes (no silent overwrite)', async () => {
    setAllowedCanvasToolKeys(['update_node', 'delete_nodes', 'create_text']);
    const rebased = rebaseSceneMutationOps(
      [
        { name: 'update_node', op_id: 'u1', args: { nodeId: 'title', text: '新' } },
        { name: 'update_node', op_id: 'u2', args: { nodeId: 'gone', text: 'x' } },
      ],
      sceneDoc(['title'])
    );
    expect(rebased.action).toBe('rebase');
    expect(rebased.ops.map((o) => o.op_id)).toEqual(['u1']);

    const execute = vi.fn(async () => ({ opResults: [] }));
    const denied = await applySceneMutation({
      source: 'ai',
      ops: [{ name: 'delete_nodes', op_id: 'd1', args: { nodeIds: ['title'] } }],
      allowDestructive: true,
      baseRevision: 4,
      currentRevision: 9,
      document: sceneDoc(['title']),
      skipHistory: true,
      execute,
    });
    expect(denied.ok).toBe(false);
    expect(denied.revisionAction).toBe('reject');
    expect(denied.reason).toBe('revision_conflict');
    expect(execute).not.toHaveBeenCalled();
    setAllowedCanvasToolKeys([]);
  });
});

describe('V3 acceptance 09 — Yjs collab + AI mutation', () => {
  it('AI overlay never enters SceneDocument or Y.Doc', () => {
    const store = editorStore();
    const scene = createEmptyDocument({ width: 1080, height: 1920 });
    setDocument(scene);
    setAiOperationState({
        active: true,
        transactionId: 'tx_overlay',
        nodeId: 'hero',
        label: 'painting',
      });
    const editor = store.getState().editor;
    expect(editor.aiOperationState?.active).toBe(true);
    expect(editor.document).not.toBeNull();
    expect(JSON.stringify(editor.document)).not.toContain('tx_overlay');
    expect(JSON.stringify(editor.document)).not.toContain('painting');

    const ydoc = new Y.Doc();
    applyLocalSceneToY(ydoc, editor.document);
    const exported = sceneFromYDoc(ydoc);
    expect(JSON.stringify(exported)).not.toContain('tx_overlay');
    expect(yBootMap(ydoc).get('aiOperationState')).toBeUndefined();
  });

  it('AI lock does not bump sceneRevision per op; collab remote change does', () => {
    const store = editorStore();
    const scene = createEmptyDocument({ width: 1080, height: 1920 });
    scene.deltaSetLike = {
      ...(scene.deltaSetLike || {}),
      hero: {
        id: 'hero',
        key: 'shape',
        x: 10,
        y: 10,
        width: 100,
        height: 80,
        attrs: { shapeType: 'rect' },
        children: [],
      },
    };
    setDocument(scene);
    const afterSeed = store.getState().editor.sceneRevision;

    beginAiSceneMutation();
    patchDocumentNode({
        nodeId: 'hero',
        patch: { width: 160 },
        skipHistory: true,
      });
    expect(store.getState().editor.sceneRevision).toBe(afterSeed);
    endAiSceneMutation();
    const afterAi = store.getState().editor.sceneRevision;
    expect(afterAi).toBe(afterSeed + 1);

    const remote = structuredClone(store.getState().editor.document);
    if (remote?.deltaSetLike?.hero) {
      remote.deltaSetLike.hero = { ...remote.deltaSetLike.hero, width: 200 };
    }
    applyCollabDocument(remote);
    expect(store.getState().editor.sceneRevision).toBe(afterAi + 1);
    expect(store.getState().editor.document?.deltaSetLike?.hero?.width).toBe(200);
  });
});
