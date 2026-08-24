import { describe, expect, it } from 'vitest';
import {
  CHROME_VIEWPORT_INSET_PX,
  clampChromeShift,
  clampChromeShiftX,
  clampChromeShiftY,
} from '../SelectionToolbarShell';

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

describe('clampChromeShiftY', () => {
  const overlay = rect(0, 1000, 0, 800);

  it('returns 0 when pill fits with inset', () => {
    const pill = rect(100, 500, 100, 200);
    expect(clampChromeShiftY(pill, overlay, CHROME_VIEWPORT_INSET_PX)).toBe(0);
  });

  it('shifts down when pill overflows top edge', () => {
    const pill = rect(100, 500, 4, 80);
    expect(clampChromeShiftY(pill, overlay, 16)).toBe(12);
  });

  it('shifts up when pill overflows bottom edge', () => {
    const pill = rect(100, 500, 760, 820);
    expect(clampChromeShiftY(pill, overlay, 16)).toBe(-36);
  });
});

describe('clampChromeShift', () => {
  const overlay = rect(0, 1000, 0, 800);

  it('combines horizontal and vertical shifts', () => {
    const pill = rect(4, 300, 4, 80);
    expect(clampChromeShift(pill, overlay, 16)).toEqual({ x: 12, y: 12 });
  });
});
