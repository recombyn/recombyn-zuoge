import { describe, expect, it } from 'vitest';
import { snapExpandFrameToImageCenter } from '../CropExpandOverlay';

describe('snapExpandFrameToImageCenter', () => {
  it('centers each matching axis exactly', () => {
    const result = snapExpandFrameToImageCenter(
      { ox: -52, oy: -76, w: 200, h: 220 },
      100,
      80,
      4
    );

    expect(result).toEqual({
      frame: { ox: -50, oy: -76, w: 200, h: 220 },
      snapX: true,
      snapY: false,
    });
  });

  it('keeps an axis free when it is outside the screen-space threshold', () => {
    const result = snapExpandFrameToImageCenter(
      { ox: -42, oy: -68, w: 200, h: 220 },
      100,
      80,
      4
    );

    expect(result.frame).toEqual({ ox: -42, oy: -70, w: 200, h: 220 });
    expect(result.snapX).toBe(false);
    expect(result.snapY).toBe(true);
  });

  it('does not alter a frame when snapping is disabled', () => {
    const frame = { ox: -47, oy: -67, w: 200, h: 220 };
    expect(snapExpandFrameToImageCenter(frame, 100, 80, 0)).toEqual({
      frame,
      snapX: false,
      snapY: false,
    });
  });
});
