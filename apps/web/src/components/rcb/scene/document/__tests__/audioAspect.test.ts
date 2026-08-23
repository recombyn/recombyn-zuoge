import { describe, expect, it } from 'vitest';
import {
  AUDIO_ASPECT_RATIO,
  AUDIO_MIN_HEIGHT,
  AUDIO_MIN_WIDTH,
  createAudioNode,
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
});
