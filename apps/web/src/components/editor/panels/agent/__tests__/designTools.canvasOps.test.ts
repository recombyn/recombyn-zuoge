import { describe, expect, it } from 'vitest';
import { createShapeNode } from '@/components/rcb/scene/document/nodeFactories';
import { addNodeToDocument } from '@/components/rcb/scene/document/sceneDocument';
import { executeDesignTool } from '../designTools';
import { createDesignToolHarness } from './designToolHarness';

function createHarness() {
  return createDesignToolHarness();
}

describe('design tools canvas ops', () => {
  it('create_path builds a path shape from points', () => {
    const h = createHarness();
    const res = executeDesignTool(
      'create_path',
      JSON.stringify({
        x: 10,
        y: 10,
        width: 120,
        height: 80,
        points: [
          [10, 10],
          [80, 20],
          [120, 90],
        ],
        closed: true,
        stroke: '#333',
      }),
      h.ctx
    );
    expect(res.status).toBe('success');
    const nodeId = String(res.artifacts?.nodeId || '');
    expect(nodeId).toBeTruthy();
    const node = h.getDoc().deltaSetLike?.[nodeId];
    expect(String(node?.attrs?.shapeType || '')).toBe('path');
    expect(String(node?.attrs?.path || '')).toContain('M 10 10');
    expect(String(node?.attrs?.path || '')).toContain('Z');
  });

  it('edit_path_points rewrites existing shape path', () => {
    const h = createHarness();
    const created = createShapeNode({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      shapeType: 'path',
      path: 'M 0 0 L 10 10',
      closed: false,
    });
    h.setDoc(addNodeToDocument(h.getDoc(), created.id, created.node));
    const res = executeDesignTool(
      'edit_path_points',
      JSON.stringify({
        nodeId: created.id,
        points: [
          { x: 0, y: 0 },
          { x: 40, y: 20 },
          { x: 80, y: 40 },
        ],
        closed: false,
      }),
      h.ctx
    );
    expect(res.status).toBe('success');
    const node = h.getDoc().deltaSetLike?.[created.id];
    expect(String(node?.attrs?.path || '')).toContain('M 0 0');
    expect(String(node?.attrs?.path || '')).toContain('L 80 40');
  });

  it('duplicate_frame creates a copied frame', () => {
    const h = createHarness();
    const create = executeDesignTool(
      'create_frame',
      JSON.stringify({ name: 'Board A', x: 0, y: 0, width: 300, height: 200 }),
      h.ctx
    );
    const sourceId = String(create.artifacts?.frameId || '');
    const dup = executeDesignTool(
      'duplicate_frame',
      JSON.stringify({ frameId: sourceId, dx: 60, dy: 30 }),
      h.ctx
    );
    expect(dup.status).toBe('success');
    expect(h.getDoc().frames.length).toBe(2);
    const copiedId = String(dup.artifacts?.frameId || '');
    expect(copiedId).toBeTruthy();
    expect(copiedId).not.toBe(sourceId);
  });

  it('reorder_frames moves frame key to front', () => {
    const h = createHarness();
    const f1 = executeDesignTool('create_frame', JSON.stringify({ name: 'A' }), h.ctx);
    const f2 = executeDesignTool('create_frame', JSON.stringify({ name: 'B' }), h.ctx);
    const f1Id = String(f1.artifacts?.frameId || '');
    const f2Id = String(f2.artifacts?.frameId || '');
    const res = executeDesignTool(
      'reorder_frames',
      JSON.stringify({ frameIds: [f1Id], action: 'front' }),
      h.ctx
    );
    expect(res.status).toBe('success');
    const stack = (h.getDoc().stackOrder || []).filter((key) => key.startsWith('frame:'));
    expect(stack[stack.length - 1]).toBe(`frame:${f1Id}`);
    expect(stack[0]).toBe(`frame:${f2Id}`);
  });

  it('append_path_points continues an existing path', () => {
    const h = createHarness();
    const created = createShapeNode({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      shapeType: 'pen',
      path: 'M 0 0 L 10 10',
      closed: false,
    });
    h.setDoc(addNodeToDocument(h.getDoc(), created.id, created.node));
    const res = executeDesignTool(
      'append_path_points',
      JSON.stringify({
        nodeId: created.id,
        points: [{ x: 40, y: 20 }],
      }),
      h.ctx
    );
    expect(res.status).toBe('success');
    expect(String(h.getDoc().deltaSetLike?.[created.id]?.attrs?.path || '')).toContain('L 40 20');
  });

  it('simplify_path reduces vertices', () => {
    const h = createHarness();
    const created = createShapeNode({
      x: 0,
      y: 0,
      width: 200,
      height: 20,
      shapeType: 'path',
      path: 'M 0 0 L 10 0.1 L 20 0 L 30 0.2 L 100 0',
      closed: false,
    });
    h.setDoc(addNodeToDocument(h.getDoc(), created.id, created.node));
    const res = executeDesignTool(
      'simplify_path',
      JSON.stringify({ nodeId: created.id, tolerance: 1 }),
      h.ctx
    );
    expect(res.status).toBe('success');
    const path = String(h.getDoc().deltaSetLike?.[created.id]?.attrs?.path || '');
    expect(path.split('L').length).toBeLessThan(5);
    expect(path).toContain('M 0 0');
    expect(path).toContain('L 100 0');
  });

  it('lock_frames locks matching artboards', () => {
    const h = createHarness();
    const create = executeDesignTool(
      'create_frame',
      JSON.stringify({ name: 'Board', x: 0, y: 0, width: 200, height: 200 }),
      h.ctx
    );
    const frameId = String(create.artifacts?.frameId || '');
    const res = executeDesignTool(
      'lock_frames',
      JSON.stringify({ frameIds: [frameId] }),
      h.ctx
    );
    expect(res.status).toBe('success');
    expect(h.getDoc().frames.find((f) => f.id === frameId)?.locked).toBe(true);
  });

  it('set_active_tool sets pencil', () => {
    const h = createHarness();
    const res = executeDesignTool(
      'set_active_tool',
      JSON.stringify({ tool: 'pencil' }),
      h.ctx
    );
    expect(res.status).toBe('success');
    expect(res.artifacts?.tool).toBe('pencil');
    expect(h.getActiveTool()).toBe('pencil');
  });

  it('smooth_path adds Chaikin midpoints', () => {
    const h = createHarness();
    const created = createShapeNode({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      shapeType: 'path',
      path: 'M 0 0 L 50 80 L 100 0',
      closed: false,
    });
    h.setDoc(addNodeToDocument(h.getDoc(), created.id, created.node));
    const before = String(h.getDoc().deltaSetLike?.[created.id]?.attrs?.path || '');
    const res = executeDesignTool(
      'smooth_path',
      JSON.stringify({ nodeId: created.id, iterations: 1 }),
      h.ctx
    );
    expect(res.status).toBe('success');
    const after = String(h.getDoc().deltaSetLike?.[created.id]?.attrs?.path || '');
    expect(after.split('L').length).toBeGreaterThan(before.split('L').length);
  });

  it('hide_frames hides matching artboards', () => {
    const h = createHarness();
    const create = executeDesignTool(
      'create_frame',
      JSON.stringify({ name: 'Board', x: 0, y: 0, width: 200, height: 200 }),
      h.ctx
    );
    const frameId = String(create.artifacts?.frameId || '');
    const res = executeDesignTool('hide_frames', JSON.stringify({ frameIds: [frameId] }), h.ctx);
    expect(res.status).toBe('success');
    expect(h.getDoc().frames.find((f) => f.id === frameId)?.hidden).toBe(true);
  });

  it('hide_nodes sets attrs.hidden', () => {
    const h = createHarness();
    const created = createShapeNode({
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      shapeType: 'rect',
    });
    h.setDoc(addNodeToDocument(h.getDoc(), created.id, created.node));
    const res = executeDesignTool(
      'hide_nodes',
      JSON.stringify({ nodeIds: [created.id] }),
      h.ctx
    );
    expect(res.status).toBe('success');
    expect(String(h.getDoc().deltaSetLike?.[created.id]?.attrs?.hidden)).toBe('true');
  });

  it('set_grid enables grid mode', () => {
    const h = createHarness();
    const res = executeDesignTool('set_grid', JSON.stringify({ enabled: true }), h.ctx);
    expect(res.status).toBe('success');
    expect(h.getGridMode()).toBe(true);
  });
});
