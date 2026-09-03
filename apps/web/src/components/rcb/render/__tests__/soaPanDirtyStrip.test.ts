import { describe, expect, it, afterEach } from 'vitest';
import {
  seedSoaGestureDirtyAccum,
  peekSoaGestureDirtyAccum,
  clearSoaGestureDirtyAccum,
} from '../soaBakeLayer';

afterEach(() => {
  clearSoaGestureDirtyAccum();
});

describe('gesture dirty accum', () => {
  it('seedSoaGestureDirtyAccum replaces peek', () => {
    seedSoaGestureDirtyAccum({ left: 1, top: 2, width: 3, height: 4 });
    expect(peekSoaGestureDirtyAccum()).toEqual({
      left: 1,
      top: 2,
      width: 3,
      height: 4,
    });
    clearSoaGestureDirtyAccum();
    expect(peekSoaGestureDirtyAccum()).toBeNull();
  });
});
