/**
 * PR6 — AIOperationQueue: enqueue / drain / pause / cancel / rollback.
 * Apply still happens via companion tool_ops; the queue owns grouping + halt.
 */
import { describe, expect, it } from 'vitest';
import {
  overlayFromToolOps,
  overlayLabelForAction,
} from '../runDesignAgent';
import {
  aiQueueAckStatus,
  aiQueueBegin,
  aiQueueBindTransaction,
  aiQueueCancel,
  aiQueueCommit,
  aiQueueEnqueue,
  aiQueueFlushResults,
  aiQueueMarkApplied,
  aiQueuePause,
  aiQueueRollback,
  aiQueueShouldSkipHistory,
  aiQueueTakeChunk,
  createAiOperationQueue,
  type ToolOpResult,
} from '../runDesignAgent';

const op = (id: string) => ({ name: 'create_text', op_id: id, args: { id } });

function result(id: string, ok = true): ToolOpResult {
  return { op_id: id, name: 'create_text', ok };
}

describe('AIOperationQueue', () => {
  it('begin → enqueue chunks → take in order → commit', () => {
    const q = createAiOperationQueue();
    aiQueueBegin(q, { transactionId: 'tx_1', phase: 'paint', baseRevision: 42 });
    expect(q.status).toBe('open');
    expect(aiQueueEnqueue(q, [op('a'), op('b')])).toBe(true);
    expect(aiQueueEnqueue(q, [op('c')])).toBe(true);
    expect(aiQueueTakeChunk(q)?.map((o) => o.op_id)).toEqual(['a', 'b']);
    expect(q.status).toBe('applying');
    aiQueueMarkApplied(q, { historyPushed: true, opResults: [result('a'), result('b')] });
    expect(aiQueueShouldSkipHistory(q, 'tx_1')).toBe(true);
    expect(aiQueueTakeChunk(q)?.map((o) => o.op_id)).toEqual(['c']);
    aiQueueMarkApplied(q, { historyPushed: false, opResults: [result('c')] });
    aiQueueCommit(q, 'tx_1');
    expect(q.status).toBe('committed');
    expect(aiQueueTakeChunk(q)).toBeNull();
    expect(aiQueueFlushResults(q)).toHaveLength(3);
    expect(aiQueueAckStatus(q)).toBe('ack');
  });

  it('groups history: first apply pushes, later chunks skip', () => {
    const q = createAiOperationQueue();
    aiQueueBegin(q, { transactionId: 'tx_h' });
    expect(aiQueueShouldSkipHistory(q, 'tx_h')).toBe(false);
    aiQueueMarkApplied(q, { historyPushed: true, opResults: [] });
    expect(aiQueueShouldSkipHistory(q, 'tx_h')).toBe(true);
    expect(aiQueueShouldSkipHistory(q, '')).toBe(false);
    expect(aiQueueShouldSkipHistory(q, 'tx_other')).toBe(false);
  });

  it('pause stops takeChunk and keeps pending', () => {
    const q = createAiOperationQueue();
    aiQueueBegin(q, { transactionId: 'tx_p' });
    aiQueueEnqueue(q, [op('a')]);
    aiQueueEnqueue(q, [op('b')]);
    aiQueuePause(q);
    expect(q.status).toBe('paused');
    expect(aiQueueTakeChunk(q)).toBeNull();
    expect(q.pending).toHaveLength(2);
    expect(aiQueueEnqueue(q, [op('c')])).toBe(false);
  });

  it('rollback drops pending and reports undo once', () => {
    const q = createAiOperationQueue();
    aiQueueBegin(q, { transactionId: 'tx_r' });
    aiQueueEnqueue(q, [op('a')]);
    aiQueueMarkApplied(q, { historyPushed: true, opResults: [result('a')] });
    expect(aiQueueRollback(q, 'tx_r')).toBe(true);
    expect(q.status).toBe('rolled_back');
    expect(q.pending).toHaveLength(0);
    expect(aiQueueRollback(q, 'tx_r')).toBe(false);
    expect(aiQueueEnqueue(q, [op('b')])).toBe(false);
    expect(aiQueueAckStatus(q)).toBe('rollback');
  });

  it('rollback ignores a different transaction_id', () => {
    const q = createAiOperationQueue();
    aiQueueBegin(q, { transactionId: 'tx_keep' });
    aiQueueMarkApplied(q, { historyPushed: true, opResults: [] });
    expect(aiQueueRollback(q, 'tx_other')).toBe(false);
    expect(q.status).toBe('open');
    expect(q.historyPushed).toBe(true);
  });

  it('cancel drops pending and reports undo; second cancel is a no-op', () => {
    const q = createAiOperationQueue();
    aiQueueBegin(q, { transactionId: 'tx_c' });
    aiQueueEnqueue(q, [op('a')]);
    aiQueueMarkApplied(q, { historyPushed: true, opResults: [] });
    expect(aiQueueCancel(q)).toBe(true);
    expect(q.status).toBe('cancelled');
    expect(q.pending).toHaveLength(0);
    expect(aiQueueCancel(q)).toBe(false);
    expect(aiQueueAckStatus(q)).toBe('rollback');
  });

    it('implicit-open tool_ops without begin still enqueue', () => {
    const q = createAiOperationQueue();
    expect(aiQueueEnqueue(q, [op('implicit')])).toBe(true);
    expect(q.status).toBe('open');
    aiQueueBindTransaction(q, 'tx_late');
    expect(q.transactionId).toBe('tx_late');
    expect(aiQueueTakeChunk(q)?.[0]?.op_id).toBe('implicit');
  });

  it('commit racing ahead of drain does not drop pending chunks', () => {
    const q = createAiOperationQueue();
    aiQueueBegin(q, { transactionId: 'tx_race' });
    aiQueueEnqueue(q, [op('a')]);
    aiQueueEnqueue(q, [op('b')]);
    aiQueueCommit(q, 'tx_race');
    expect(q.pending).toHaveLength(2);
    expect(aiQueueTakeChunk(q)?.[0]?.op_id).toBe('a');
    aiQueueMarkApplied(q, { historyPushed: true, opResults: [result('a')] });
    expect(aiQueueShouldSkipHistory(q, 'tx_race')).toBe(true);
    expect(aiQueueTakeChunk(q)?.[0]?.op_id).toBe('b');
  });

  it('commit after rollback is ignored', () => {
    const q = createAiOperationQueue();
    aiQueueBegin(q, { transactionId: 'tx_x' });
    aiQueueMarkApplied(q, { historyPushed: true, opResults: [] });
    expect(aiQueueRollback(q, 'tx_x')).toBe(true);
    aiQueueCommit(q, 'tx_x');
    expect(q.status).toBe('rolled_back');
  });
});

describe('PR9 AI Overlay', () => {
  it('maps the last tool op onto ephemeral overlay fields', () => {
    const overlay = overlayFromToolOps({
      ops: [
        { name: 'create_shape', args: { nodeId: 'bg' } },
        { name: 'update_node', args: { nodeId: 'hero', w: 400 } },
      ],
      frameId: 'frame_1',
      transactionId: 'tx_01',
    });
    expect(overlay).toEqual({
      active: true,
      transactionId: 'tx_01',
      frameId: 'frame_1',
      nodeId: 'hero',
      action: 'update_node',
      label: 'Updating element…',
    });
  });

  it('prefers applied node ids over args (create may mint a new id)', () => {
    const overlay = overlayFromToolOps({
      ops: [{ name: 'create_text', args: { text: 'Hi' } }],
      frameId: 'board',
      appliedNodeIds: ['n_live'],
    });
    expect(overlay.nodeId).toBe('n_live');
    expect(overlay.action).toBe('create_text');
    expect(overlay.label).toBe('Adding text…');
  });

  it('reads nodeIds arrays and does not invent a document patch', () => {
    const overlay = overlayFromToolOps({
      ops: [{ name: 'delete_nodes', args: { nodeIds: ['a', 'b'] } }],
    });
    expect(overlay.nodeId).toBe('b');
    expect(overlay.frameId).toBeNull();
    expect(overlayLabelForAction('delete_nodes')).toBe('Removing elements…');
    expect(overlay).not.toHaveProperty('processStatus');
  });
});
