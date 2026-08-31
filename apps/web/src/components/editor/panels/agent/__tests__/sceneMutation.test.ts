/**
 * PR7 — Scene Mutation Pipeline: validate → permission → revision → apply.
 * AI writes must not skip this gate (no Redux-shaped patches).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  applySceneMutation,
  gateSceneMutation,
  rebaseSceneMutationOps,
  sceneMutationPermission,
  sceneMutationRevision,
  sceneMutationValidate,
} from '../designTools';
import { setAllowedCanvasToolKeys } from '../toolOpsContract';

describe('Scene Mutation Pipeline', () => {
  it('validate rejects empty ops', () => {
    const gate = sceneMutationValidate([]);
    expect(gate.ok).toBe(false);
    expect(gate.stage).toBe('validate');
    expect(gate.reason).toBe('empty_ops');
  });

  it('validate allowlists and dedupes by op_id', () => {
    setAllowedCanvasToolKeys(['create_text', 'update_node']);
    const gate = sceneMutationValidate(
      [
        { name: 'create_text', op_id: 'a', args: { text: 'Hi' } },
        { name: 'create_text', op_id: 'a', args: { text: 'dup' } },
        { name: 'not_a_tool', op_id: 'b', args: {} },
      ],
      new Set()
    );
    expect(gate.ok).toBe(true);
    expect(gate.ops.map((o) => o.op_id)).toEqual(['a']);
    setAllowedCanvasToolKeys([]);
  });

  it('permission blocks destructive ops without allowDestructive', () => {
    const denied = sceneMutationPermission({
      source: 'ai',
      allowDestructive: false,
      ops: [{ name: 'delete_nodes', args: { nodeIds: ['n1'] } }],
    });
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('destructive_not_allowed');
    const allowed = sceneMutationPermission({
      source: 'ai',
      allowDestructive: true,
      ops: [{ name: 'delete_nodes', args: { nodeIds: ['n1'] } }],
    });
    expect(allowed.ok).toBe(true);
  });

  it('revision mismatch without a document rejects (cannot rebase blindly)', () => {
    const conflict = sceneMutationRevision({
      source: 'ai',
      baseRevision: 42,
      currentRevision: 43,
    });
    expect(conflict.ok).toBe(false);
    expect(conflict.reason).toBe('revision_conflict');
    const ok = sceneMutationRevision({
      source: 'ai',
      baseRevision: 42,
      currentRevision: 42,
    });
    expect(ok.ok).toBe(true);
    const prior = sceneMutationRevision({
      source: 'ai',
      baseRevision: 0,
      currentRevision: 5,
    });
    expect(prior.ok).toBe(true);
  });

  it('gateSceneMutation runs validate → permission → revision in order', () => {
    setAllowedCanvasToolKeys(['update_node']);
    const conflict = gateSceneMutation({
      source: 'ai',
      allowDestructive: true,
      ops: [{ name: 'update_node', op_id: 'u1', args: { nodeId: 't', text: 'x' } }],
      baseRevision: 2,
      currentRevision: 9,
    });
    expect(conflict.ok).toBe(false);
    expect(conflict.stage).toBe('revision');
    setAllowedCanvasToolKeys([]);
  });

  it('applySceneMutation does not execute on revision conflict', async () => {
    setAllowedCanvasToolKeys(['create_text']);
    const execute = vi.fn(async () => ({ opResults: [] }));
    const out = await applySceneMutation({
      source: 'ai',
      transactionId: 'tx_1',
      ops: [{ name: 'create_text', op_id: 't1', args: { text: 'Hi' } }],
      allowDestructive: true,
      baseRevision: 5,
      currentRevision: 8, execute,
    });
    expect(out.ok).toBe(false);
    expect(out.stage).toBe('revision');
    expect(out.reason).toBe('revision_conflict');
    expect(execute).not.toHaveBeenCalled();
    expect(out.opResults[0]?.error).toBe('revision_conflict');
    setAllowedCanvasToolKeys([]);
  });

  it('applySceneMutation execute runs only after gates pass', async () => {
    setAllowedCanvasToolKeys(['create_text']);
    const execute = vi.fn(async (ops) => ({
      opResults: ops.map((o) => ({
        op_id: String(o.op_id || ''),
        name: o.name,
        ok: true,
      })),
    }));
    const out = await applySceneMutation({
      source: 'ai',
      ops: [{ name: 'create_text', op_id: 't1', args: { text: 'Hi' } }],
      allowDestructive: true,
      baseRevision: 3,
      currentRevision: 3,
      skipHistory: true, execute,
    });
    expect(out.ok).toBe(true);
    expect(out.stage).toBe('sync');
    expect(execute).toHaveBeenCalledOnce();
    expect(out.historyPushed).toBe(false);
    setAllowedCanvasToolKeys([]);
  });
});

function sceneDoc(nodeIds: string[], frameIds = ['f1']) {
  return {
    deltaSetLike: Object.fromEntries(nodeIds.map((id) => [id, { id }])),
    frames: frameIds.map((id) => ({ id })),
    activeFrameId: frameIds[0] || null,
  };
}

describe('PR8 revision rebase / reject', () => {
  it('rebases creates and updates onto living ids; drops missing targets', () => {
    const out = rebaseSceneMutationOps(
      [
        { name: 'create_text', op_id: 'c1', args: { text: 'Hi', frameId: 'f1' } },
        { name: 'update_node', op_id: 'u1', args: { nodeId: 'title', text: '新' } },
        { name: 'update_node', op_id: 'u2', args: { nodeId: 'gone', text: 'x' } },
      ],
      sceneDoc(['title'])
    );
    expect(out.action).toBe('rebase');
    expect(out.ops.map((o) => o.op_id)).toEqual(['c1', 'u1']);
    expect(out.dropped.some((d) => d.op_id === 'u2' && d.reason === 'target_missing')).toBe(
      true
    );
  });

  it('rejects when a live delete would overwrite user edits', () => {
    const out = rebaseSceneMutationOps(
      [{ name: 'delete_nodes', op_id: 'd1', args: { nodeIds: ['title'] } }],
      sceneDoc(['title'])
    );
    expect(out.action).toBe('reject');
    expect(out.reason).toBe('revision_conflict');
    expect(out.dropped.some((d) => d.reason === 'unsafe_delete')).toBe(true);
  });

  it('rejects delete_frame of a still-living artboard', () => {
    const out = rebaseSceneMutationOps(
      [{ name: 'delete_frame', op_id: 'df', args: { frameId: 'f1' } }],
      sceneDoc([], ['f1'])
    );
    expect(out.action).toBe('reject');
    expect(out.dropped.some((d) => d.reason === 'unsafe_delete')).toBe(true);
  });

  it('retargets create onto activeFrameId when the planned frame is gone', () => {
    const out = rebaseSceneMutationOps(
      [{ name: 'create_text', op_id: 'c1', args: { text: 'Hi', frameId: 'old' } }],
      sceneDoc(['n1'], ['f2'])
    );
    expect(out.action).toBe('rebase');
    expect(out.ops[0]?.args?.frameId).toBe('f2');
  });

  it('gate rebases instead of silent apply when revisions differ', () => {
    setAllowedCanvasToolKeys(['create_text', 'update_node']);
    const gate = gateSceneMutation({
      source: 'ai',
      allowDestructive: true,
      ops: [
        { name: 'create_text', op_id: 'c1', args: { text: 'Hi', frameId: 'f1' } },
        { name: 'update_node', op_id: 'u1', args: { nodeId: 'title', text: '新' } },
      ],
      baseRevision: 2,
      currentRevision: 9,
      document: sceneDoc(['title']),
    });
    expect(gate.ok).toBe(true);
    expect(gate.revisionAction).toBe('rebase');
    expect(gate.ops.map((o) => o.op_id)).toEqual(['c1', 'u1']);
    setAllowedCanvasToolKeys([]);
  });

  it('applySceneMutation executes rebased ops, not the original set', async () => {
    setAllowedCanvasToolKeys(['create_text', 'update_node']);
    const execute = vi.fn(async (ops) => ({
      opResults: ops.map((o) => ({
        op_id: String(o.op_id || ''),
        name: o.name,
        ok: true,
      })),
    }));
    const out = await applySceneMutation({
      source: 'ai',
      ops: [
        { name: 'create_text', op_id: 'c1', args: { text: 'Hi', frameId: 'f1' } },
        { name: 'update_node', op_id: 'gone', args: { nodeId: 'missing' } },
      ],
      allowDestructive: true,
      baseRevision: 5,
      currentRevision: 8,
      document: sceneDoc(['title']),
      skipHistory: true, execute,
    });
    expect(out.ok).toBe(true);
    expect(out.revisionAction).toBe('rebase');
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][0].map((o: { op_id?: string }) => o.op_id)).toEqual(['c1']);
    expect(out.opResults.some((r) => r.op_id === 'gone' && r.ok === false)).toBe(true);
    setAllowedCanvasToolKeys([]);
  });

  it('applySceneMutation still refuses unsafe deletes (no silent overwrite)', async () => {
    setAllowedCanvasToolKeys(['delete_frame']);
    const execute = vi.fn(async () => ({ opResults: [] }));
    const out = await applySceneMutation({
      source: 'ai',
      ops: [{ name: 'delete_frame', op_id: 'df', args: { id: 'f1' } }],
      allowDestructive: true,
      baseRevision: 1,
      currentRevision: 2,
      document: sceneDoc([], ['f1']),
      skipHistory: true,
      execute,
    });
    expect(out.ok).toBe(false);
    expect(out.revisionAction).toBe('reject');
    expect(execute).not.toHaveBeenCalled();
    setAllowedCanvasToolKeys([]);
  });
});
