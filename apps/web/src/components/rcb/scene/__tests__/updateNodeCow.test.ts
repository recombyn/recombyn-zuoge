import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  addNodeToDocument,
  updateNodeInDocument
} from '@/components/rcb/scene/document/sceneDocument';
import {
  createShapeNode
} from '@/components/rcb/scene/document/nodeFactories';

describe('updateNodeInDocument COW', () => {
  it('shares untouched nodes and path strings across patches', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    const a = createShapeNode({
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      shapeType: 'path',
      path: 'M 0 0 L 40 0 L 40 40 Z',
      fill: '#fff',
    });
    const b = createShapeNode({
      x: 50,
      y: 0,
      width: 40,
      height: 40,
      shapeType: 'rect',
      fill: '#eee',
    });
    doc = addNodeToDocument(doc, a.id, a.node);
    doc = addNodeToDocument(doc, b.id, b.node);

    const pathBefore = doc.deltaSetLike[a.id].attrs.path;
    const nodeBBefore = doc.deltaSetLike[b.id];

    const next = updateNodeInDocument(doc, a.id, {
      attrs: { 'fill-color': '#ff0000' },
    });

    expect(next).not.toBe(doc);
    expect(next.deltaSetLike).not.toBe(doc.deltaSetLike);
    expect(next.deltaSetLike[a.id]).not.toBe(doc.deltaSetLike[a.id]);
    // Untouched node object shared (structural sharing).
    expect(next.deltaSetLike[b.id]).toBe(nodeBBefore);
    // Path string not recopied when attrs merge keeps the same reference.
    expect(next.deltaSetLike[a.id].attrs.path).toBe(pathBefore);
    expect(next.deltaSetLike[a.id].attrs['fill-color']).toBe('#ff0000');
  });
});
