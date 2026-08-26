import { describe, expect, it } from 'vitest';
import {
  isNodeHidden,
  isNodeHiddenInDocument,
  isNodeMarqueeSkippable,
  isNodeOverlayHidden,
  shouldSkipNodeInSvgPaint,
} from '../nodeCapabilities';
import type { SceneDocument } from '@/components/rcb/sceneNode';

describe('nodeCapabilities visibility', () => {
  it('isNodeHiddenInDocument is true when owning artboard is hidden', () => {
    const doc = {
      frames: [{ id: 'f1', x: 0, y: 0, width: 100, height: 100, hidden: true }],
      deltaSetLike: {
        ROOT: { children: ['n1'] },
        n1: {
          id: 'n1',
          key: 'text',
          x: 10,
          y: 10,
          width: 40,
          height: 40,
          attrs: { frameId: 'f1' },
        },
      },
    } as unknown as SceneDocument;
    const node = doc.deltaSetLike!.n1;
    expect(isNodeHidden(node)).toBe(false);
    expect(isNodeHiddenInDocument(doc, node)).toBe(true);
    expect(isNodeMarqueeSkippable(doc, node)).toBe(true);
    expect(isNodeOverlayHidden(doc, node)).toBe(true);
    expect(shouldSkipNodeInSvgPaint(doc, node, false)).toBe(true);
  });

  it('isNodeHiddenInDocument stays false for pasteboard nodes when frame hidden elsewhere', () => {
    const doc = {
      frames: [{ id: 'f1', x: 0, y: 0, width: 100, height: 100, hidden: true }],
      deltaSetLike: {
        ROOT: { children: ['n1'] },
        n1: { id: 'n1', key: 'text', x: 0, y: 0, width: 20, height: 20, attrs: {} },
      },
    } as unknown as SceneDocument;
    expect(isNodeHiddenInDocument(doc, doc.deltaSetLike!.n1)).toBe(false);
  });

  it('isNodeOverlayHidden respects session hide without document hide', () => {
    const doc = {
      frames: [],
      deltaSetLike: {
        ROOT: { children: ['n1'] },
        n1: { id: 'n1', key: 'text', x: 0, y: 0, width: 20, height: 20, attrs: {} },
      },
    } as unknown as SceneDocument;
    const node = doc.deltaSetLike!.n1;
    expect(isNodeOverlayHidden(doc, node, true)).toBe(true);
    expect(isNodeOverlayHidden(doc, node, false)).toBe(false);
  });
});
