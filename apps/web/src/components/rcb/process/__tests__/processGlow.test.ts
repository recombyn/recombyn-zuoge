import { describe, expect, it } from 'vitest';
import {
  PROCESS_GLOW_BLEED_PX,
  PROCESS_PILL_BOTTOM_PAD_PX,
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

  it('documents that pill pad is measured from the plate inset, not FO bleed', () => {
    // FO bottom sits PROCESS_GLOW_BLEED_PX below the plate. At zoom Z the old
    // `bottom: pad/Z` was relative to the FO, so the pill sat ~bleed*Z CSS px
    // outside the node. ProcessGlowShell insets by bleed so pad is plate-local.
    const zoom = 40;
    const inv = 1 / zoom;
    const foBottomPastPlate = PROCESS_GLOW_BLEED_PX;
    const oldPillPastPlate = foBottomPastPlate - PROCESS_PILL_BOTTOM_PAD_PX * inv;
    expect(oldPillPastPlate).toBeGreaterThan(2);
    expect(oldPillPastPlate * zoom).toBeGreaterThan(80);
  });
});
