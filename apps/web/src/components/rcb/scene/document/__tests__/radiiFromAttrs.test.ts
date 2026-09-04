import { describe, expect, it } from 'vitest';
import {
  cornerRadiusToolbarDisplay,
  radiiFromAttrs,
} from '@/components/rcb/scene/document/sceneRadii';

describe('radiiFromAttrs', () => {
  it('uses positive uniform cornerRadius when factories seeded radiusTL=0', () => {
    const r = radiiFromAttrs({
      radiusTL: 0,
      radiusTR: 0,
      radiusBR: 0,
      radiusBL: 0,
      radiusLinked: 'true',
      cornerRadius: 24,
    });
    expect(r).toEqual({ tl: 24, tr: 24, br: 24, bl: 24 });
    expect(
      cornerRadiusToolbarDisplay({
        radiusTL: 0,
        radiusTR: 0,
        radiusBR: 0,
        radiusBL: 0,
        radiusLinked: 'true',
        cornerRadius: 24,
      })
    ).toBe(24);
  });

  it('keeps explicit per-corner values over uniform', () => {
    const r = radiiFromAttrs({
      radiusTL: 8,
      radiusTR: 12,
      radiusBR: 8,
      radiusBL: 12,
      radiusLinked: 'false',
      cornerRadius: 99,
    });
    expect(r).toEqual({ tl: 8, tr: 12, br: 8, bl: 12 });
  });
});
