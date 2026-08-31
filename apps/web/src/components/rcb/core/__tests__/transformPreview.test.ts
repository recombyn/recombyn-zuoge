import { describe, expect, it } from 'vitest';
import {
  clearNodeTransformPreviews,
  effectivePaintBox,
  getNodeTransformPreview,
  hasNodeTransformPreviews,
  setNodeTransformAngles,
  setNodeTransformHidden,
  setNodeTransformPreviews,
  subscribeTransformPreview,
} from '../transformPreview';

describe('transformPreview store', () => {
  it('stores geometry and clears', () => {
    clearNodeTransformPreviews();
    setNodeTransformPreviews([
      { nodeId: 'a', left: 10, top: 20, width: 30, height: 40, angle: 15 },
    ]);
    expect(getNodeTransformPreview('a')).toEqual({
      left: 10,
      top: 20,
      width: 30,
      height: 40,
      angle: 15,
      hidden: undefined,
    });
    expect(hasNodeTransformPreviews()).toBe(true);
    clearNodeTransformPreviews(['a']);
    expect(getNodeTransformPreview('a')).toBeNull();
    expect(hasNodeTransformPreviews()).toBe(false);
  });

  it('effectivePaintBox prefers finite preview over document', () => {
    clearNodeTransformPreviews();
    const doc = { left: 0, top: 0, width: 100, height: 50 };
    expect(effectivePaintBox('x', doc, 0)).toEqual({
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      angle: 0,
      hidden: false,
    });
    setNodeTransformPreviews([{ nodeId: 'x', left: 5, top: 6, width: 7, height: 8 }]);
    expect(effectivePaintBox('x', doc, 12)).toEqual({
      left: 5,
      top: 6,
      width: 7,
      height: 8,
      angle: 12,
      hidden: false,
    });
    setNodeTransformAngles([{ nodeId: 'x', angle: 45 }]);
    expect(effectivePaintBox('x', doc, 12).angle).toBe(45);
    clearNodeTransformPreviews();
  });

  it('angle-only preview keeps document box', () => {
    clearNodeTransformPreviews();
    setNodeTransformAngles([{ nodeId: 'y', angle: 90 }]);
    const paint = effectivePaintBox('y', { left: 1, top: 2, width: 3, height: 4 }, 0);
    expect(paint).toEqual({
      left: 1,
      top: 2,
      width: 3,
      height: 4,
      angle: 90,
      hidden: false,
    });
    clearNodeTransformPreviews();
  });

  it('notifies subscribers', () => {
    clearNodeTransformPreviews();
    let n = 0;
    const unsub = subscribeTransformPreview(() => {
      n += 1;
    });
    setNodeTransformPreviews([{ nodeId: 'z', left: 0, top: 0, width: 1, height: 1 }]);
    clearNodeTransformPreviews();
    unsub();
    expect(n).toBe(2);
  });

  it('setNodeTransformHidden gates effectivePaintBox.hidden', () => {
    clearNodeTransformPreviews();
    setNodeTransformPreviews([{ nodeId: 'h', left: 1, top: 2, width: 3, height: 4 }]);
    setNodeTransformHidden([{ nodeId: 'h', hidden: true }]);
    expect(effectivePaintBox('h', { left: 0, top: 0, width: 1, height: 1 }, 0).hidden).toBe(true);
    setNodeTransformHidden([{ nodeId: 'h', hidden: false }]);
    expect(effectivePaintBox('h', { left: 0, top: 0, width: 1, height: 1 }, 0).hidden).toBe(false);
    clearNodeTransformPreviews();
  });
});
