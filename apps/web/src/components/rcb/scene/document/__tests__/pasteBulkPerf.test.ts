/**
 * Bulk paste must stay O(N+M), not O(N×M) per-node addNodeToDocument.
 */
import { describe, expect, it } from 'vitest';
import {
  addNodesToDocument,
  createEmptyDocument,
  listSceneNodes,
  removeNodesFromDocument,
} from '../sceneDocument';
import {
  pasteClipboardIntoDocument,
  type SceneClipboardPayload,
} from '../sceneClipboard';

function makeClip(count: number): SceneClipboardPayload {
  const nodes: SceneClipboardPayload['nodes'] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `src-${i}`;
    nodes.push({
      id,
      node: {
        id,
        key: 'rect',
        type: 'shape',
        x: (i % 20) * 40,
        y: Math.floor(i / 20) * 40,
        width: 32,
        height: 24,
        attrs: {
          fill: '#3b82f6',
          stroke: '#1e3a8a',
          strokeWidth: 1,
        },
      },
    });
  }
  return { nodes };
}

describe('pasteClipboardIntoDocument bulk', () => {
  it('pastes 200 nodes in one membership write', () => {
    const doc = createEmptyDocument();
    const clip = makeClip(200);
    const t0 = performance.now();
    const { document: next, ids } = pasteClipboardIntoDocument(doc, clip, {
      offsetX: 10,
      offsetY: 10,
      trusted: true,
    });
    const ms = performance.now() - t0;
    expect(ids).toHaveLength(200);
    expect(listSceneNodes(next)).toHaveLength(200);
    // Local CI machines vary; 200× addNode used to take seconds. Budget is loose
    // but catches the old O(N×M) regression.
    expect(ms).toBeLessThan(1500);
  });

  it('assigns unique ids and remaps groupId', () => {
    const doc = createEmptyDocument();
    const clip: SceneClipboardPayload = {
      nodes: [
        {
          id: 'a',
          node: {
            id: 'a',
            key: 'rect',
            type: 'shape',
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            attrs: { groupId: 'g1' },
          },
        },
        {
          id: 'b',
          node: {
            id: 'b',
            key: 'rect',
            type: 'shape',
            x: 20,
            y: 0,
            width: 10,
            height: 10,
            attrs: { groupId: 'g1' },
          },
        },
      ],
    };
    const { document: next, ids } = pasteClipboardIntoDocument(doc, clip, { trusted: true });
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe('a');
    const n0 = next.deltaSetLike?.[ids[0]!];
    const n1 = next.deltaSetLike?.[ids[1]!];
    expect(n0?.attrs?.groupId).toBeTruthy();
    expect(n0?.attrs?.groupId).toBe(n1?.attrs?.groupId);
    expect(n0?.attrs?.groupId).not.toBe('g1');
  });

  it('trusted paste into frameLocal live doc skips full normalize and stays O(paste)', () => {
    const base = createEmptyDocument();
    base.coordSpace = 'frameLocal';
    const seed: Array<{ id: string; node: Record<string, unknown> }> = [];
    for (let i = 0; i < 2000; i += 1) {
      const id = `s${i}`;
      seed.push({
        id,
        node: {
          id,
          key: 'shape',
          x: (i % 40) * 24,
          y: Math.floor(i / 40) * 24,
          width: 16,
          height: 16,
          attrs: { shapeType: 'rect', 'fill-color': '#fff' },
        },
      });
    }
    const live = addNodesToDocument(base, seed);
    live.coordSpace = 'frameLocal';
    const clip = makeClip(64);
    const t0 = performance.now();
    const { document: next, ids } = pasteClipboardIntoDocument(live, clip, {
      offsetX: 8,
      offsetY: 8,
      trusted: true,
    });
    const ms = performance.now() - t0;
    expect(ids).toHaveLength(64);
    expect(listSceneNodes(next).length).toBeGreaterThanOrEqual(2064);
    expect(ms).toBeLessThan(400);
  });
});

describe('removeNodesFromDocument bulk', () => {
  it('removes 200 of 2000 in one O(N+M) pass', () => {
    const base = createEmptyDocument();
    const seed: Array<{ id: string; node: Record<string, unknown> }> = [];
    for (let i = 0; i < 2000; i += 1) {
      const id = `r${i}`;
      seed.push({
        id,
        node: {
          id,
          key: 'shape',
          x: (i % 40) * 24,
          y: Math.floor(i / 40) * 24,
          width: 16,
          height: 16,
          attrs: { shapeType: 'rect', 'fill-color': '#fff' },
        },
      });
    }
    const live = addNodesToDocument(base, seed);
    const cut = seed.slice(0, 200).map((s) => s.id);
    const t0 = performance.now();
    const next = removeNodesFromDocument(live, cut);
    const ms = performance.now() - t0;
    expect(listSceneNodes(next)).toHaveLength(1800);
    for (const id of cut) {
      expect(next.deltaSetLike?.[id]).toBeUndefined();
    }
    // Per-id page.children.filter used to be O(deleted×children) and took seconds.
    expect(ms).toBeLessThan(200);
  });
});
