import { describe, expect, it } from 'vitest';
import {
  normalizeDragBox,
  previewDragBox,
} from '../MarkRegionOverlay';

describe('mark region drag boxes', () => {
  it('preview shows sub-threshold rubber bands; commit rejects them', () => {
    const preview = previewDragBox(10, 10, 16, 18, 400, 300);
    expect(preview).toEqual({ x: 10, y: 10, w: 6, h: 8 });
    expect(normalizeDragBox(10, 10, 16, 18, 400, 300)).toBeNull();
  });

  it('commit accepts boxes at least 12×12', () => {
    const box = normalizeDragBox(0, 0, 20, 24, 400, 300);
    expect(box).toEqual({ x: 0, y: 0, w: 20, h: 24 });
    expect(previewDragBox(0, 0, 20, 24, 400, 300)).toEqual(box);
  });

  it('clamps to image bounds while dragging', () => {
    const preview = previewDragBox(-10, -5, 50, 40, 100, 80);
    expect(preview).toEqual({ x: 0, y: 0, w: 50, h: 40 });
  });
});
