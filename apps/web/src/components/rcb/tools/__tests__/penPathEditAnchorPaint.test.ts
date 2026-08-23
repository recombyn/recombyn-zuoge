import { describe, expect, it } from 'vitest';
import { filterAnchorsForKnobPaint } from '../PenPathEditFeature';

describe('path-edit anchor knob paint', () => {
  it('keeps dense verts out of paint while preserving forced / spaced knobs', () => {
    // 1 scene unit apart @ zoom 1 → many would carpet; gap is ~12px ≈ 12 scene units.
    const anchors = Array.from({ length: 40 }, (_, i) => ({
      x: i * 1,
      y: 0,
      force: i === 0 || i === 39,
    }));
    const mask = filterAnchorsForKnobPaint(anchors, 1, 12);
    const painted = mask.filter(Boolean).length;
    expect(mask[0]).toBe(true);
    expect(mask[39]).toBe(true);
    expect(painted).toBeLessThan(10);
    expect(painted).toBeGreaterThanOrEqual(2);
  });

  it('always paints forced anchors even when neighbors are dense', () => {
    const anchors = [
      { x: 0, y: 0, force: true },
      { x: 1, y: 0 },
      { x: 2, y: 0, force: true },
      { x: 3, y: 0 },
    ];
    const mask = filterAnchorsForKnobPaint(anchors, 1, 12);
    expect(mask[0]).toBe(true);
    expect(mask[2]).toBe(true);
    expect(mask[1]).toBe(false);
    expect(mask[3]).toBe(false);
  });
});
