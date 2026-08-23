import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createEmptyDocument
} from '@/components/rcb/scene/document/sceneDocument';
import { diffScenesForCollab, tryClaimRoomSeed, yBootMap } from '../sceneYBridge';

describe('diffScenesForCollab', () => {
  it('returns empty patch when scenes match', () => {
    const doc = createEmptyDocument({ width: 800, height: 600 });
    const diff = diffScenesForCollab(doc, structuredClone(doc));
    expect(diff.mode).toBe('patch');
    expect(Object.keys(diff.upsertNodes)).toHaveLength(0);
    expect(diff.removeNodeIds).toHaveLength(0);
    expect(diff.pageChildren).toBeNull();
  });

  it('patches a single changed node without full reload', () => {
    const prev = createEmptyDocument({ width: 800, height: 600 });
    prev.deltaSetLike = {
      ROOT: {
        id: 'ROOT',
        key: 'entry',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        attrs: {},
        children: ['n1'],
      },
      n1: {
        id: 'n1',
        key: 'shape',
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        attrs: { shapeType: 'rect' },
        children: [],
      },
    };
    prev.pages = [{ id: 'page', children: ['n1'] }];
    const next = structuredClone(prev);
    next.deltaSetLike.n1 = {
      ...next.deltaSetLike.n1,
      width: 160,
    };
    const diff = diffScenesForCollab(prev, next);
    expect(diff.mode).toBe('patch');
    expect(diff.upsertNodes.n1.width).toBe(160);
    expect(diff.removeNodeIds).toHaveLength(0);
    expect(diff.pageChildren).toBeNull();
  });

  it('full reload when canvas background meta changes', () => {
    const prev = createEmptyDocument({ width: 800, height: 600 });
    const next = structuredClone(prev);
    next.backgroundColor = '#ff00ff';
    const diff = diffScenesForCollab(prev, next);
    expect(diff.mode).toBe('full');
    expect(diff.scene?.backgroundColor).toBe('#ff00ff');
  });

  it('tracks node add/remove and pageChildren', () => {
    const prev = createEmptyDocument({ width: 800, height: 600 });
    prev.deltaSetLike = {
      ROOT: {
        id: 'ROOT',
        key: 'entry',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        attrs: {},
        children: ['n1'],
      },
      n1: {
        id: 'n1',
        key: 'shape',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        attrs: {},
        children: [],
      },
    };
    prev.pages = [{ id: 'page', children: ['n1'] }];
    const next = structuredClone(prev);
    delete next.deltaSetLike.n1;
    next.deltaSetLike.n2 = {
      id: 'n2',
      key: 'shape',
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      attrs: {},
      children: [],
    };
    next.deltaSetLike.ROOT = {
      id: 'ROOT',
      key: 'entry',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      attrs: {},
      children: ['n2'],
    };
    next.pages = [{ id: 'page', children: ['n2'] }];
    const diff = diffScenesForCollab(prev, next);
    expect(diff.mode).toBe('patch');
    expect(diff.removeNodeIds).toContain('n1');
    expect(diff.upsertNodes.n2).toBeTruthy();
    expect(diff.pageChildren).toEqual(['n2']);
  });
});

describe('tryClaimRoomSeed', () => {
  it('first claim wins; second claim fails', () => {
    const doc = new Y.Doc();
    expect(tryClaimRoomSeed(doc, 11)).toBe(true);
    expect(Number(yBootMap(doc).get('seedOwner'))).toBe(11);
    expect(tryClaimRoomSeed(doc, 22)).toBe(false);
    expect(Number(yBootMap(doc).get('seedOwner'))).toBe(11);
  });
});
