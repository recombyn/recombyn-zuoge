import { describe, expect, it } from 'vitest';
import { shapeHostPropsEqual } from '../RcbShapeHost';

function props(document: any) {
  return {
    nodeId: 'brush-a',
    document,
    zIndex: 1,
    reloadToken: 0,
    forceHidden: false,
  };
}

describe('shapeHostPropsEqual', () => {
  it('ignores a replacement document shell when this host node is unchanged', () => {
    const brush = { id: 'brush-a', attrs: { shapeType: 'pencil', path: 'M0 0' } };
    const other = { id: 'brush-b', x: 0 };
    const before = { deltaSetLike: { 'brush-a': brush, 'brush-b': other } };
    const after = { deltaSetLike: { 'brush-a': brush, 'brush-b': { ...other, x: 20 } } };

    expect(shapeHostPropsEqual(props(before), props(after))).toBe(true);
  });

  it('ignores top-level geometry commits on the same paint attrs', () => {
    const before = { deltaSetLike: { 'brush-a': { id: 'brush-a', x: 0 } } };
    const after = { deltaSetLike: { 'brush-a': { id: 'brush-a', x: 20 } } };

    expect(shapeHostPropsEqual(props(before), props(after))).toBe(true);
  });

  it('updates the host when paint attrs on its own node change', () => {
    const before = {
      deltaSetLike: { 'brush-a': { id: 'brush-a', attrs: { path: 'M0 0' } } },
    };
    const after = {
      deltaSetLike: { 'brush-a': { id: 'brush-a', attrs: { path: 'M20 0' } } },
    };

    expect(shapeHostPropsEqual(props(before), props(after))).toBe(false);
  });

  it('updates the host when process chrome attrs clear on the same node record', () => {
    const image = {
      id: 'brush-a',
      key: 'image',
      attrs: { processStatus: 'running', processLabel: 'Uploading' },
    };
    const before = { deltaSetLike: { 'brush-a': image } };
    const after = {
      deltaSetLike: {
        'brush-a': {
          ...image,
          attrs: { src: 'https://cdn.example.com/a.png' },
        },
      },
    };

    expect(shapeHostPropsEqual(props(before), props(after))).toBe(false);
  });

  it('ignores geometry-only preview updates while process shimmer is running', () => {
    const attrs = { processStatus: 'running', processLabel: 'Uploading' };
    const before = {
      deltaSetLike: {
        'brush-a': { id: 'brush-a', key: 'image', x: 0, y: 0, width: 100, height: 100, attrs },
      },
    };
    const after = {
      deltaSetLike: {
        'brush-a': { id: 'brush-a', key: 'image', x: 0, y: 0, width: 180, height: 180, attrs },
      },
    };

    expect(shapeHostPropsEqual(props(before), props(after))).toBe(true);
  });
});
