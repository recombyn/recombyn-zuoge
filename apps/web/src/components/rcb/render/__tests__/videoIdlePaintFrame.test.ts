import { describe, expect, it, beforeEach } from 'vitest';
import { mediaPaintSrc } from '../sceneRenderer';
import {
  clearAllVideoIdlePaintFrames,
  setVideoIdlePaintFrame,
} from '../videoIdlePaintFrame';

describe('mediaPaintSrc video idle frame', () => {
  beforeEach(() => {
    clearAllVideoIdlePaintFrames();
  });

  it('prefers runtime pause frame over attrs.poster', () => {
    setVideoIdlePaintFrame('v1', 'data:image/jpeg;base64,PAUSE', 2.1);
    expect(
      mediaPaintSrc(
        {
          id: 'v1',
          key: 'video',
          attrs: {
            src: 'https://example.com/a.mp4',
            poster: 'https://example.com/poster.jpg',
          },
        },
        'v1'
      )
    ).toBe('data:image/jpeg;base64,PAUSE');
  });

  it('falls back to poster when no runtime frame', () => {
    expect(
      mediaPaintSrc({
        id: 'v2',
        key: 'video',
        attrs: {
          src: 'https://example.com/a.mp4',
          poster: 'https://example.com/poster.jpg',
        },
      })
    ).toBe('https://example.com/poster.jpg');
  });
});
