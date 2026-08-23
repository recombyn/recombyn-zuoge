import { describe, expect, it } from 'vitest';
import {
  findPencilBrush,
  outlinePathFromPoints,
  pencilSampleMinStep,
  pencilSimplifyEpsilon,
  simplifyPencilCenterline,
  type Pt,
} from '../pencilBrushes';

describe('pencil stroke smoothness', () => {
  it('sample min step is dense at 1px stroke', () => {
    const brush = findPencilBrush('vector-ink');
    const step = pencilSampleMinStep(1, brush);
    expect(step).toBeLessThan(0.6);
    expect(step).toBeGreaterThanOrEqual(0.12);
  });

  it('simplifyPencilCenterline drops colinear points and keeps pressure', () => {
    const dense: Pt[] = [];
    for (let i = 0; i <= 40; i += 1) {
      dense.push({ x: i, y: i * 0.01, pressure: 0.2 + (i / 40) * 0.6 });
    }
    const out = simplifyPencilCenterline(dense, 0.5);
    expect(out.length).toBeLessThan(dense.length);
    expect(out[0]).toMatchObject({ x: 0, y: 0 });
    expect(out[out.length - 1].x).toBe(40);
    expect(out.every((p) => typeof p.pressure === 'number')).toBe(true);
  });

  it('freehand outline stays centered on sharp polyline', () => {
    const pts: Pt[] = [
      { x: 0, y: 10 },
      { x: 40, y: 10 },
      { x: 40, y: 50 },
      { x: 90, y: 50 },
    ];
    const d = outlinePathFromPoints(pts, 8, 'vector-ink', {
      pressureEnabled: false,
      linecap: 'round',
    });
    expect(d.startsWith('M')).toBe(true);
    const nums = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) || [];
    const verts: Pt[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      verts.push({ x: nums[i], y: nums[i + 1] });
    }
    expect(verts.length).toBeGreaterThan(8);

    function pointInPoly(x: number, y: number): boolean {
      let inside = false;
      for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
        const xi = verts[i].x;
        const yi = verts[i].y;
        const xj = verts[j].x;
        const yj = verts[j].y;
        const hit =
          yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
        if (hit) inside = !inside;
      }
      return inside;
    }
    expect(pointInPoly(20, 10)).toBe(true);
    expect(pointInPoly(40, 30)).toBe(true);
    expect(pointInPoly(40, 10)).toBe(true);
  });

  it('pencilSimplifyEpsilon scales with tip size', () => {
    expect(pencilSimplifyEpsilon(10)).toBeCloseTo(0.45, 5);
    expect(pencilSimplifyEpsilon(1)).toBe(0.25);
  });

  it('unknown brushStyle falls back to vector-ink', () => {
    expect(findPencilBrush('unknown-id').id).toBe('vector-ink');
    expect(findPencilBrush(undefined).id).toBe('vector-ink');
  });
});
