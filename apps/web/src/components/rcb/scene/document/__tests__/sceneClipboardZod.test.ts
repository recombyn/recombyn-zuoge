import { describe, expect, it } from 'vitest';
import {
  nodeIdsBoundToFrames,
  pasteClipboardIntoDocument,
  validateSceneClipboard,
} from '@/components/rcb/scene/document/sceneClipboard';
import { addNodeToDocument, createEmptyDocument } from '@/components/rcb/scene/document/sceneDocument';

describe('scene clipboard Zod', () => {
  it('accepts a valid node clip', () => {
    const result = validateSceneClipboard({
      nodes: [
        {
          id: 'a',
          node: { key: 'shape', x: 0, y: 0, width: 10, height: 10, attrs: {} },
        },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects empty / malformed clip', () => {
    expect(validateSceneClipboard({ nodes: [] }).valid).toBe(false);
    expect(
      validateSceneClipboard({
        nodes: [{ id: 'a', node: { key: 'shape' } }],
      }).valid
    ).toBe(false);
  });

  it('pasteClipboardIntoDocument no-ops on invalid payload', () => {
    const doc = createEmptyDocument({ width: 400, height: 400 });
    const out = pasteClipboardIntoDocument(doc, { nodes: [] } as any);
    expect(out.ids).toEqual([]);
    expect(out.frameIds).toEqual([]);
  });

  it('pastes a validated clip with new ids', () => {
    const doc = createEmptyDocument({ width: 400, height: 400 });
    const out = pasteClipboardIntoDocument(doc, {
      nodes: [
        {
          id: 'src',
          node: {
            key: 'shape',
            x: 10,
            y: 20,
            width: 40,
            height: 30,
            attrs: { shapeType: 'rect' },
          },
        },
      ],
    });
    expect(out.ids).toHaveLength(1);
    expect(out.ids[0]).not.toBe('src');
    expect(out.document.deltaSetLike[out.ids[0]]).toBeTruthy();
  });

  it('binds nodes by attrs.frameId, not geometry overlap', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    doc = {
      ...doc,
      frames: [
        {
          id: 'frame-1',
          name: 'Frame',
          x: 100,
          y: 100,
          width: 200,
          height: 200,
          backgroundColor: '#fff',
          clipContent: true,
        },
      ],
    };
    doc = addNodeToDocument(doc, 'inside-unbound', {
      id: 'inside-unbound',
      key: 'shape',
      x: 120,
      y: 120,
      width: 30,
      height: 30,
      attrs: {},
    } as any);
    doc = addNodeToDocument(doc, 'crossing-bound', {
      id: 'crossing-bound',
      key: 'shape',
      x: 280,
      y: 150,
      width: 80,
      height: 40,
      attrs: { frameId: 'frame-1' },
    } as any);

    expect(nodeIdsBoundToFrames(doc, ['frame-1'])).toEqual(['crossing-bound']);
  });

  it('does not assign overlapping nodes to another frame without frameId', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    doc = {
      ...doc,
      frames: [
        {
          id: 'frame-a',
          name: 'A',
          x: 0,
          y: 0,
          width: 240,
          height: 240,
          backgroundColor: '#fff',
        },
        {
          id: 'frame-b',
          name: 'B',
          x: 120,
          y: 80,
          width: 160,
          height: 160,
          backgroundColor: '#fff',
        },
      ],
    };
    doc = addNodeToDocument(doc, 'overlaps-b', {
      id: 'overlaps-b',
      key: 'shape',
      x: 180,
      y: 140,
      width: 30,
      height: 30,
      attrs: {},
    } as any);

    expect(nodeIdsBoundToFrames(doc, ['frame-a'])).toEqual([]);
    expect(nodeIdsBoundToFrames(doc, ['frame-b'])).toEqual([]);

    doc = addNodeToDocument(doc, 'bound-a', {
      id: 'bound-a',
      key: 'shape',
      x: 70,
      y: 100,
      width: 180,
      height: 40,
      attrs: { frameId: 'frame-a' },
    } as any);
    expect(nodeIdsBoundToFrames(doc, ['frame-a'])).toEqual(['bound-a']);
    expect(nodeIdsBoundToFrames(doc, ['frame-b'])).toEqual([]);
  });
});
