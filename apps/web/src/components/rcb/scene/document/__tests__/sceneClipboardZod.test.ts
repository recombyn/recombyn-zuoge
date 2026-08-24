import { describe, expect, it } from 'vitest';
import {
  clipboardNodesBounds,
  nodeIdsBoundToFrames,
  pasteClipboardIntoDocument,
  selectionAfterClipboardPaste,
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

  it('selectionAfterClipboardPaste keeps artboards as units', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    doc = {
      ...doc,
      frames: [
        {
          id: 'f-new',
          name: 'Frame',
          x: 0,
          y: 0,
          width: 367,
          height: 550,
          backgroundColor: '#fff',
        },
      ],
    };
    doc = addNodeToDocument(doc, 'child', {
      id: 'child',
      key: 'shape',
      x: 300,
      y: 500,
      width: 200,
      height: 100,
      attrs: { frameId: 'f-new' },
    } as any);
    doc = addNodeToDocument(doc, 'free', {
      id: 'free',
      key: 'shape',
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      attrs: {},
    } as any);

    expect(selectionAfterClipboardPaste(doc, ['child', 'free'], ['f-new'])).toEqual({
      nodeIds: ['free'],
      frameIds: ['f-new'],
    });
    expect(selectionAfterClipboardPaste(doc, ['free'], [])).toEqual({
      nodeIds: ['free'],
      frameIds: [],
    });
  });

  it('duplicate maps bound children to the new artboard frameId', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    doc = {
      ...doc,
      frames: [
        {
          id: 'frame-src',
          name: 'Frame',
          x: 0,
          y: 0,
          width: 300,
          height: 300,
          backgroundColor: '#fff',
        },
      ],
    };
    doc = addNodeToDocument(doc, 'child', {
      id: 'child',
      key: 'shape',
      x: 40,
      y: 40,
      width: 80,
      height: 80,
      attrs: { frameId: 'frame-src' },
    } as any);
    doc = addNodeToDocument(doc, 'overlap-free', {
      id: 'overlap-free',
      key: 'shape',
      x: 280,
      y: 120,
      width: 40,
      height: 40,
      attrs: {},
    } as any);

    const out = pasteClipboardIntoDocument(doc, {
      frames: [
        {
          id: 'frame-src',
          frame: { id: 'frame-src', x: 0, y: 0, width: 300, height: 300 },
        },
      ],
      nodes: [
        {
          id: 'child',
          node: doc.deltaSetLike!.child as any,
        },
      ],
    }, { offsetX: 310, offsetY: 0 });

    expect(out.frameIds).toHaveLength(1);
    expect(out.ids).toHaveLength(1);
    const newFrameId = out.frameIds[0];
    const newChildId = out.ids[0];
    expect(doc.deltaSetLike!.child?.attrs?.frameId).toBe('frame-src');
    expect(out.document.deltaSetLike![newChildId]?.attrs?.frameId).toBe(newFrameId);
    expect(out.document.deltaSetLike!['overlap-free']?.attrs?.frameId).toBeFalsy();
  });

  it('clipboardNodesBounds ignores overflowing children of clipped frames', () => {
    const bounds = clipboardNodesBounds({
      frames: [
        {
          id: 'f1',
          frame: { id: 'f1', x: 0, y: 0, width: 367, height: 550 },
        },
      ],
      nodes: [
        {
          id: 'overflow',
          node: {
            key: 'shape',
            x: 300,
            y: 500,
            width: 260,
            height: 100,
            attrs: { frameId: 'f1' },
          },
        },
      ],
    });
    expect(bounds).toEqual({ left: 0, top: 0, width: 367, height: 550 });
  });
});
