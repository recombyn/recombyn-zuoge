import { describe, expect, it } from 'vitest';
import { selectionToolbarDock } from '../selectionLogic';

describe('selectionToolbarDock', () => {
  const box = { left: 10, top: 20, width: 100, height: 50 };

  it('passes chromeUnion through with angle and pad', () => {
    expect(
      selectionToolbarDock(box, { angle: 45, edgePadScene: 8 })
    ).toEqual({
      box,
      angle: 45,
      edgePadScene: 8,
    });
  });

  it('returns null box when chromeUnion is missing', () => {
    expect(selectionToolbarDock(null)).toEqual({
      box: null,
      angle: 0,
      edgePadScene: 0,
    });
  });
});
