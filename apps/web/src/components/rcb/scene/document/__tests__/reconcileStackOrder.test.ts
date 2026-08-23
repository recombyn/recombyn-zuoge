import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  reconcileStackOrder,
  stackFrameKey,
  stackNodeKey,
} from '../sceneDocument';

describe('reconcileStackOrder', () => {
  it('inserts missing frames under content without O(n²) splice churn', () => {
    const doc = createEmptyDocument({ emptyWorld: true });
    doc.frames = [
      {
        id: 'f1',
        name: 'A',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        backgroundColor: '#fff',
      },
      {
        id: 'f2',
        name: 'B',
        x: 120,
        y: 0,
        width: 100,
        height: 100,
        backgroundColor: '#fff',
      },
    ];
    doc.deltaSetLike.n1 = {
      id: 'n1',
      key: 'shape',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      attrs: {},
      children: [],
    };
    doc.pages![0].children = ['n1'];
    doc.deltaSetLike.ROOT.children = ['n1'];
    doc.stackOrder = [stackNodeKey('n1')];

    const order = reconcileStackOrder(doc);
    expect(order).toEqual([
      stackFrameKey('f1'),
      stackFrameKey('f2'),
      stackNodeKey('n1'),
    ]);
  });
});
