import { describe, expect, it } from 'vitest';
import { rcbFitImageIntoViewport } from '@/components/rcb/core/layout';
import {
  AUDIO_ASPECT_RATIO,
  AUDIO_MIN_HEIGHT,
  AUDIO_MIN_WIDTH,
  MEDIA_PLACE_DEFAULT,
  createAudioNode,
  fitMediaIntoViewport,
  normalizeAudioSize,
} from '@/components/rcb/scene/document/nodeFactories';

describe('audio node sizing', () => {
  it('normalizes small or inconsistent sizes to the fixed audio ratio', () => {
    const size = normalizeAudioSize(120, 140);

    expect(size.width).toBeGreaterThanOrEqual(AUDIO_MIN_WIDTH);
    expect(size.height).toBeGreaterThanOrEqual(AUDIO_MIN_HEIGHT);
    expect(size.width / size.height).toBeCloseTo(AUDIO_ASPECT_RATIO, 5);
  });

  it('applies the same ratio through the node factory', () => {
    const { node } = createAudioNode({ width: 263, height: 230, src: 'audio.mp3' });

    expect(node.width / node.height).toBeCloseTo(AUDIO_ASPECT_RATIO, 5);
    expect(node.attrs.lockAspect).toBe('true');
  });

  it('fitMediaIntoViewport matches video sizing then locks audio aspect', () => {
    const viewport = { width: 800, height: 600 };
    const zoom = 1;
    const sizeForViewport = (natural: { width: number; height: number }) =>
      rcbFitImageIntoViewport(natural, viewport, zoom);

    const video = sizeForViewport({ ...MEDIA_PLACE_DEFAULT });
    const audio = fitMediaIntoViewport('audio', { ...MEDIA_PLACE_DEFAULT }, sizeForViewport);

    expect(audio.width).toBeGreaterThanOrEqual(video.width * 0.95);
    expect(audio.width / audio.height).toBeCloseTo(AUDIO_ASPECT_RATIO, 2);
    expect(audio.width).toBeGreaterThanOrEqual(AUDIO_MIN_WIDTH);
    expect(audio.height).toBeGreaterThanOrEqual(AUDIO_MIN_HEIGHT);
  });

  it('normalizeAudioSize clamps video-sized metadata', () => {
    const size = normalizeAudioSize(6234, 3463);
    expect(size.width).toBeLessThanOrEqual(1440);
    expect(size.height).toBeLessThanOrEqual(800);
    expect(size.width / size.height).toBeCloseTo(AUDIO_ASPECT_RATIO, 2);
  });

  it('createAudioNode caps oversized placement dimensions', () => {
    const { node } = createAudioNode({ width: 3371, height: 1873, src: 'a.mp3' });
    expect(node.width).toBeLessThanOrEqual(1440);
    expect(node.height).toBeLessThanOrEqual(800);
  });
});
