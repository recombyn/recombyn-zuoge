import { describe, expect, it } from 'vitest';
import {
  PROCESS_GLOW_BLEED_PX,
  processGlowForeignObjectBounds,
} from '../processGlow';

describe('processGlowForeignObjectBounds', () => {
  it('expands foreignObject by bleed on all sides', () => {
    const box = processGlowForeignObjectBounds(100, 50);
    expect(box).toEqual({
      x: -PROCESS_GLOW_BLEED_PX,
      y: -PROCESS_GLOW_BLEED_PX,
      width: 100 + PROCESS_GLOW_BLEED_PX * 2,
      height: 50 + PROCESS_GLOW_BLEED_PX * 2,
    });
  });
});
