import { describe, expect, it } from 'vitest';
import {
  framePlateClearsIdleStroke,
  framePlateShowsHighlightEdge,
} from '../HtmlArtboardFrame';

describe('multi-frame plate stroke', () => {
  it('clears idle stroke only for the sole full-chrome plate', () => {
    expect(
      framePlateClearsIdleStroke({
        chromeMode: 'full',
        selectedFrameIds: ['a'],
        frameId: 'a',
      })
    ).toBe(true);
    expect(
      framePlateClearsIdleStroke({
        chromeMode: 'full',
        selectedFrameIds: ['a', 'b'],
        frameId: 'a',
      })
    ).toBe(false);
    expect(
      framePlateClearsIdleStroke({
        chromeMode: 'soft',
        selectedFrameIds: ['a'],
        frameId: 'a',
      })
    ).toBe(false);
  });

  it('highlights multi-full members so plate edges stay under the union box', () => {
    expect(
      framePlateShowsHighlightEdge({
        chromeMode: 'full',
        selectedFrameIds: ['a', 'b'],
        frameId: 'a',
      })
    ).toBe(true);
    expect(
      framePlateShowsHighlightEdge({
        chromeMode: 'full',
        selectedFrameIds: ['a'],
        frameId: 'a',
      })
    ).toBe(false);
    expect(
      framePlateShowsHighlightEdge({
        chromeMode: 'soft',
        selectedFrameIds: ['a'],
        frameId: 'a',
      })
    ).toBe(true);
  });
});
