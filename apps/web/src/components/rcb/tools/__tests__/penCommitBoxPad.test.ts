import { describe, expect, it } from 'vitest';
import {
  penAnchorsToD,
  boundsOfAnchors,
  penCommitBoxPad,
  type PenAnchor,
} from '../penPath';

describe('penCommitBoxPad', () => {
  it('closed path uses path geometry (no stroke half-pad)', () => {
    expect(penCommitBoxPad(8, true)).toBe(0);
    expect(penCommitBoxPad(2, true)).toBe(0);
  });

  it('open stroke pads half border-width so the box covers ink', () => {
    expect(penCommitBoxPad(8, false)).toBe(4);
    expect(penCommitBoxPad(2, false)).toBe(1);
  });

  it('closed commit box equals boundsOfAnchors (no empty margin vs control box)', () => {
    const anchors: PenAnchor[] = [
      { x: 10, y: 20 },
      { x: 50, y: 20 },
      { x: 50, y: 60 },
      { x: 10, y: 60 },
    ];
    const bounds = boundsOfAnchors(anchors, true);
    const pad = penCommitBoxPad(12, true);
    const box = {
      left: bounds.left - pad,
      top: bounds.top - pad,
      width: bounds.width + pad * 2,
      height: bounds.height + pad * 2,
    };
    expect(box).toEqual(bounds);
    expect(penAnchorsToD(anchors, true).toLowerCase()).toContain('z');
  });
});
