import { describe, expect, it } from 'vitest';
import {
  buildProjectDocumentPatch,
  hashDocument,
  projectPersistenceKey,
  projectSessionKey,
} from '../projectDraftStore';

describe('projectPersistenceKey', () => {
  it('namespaces by project id', () => {
    expect(projectPersistenceKey('abc')).toBe('rcb-project:abc');
    expect(projectPersistenceKey('  x  ')).toBe('rcb-project:x');
  });
});

describe('projectSessionKey', () => {
  it('namespaces session separately from document drafts', () => {
    expect(projectSessionKey('abc')).toBe('rcb-session:abc');
    expect(projectSessionKey('abc')).not.toBe(projectPersistenceKey('abc'));
  });
});

describe('hashDocument', () => {
  it('is stable for same JSON', () => {
    expect(hashDocument({ a: 1 })).toBe(hashDocument({ a: 1 }));
  });

  it('changes when content changes', () => {
    expect(hashDocument({ a: 1 })).not.toBe(hashDocument({ a: 2 }));
  });

  it('hashes scene docs without full JSON stringify cost shape', () => {
    const a = sampleDoc({
      ROOT: { id: 'ROOT', children: ['n1'] },
      n1: { id: 'n1', key: 'shape', x: 1, y: 2, width: 10, height: 10, attrs: {} },
    });
    const b = sampleDoc({
      ROOT: { id: 'ROOT', children: ['n1'] },
      n1: { id: 'n1', key: 'shape', x: 1, y: 3, width: 10, height: 10, attrs: {} },
    });
    expect(hashDocument(a)).toBe(hashDocument(a));
    expect(hashDocument(a)).not.toBe(hashDocument(b));
  });
});

function sampleDoc(nodes: Record<string, unknown>, children?: string[]) {
  const ids = children || Object.keys(nodes).filter((id) => id !== 'ROOT');
  return {
    width: 800,
    height: 600,
    backgroundColor: '#fff',
    frames: [],
    activeFrameId: null,
    pages: [{ id: 'page_1', children: ids }],
    activePageId: 'page_1',
    deltaSetLike: {
      ROOT: { id: 'ROOT', key: 'entry', children: ids },
      ...nodes,
    } as Record<string, unknown>,
  };
}

describe('buildProjectDocumentPatch', () => {
  it('returns null when identical', () => {
    const doc = sampleDoc({
      n1: { id: 'n1', key: 'rect', x: 0, y: 0, width: 10, height: 10 },
    });
    expect(buildProjectDocumentPatch(doc, doc)).toBeNull();
  });

  it('upserts changed / new nodes and removes missing ones', () => {
    const base = sampleDoc({
      n1: { id: 'n1', key: 'rect', x: 0, y: 0, width: 10, height: 10 },
      n2: { id: 'n2', key: 'rect', x: 1, y: 1, width: 10, height: 10 },
    });
    const next = sampleDoc({
      n1: { id: 'n1', key: 'rect', x: 5, y: 0, width: 10, height: 10 },
      n3: { id: 'n3', key: 'text', x: 0, y: 0, width: 20, height: 20 },
    });
    const out = buildProjectDocumentPatch(base, next);
    expect(out?.preferFull).toBe(false);
    expect(out?.patch.upsertNodes).toEqual({
      n1: next.deltaSetLike.n1,
      n3: next.deltaSetLike.n3,
    });
    expect(out?.patch.removeNodeIds).toEqual(['n2']);
    expect(out?.patch.pageChildren).toEqual(['n1', 'n3']);
  });

  it('captures canvas meta changes', () => {
    const base = sampleDoc({});
    const next = { ...sampleDoc({}), backgroundColor: '#000', width: 1200 };
    const out = buildProjectDocumentPatch(base, next);
    expect(out?.patch.canvas).toMatchObject({
      backgroundColor: '#000',
      width: 1200,
    });
  });

  it('prefers full replace when too many nodes change', () => {
    const baseNodes: Record<string, unknown> = {};
    const nextNodes: Record<string, unknown> = {};
    for (let i = 0; i < 40; i += 1) {
      baseNodes[`n${i}`] = { id: `n${i}`, key: 'rect', x: i, y: 0, width: 1, height: 1 };
      nextNodes[`n${i}`] = { id: `n${i}`, key: 'rect', x: i + 1, y: 0, width: 1, height: 1 };
    }
    const out = buildProjectDocumentPatch(sampleDoc(baseNodes), sampleDoc(nextNodes));
    expect(out?.preferFull).toBe(true);
  });

  it('keeps incremental PATCH for a small-canvas boolean (2 shapes → 1 path)', () => {
    const base = sampleDoc({
      a: { id: 'a', key: 'shape', x: 0, y: 0, width: 80, height: 80 },
      b: { id: 'b', key: 'shape', x: 40, y: 40, width: 80, height: 80 },
    });
    const next = sampleDoc({
      c: {
        id: 'c',
        key: 'shape',
        x: 0,
        y: 0,
        width: 120,
        height: 120,
        attrs: { shapeType: 'path', path: 'M0 0L120 0L120 120L0 120Z' },
      },
    });
    const out = buildProjectDocumentPatch(base, next);
    expect(out?.preferFull).toBe(false);
    expect(out?.patch.removeNodeIds).toEqual(['a', 'b']);
    expect(out?.patch.upsertNodes).toHaveProperty('c');
    expect(out?.patch.pageChildren).toEqual(['c']);
  });
});
