import { describe, expect, it } from 'vitest';
import { videoChromeLayout, VIDEO_PLAYBACK_BAR_H } from '@/components/editor/nodes/VideoNode/VideoPlaybackBar';

describe('videoChromeLayout', () => {
  it('keeps full layout width when the plate is wider than chrome', () => {
    const chrome = videoChromeLayout(400, 220);
    expect(chrome.layoutW).toBeGreaterThanOrEqual(240);
    expect(chrome.fit).toBe(1);
    expect(chrome.visible).toBe(true);
    expect(chrome.barScreenH).toBe(VIDEO_PLAYBACK_BAR_H);
  });

  it('shrinks uniformly for narrow attach previews instead of crushing items', () => {
    // Historic attach preview was 160px — chrome must scale, not reflow into 160px.
    const chrome = videoChromeLayout(160, 90);
    expect(chrome.layoutW).toBe(240);
    expect(chrome.fit).toBeCloseTo(160 / 240, 5);
    expect(chrome.visible).toBe(true);
    expect(chrome.barScreenH).toBeCloseTo(VIDEO_PLAYBACK_BAR_H * (160 / 240), 5);
  });

  it('fits ~280px video attach preview at full chrome density', () => {
    const chrome = videoChromeLayout(280, 158);
    expect(chrome.layoutW).toBe(280);
    expect(chrome.fit).toBe(1);
    expect(chrome.visible).toBe(true);
  });
});
