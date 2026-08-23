import { describe, expect, it } from 'vitest';
import { CHROME_VIEWPORT_INSET_PX, clampChromeShiftX } from '../SelectionToolbarShell';

function rect(left: number, right: number, top = 0, bottom = 40): DOMRectReadOnly {
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

describe('clampChromeShiftX', () => {
  const overlay = rect(0, 1000);

  it('returns 0 when pill fits with inset', () => {
    const pill = rect(100, 500);
    expect(clampChromeShiftX(pill, overlay, CHROME_VIEWPORT_INSET_PX)).toBe(0);
  });

  it('shifts right when pill overflows left edge', () => {
    const pill = rect(4, 300);
    expect(clampChromeShiftX(pill, overlay, 16)).toBe(12);
  });

  it('shifts left when pill overflows right edge', () => {
    const pill = rect(820, 990);
    expect(clampChromeShiftX(pill, overlay, 16)).toBe(-6);
  });
});
