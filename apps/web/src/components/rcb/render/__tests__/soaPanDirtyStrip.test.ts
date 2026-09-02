import { describe, expect, it } from 'vitest';
import {
  blitHtmlCanvasCssOffset,
  panRevealSceneAabb,
  seedSoaGestureDirtyAccum,
  peekSoaGestureDirtyAccum,
  clearSoaGestureDirtyAccum,
} from '../soaBakeLayer';

describe('pan dirty strip / blit (Phase 2)', () => {
  it('panRevealSceneAabb covers left/right strips for horizontal pan', () => {
    const view = { x: 0, y: 0, width: 1000, height: 800 };
    const right = panRevealSceneAabb({
      dxCss: -40,
      dyCss: 0,
      view,
      zoom: 1,
    });
    expect(right).not.toBeNull();
    expect(right!.left + right!.width).toBeGreaterThan(960);
    expect(right!.width).toBeGreaterThan(30);

    const left = panRevealSceneAabb({
      dxCss: 40,
      dyCss: 0,
      view,
      zoom: 1,
    });
    expect(left).not.toBeNull();
    expect(left!.left).toBeLessThanOrEqual(2);
    expect(left!.width).toBeGreaterThan(30);
  });

  it('seedSoaGestureDirtyAccum replaces peek', () => {
    clearSoaGestureDirtyAccum();
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

  it('blitHtmlCanvasCssOffset no-ops on missing canvas', () => {
    expect(blitHtmlCanvasCssOffset(null, 5, 0, 1)).toBe(false);
  });
});
