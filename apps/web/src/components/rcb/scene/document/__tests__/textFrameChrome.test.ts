import { describe, expect, it } from 'vitest';
import {
  TEXT_FRAME_RADIUS,
  textFrameCornerRadii,
} from '@/components/rcb/scene/document/sceneEffects';
import { resolveTextFramePlateFill } from '@/components/rcb/scene/document/nodeFactories';

describe('text frame artboard chrome', () => {
  it('defaults plate fill to white (not generator gray)', () => {
    expect(resolveTextFramePlateFill(undefined)).toBe('#FFFFFF');
    expect(resolveTextFramePlateFill('')).toBe('#FFFFFF');
    expect(resolveTextFramePlateFill('white')).toBe('#FFFFFF');
    expect(resolveTextFramePlateFill('#336699')).toBe('#336699');
  });

  it('defaults corners sharp like artboards', () => {
    expect(TEXT_FRAME_RADIUS).toBe(0);
    expect(textFrameCornerRadii({})).toEqual({ tl: 0, tr: 0, br: 0, bl: 0 });
    expect(
      textFrameCornerRadii({
        radiusTL: 8,
        radiusTR: 0,
        radiusBR: 0,
        radiusBL: 0,
      })
    ).toEqual({ tl: 8, tr: 0, br: 0, bl: 0 });
  });
});
