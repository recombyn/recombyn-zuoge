import { describe, expect, it } from 'vitest';
import { emitPathStrokeSegments } from '../webglSceneRenderer';

describe('emitPathStrokeSegments', () => {
  it('closes each contour so boolean holes get a full outline', () => {
    // Outer triangle + NaN break + inner edge (2 pts only → one close seg).
    const xy = new Float32Array([
      0, 0, 10, 0, 5, 8, Number.NaN, Number.NaN, 2, 2, 8, 2,
    ]);
    const rects: number[] = [];
    const kinds: number[] = [];
    const emitted = emitPathStrokeSegments({
      xy,
      start: 0,
      len: 6,
      rgba: [0, 0, 0, 1],
      thickness: 2,
      closeContours: true,
      rects,
      colors: [],
      kinds,
      angles: [],
      uvs: [],
      depth: 0.5,
      paintClips: [[-1e9, -1e9, 1e9, 1e9]],
    });
    // Outer: 2 edges + 1 close = 3; inner: 1 edge + 1 close = 2 → 5
    expect(emitted).toBe(5);
    expect(kinds.every((k) => k === 2)).toBe(true);
  });
});
