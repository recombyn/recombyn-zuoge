import { describe, expect, it } from 'vitest';
import {
  addNodeToDocument,
  createEmptyDocument,
  flattenDeltaSetLike,
  normalizeDocument,
  patchDeltaSetLike,
  updateNodeInDocument,
  updateNodesInDocument
} from '../sceneDocument';

describe('patchDeltaSetLike Immer COW', () => {
  it('shares untouched nodes across patches', () => {
    const base: Record<string, any> = {
      ROOT: { id: 'ROOT', children: ['a', 'b'] },
      a: { id: 'a', x: 0, y: 0, width: 10, height: 10, attrs: {} },
      b: { id: 'b', x: 20, y: 0, width: 10, height: 10, attrs: {} },
    };
    const next = patchDeltaSetLike(base, {
      a: { ...base.a, x: 5 },
    });
    expect(next.a.x).toBe(5);
    expect(next.b).toBe(base.b);
    expect(next.ROOT).toBe(base.ROOT);
    expect(Object.keys(next).sort()).toEqual(['ROOT', 'a', 'b']);
  });

  it('returns a plain extensible object safe for Redux Object.keys', () => {
    const base: Record<string, any> = {
      ROOT: { id: 'ROOT', children: ['a'] },
      a: { id: 'a', x: 0, attrs: { shapeType: 'rect' } },
    };
    const next = patchDeltaSetLike(base, {
      a: { ...base.a, x: 9 },
    });
    expect(() => Object.keys(next)).not.toThrow();
    expect(Object.isExtensible(next)).toBe(true);
    expect(next.a.x).toBe(9);
    next.b = { id: 'b', x: 1, attrs: {} } as any;
    expect(next.b.id).toBe('b');
    const flat = flattenDeltaSetLike(next);
    expect(flat.a.x).toBe(9);
    expect(Object.getPrototypeOf(flat)).toBe(Object.prototype);
  });

  it('addNodeToDocument works after normalize (syncRootChildren produce)', () => {
    const doc = createEmptyDocument({ emptyWorld: true });
    const patched = updateNodeInDocument(doc, 'ROOT', {
      children: [...(doc.deltaSetLike.ROOT.children || [])],
    });
    const next = addNodeToDocument(patched, 'shape1', {
      id: 'shape1',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      attrs: { shapeType: 'rect' },
    });
    expect(next.deltaSetLike.shape1?.id).toBe('shape1');
    expect(next.pages[0].children).toContain('shape1');
  });

  it('updateNodeInDocument does not allocate full delta copies of shared nodes', () => {
    const doc = createEmptyDocument({ emptyWorld: true });
    const ids: string[] = [];
    for (let i = 0; i < 200; i += 1) {
      const id = `n${i}`;
      ids.push(id);
      (doc.deltaSetLike as any)[id] = {
        id,
        x: i,
        y: 0,
        width: 8,
        height: 8,
        attrs: { shapeType: 'rect' },
      };
    }
    doc.deltaSetLike.ROOT.children = ids;
    doc.pages[0].children = ids;
    const untouched = (doc.deltaSetLike as any).n50;
    const next = updateNodeInDocument(doc, 'n0', { x: 99 });
    expect((next.deltaSetLike as any).n0.x).toBe(99);
    expect((next.deltaSetLike as any).n50).toBe(untouched);
  });

  it('updateNodesInDocument batches into one produce', () => {
    const doc = createEmptyDocument({ emptyWorld: true });
    (doc.deltaSetLike as any).a = { id: 'a', x: 0, attrs: {} };
    (doc.deltaSetLike as any).b = { id: 'b', x: 1, attrs: {} };
    doc.deltaSetLike.ROOT.children = ['a', 'b'];
    const next = updateNodesInDocument(doc, [
      { nodeId: 'a', patch: { x: 10 } },
      { nodeId: 'b', patch: { x: 20 } },
    ]);
    expect((next.deltaSetLike as any).a.x).toBe(10);
    expect((next.deltaSetLike as any).b.x).toBe(20);
  });

  it('normalizeDocument does not JSON-clone every node', () => {
    const doc = createEmptyDocument({ emptyWorld: true });
    const node = { id: 'a', x: 1, y: 2, width: 3, height: 4, attrs: { shapeType: 'rect' } };
    (doc.deltaSetLike as any).a = node;
    doc.deltaSetLike.ROOT.children = ['a'];
    doc.pages[0].children = ['a'];
    const next = normalizeDocument(doc);
    expect((next.deltaSetLike as any).a).toBe(node);
    expect(next.width).toBeGreaterThan(0);
  });

  it('normalizes fractional video upload geometry to one pixel lattice', () => {
    const doc = createEmptyDocument({ emptyWorld: true });
    const video = {
      id: 'video-1',
      key: 'video',
      x: 10.5,
      y: 20.5,
      width: 175.5,
      height: 389.5,
      attrs: { src: 'blob:video' },
    } as any;
    (doc.deltaSetLike as any)[video.id] = video;
    doc.deltaSetLike.ROOT.children = [video.id];
    doc.pages[0].children = [video.id];

    const next = normalizeDocument(doc);
    const normalized = (next.deltaSetLike as any)[video.id];
    expect(normalized).toMatchObject({ x: 11, y: 21, width: 176, height: 390 });
    expect(normalized).not.toBe(video);
  });
});
