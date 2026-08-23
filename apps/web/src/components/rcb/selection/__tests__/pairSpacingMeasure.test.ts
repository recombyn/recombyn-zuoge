import { describe, expect, it } from 'vitest';
import {
  SMART_SNAP_PX,
  SMART_SNAP_MAX_SCENE,
  collectPairSpacingGuides,
  smartSnapThreshold,
} from '../alignGuides';

describe('collectPairSpacingGuides', () => {
  it('shows horizontal clear gap between side-by-side boxes', () => {
    const a = { left: 0, top: 0, width: 100, height: 80 };
    const b = { left: 140, top: 10, width: 100, height: 120 };
    const guides = collectPairSpacingGuides(a, b);
    const gaps = guides.filter((g) => g.kind === 'gap');
    expect(gaps.some((g) => g.kind === 'gap' && g.axis === 'x' && g.dist === 40)).toBe(true);
  });

  it('top offset uses measure in the gap with rails on both tops', () => {
    // Slight y-overlap + x-gap (same geometry as the poster repro).
    const a = { left: 0, top: 0, width: 135, height: 292 };
    const b = { left: 200, top: 283, width: 135, height: 292 };
    const guides = collectPairSpacingGuides(a, b);
    const top = guides.find(
      (g) => g.kind === 'gap' && g.axis === 'y' && g.dist === 283
    );
    expect(top).toBeTruthy();
    if (top && top.kind === 'gap') {
      // Measure sits in the horizontal gap, not at either box center.
      expect(top.at).toBeGreaterThan(135);
      expect(top.at).toBeLessThan(200);
      expect(top.rails?.length).toBe(2);
      const railAts = (top.rails || []).map((r) => r.at).sort((x, y) => x - y);
      expect(railAts[0]).toBeCloseTo(0, 6);
      expect(railAts[1]).toBeCloseTo(283, 6);
      // Each rail reaches the measure line.
      for (const r of top.rails || []) {
        expect(Math.min(r.from, r.to)).toBeLessThanOrEqual(top.at + 1e-6);
        expect(Math.max(r.from, r.to)).toBeGreaterThanOrEqual(top.at - 1e-6);
      }
    }
  });

  it('does not add bottom offset when tops already differ (no stray lower dashed)', () => {
    const a = { left: 0, top: 0, width: 135, height: 292 };
    const b = { left: 200, top: 283, width: 135, height: 292 };
    const guides = collectPairSpacingGuides(a, b);
    const yGaps = guides.filter((g): g is Extract<typeof g, { kind: 'gap' }> => g.kind === 'gap' && g.axis === 'y');
    // Only the top-to-top offset — not a second bottom-to-bottom measure.
    expect(yGaps).toHaveLength(1);
    expect(yGaps[0]?.dist).toBe(283);
  });

  it('bottom offset appears only when tops are aligned', () => {
    const a = { left: 0, top: 0, width: 100, height: 80 };
    const b = { left: 140, top: 0, width: 80, height: 200 };
    const guides = collectPairSpacingGuides(a, b);
    const bottom = guides.find(
      (g) => g.kind === 'gap' && g.axis === 'y' && g.dist === 120
    );
    expect(bottom).toBeTruthy();
    if (bottom && bottom.kind === 'gap') {
      expect(bottom.rails?.length).toBe(2);
    }
  });

  it('skips aligned top offset when tops coincide and heights match', () => {
    const a = { left: 0, top: 0, width: 100, height: 80 };
    const b = { left: 140, top: 0, width: 80, height: 80 };
    const guides = collectPairSpacingGuides(a, b);
    const yGaps = guides.filter((g) => g.kind === 'gap' && g.axis === 'y');
    expect(yGaps).toHaveLength(0);
  });

  it('shows vertical clear gap when stacked', () => {
    const a = { left: 0, top: 0, width: 120, height: 60 };
    const b = { left: 10, top: 100, width: 120, height: 60 };
    const guides = collectPairSpacingGuides(a, b);
    expect(guides.some((g) => g.kind === 'gap' && g.axis === 'y' && g.dist === 40)).toBe(
      true
    );
  });

  it('diagonal (no axis overlap) still shows both clearances — preview inspect', () => {
    // Poster top-left vs rect below-right (figure-1 style: no x/y overlap).
    const poster = { left: 0, top: 100, width: 155, height: 292 };
    const rect = { left: 264.5, top: 467.5, width: 256, height: 114 };
    const guides = collectPairSpacingGuides(poster, rect);
    const gaps = guides.filter((g) => g.kind === 'gap');
    // Horizontal: 264.5 - 155 = 109.5 → 110
    expect(gaps.some((g) => g.kind === 'gap' && g.axis === 'x' && g.dist === 110)).toBe(
      true
    );
    // Vertical: 467.5 - (100+292) = 75.5 → 76
    expect(gaps.some((g) => g.kind === 'gap' && g.axis === 'y' && g.dist === 76)).toBe(
      true
    );
  });

  it('returns empty for invalid boxes', () => {
    expect(
      collectPairSpacingGuides(
        { left: 0, top: 0, width: 0, height: 10 },
        { left: 20, top: 0, width: 10, height: 10 }
      )
    ).toEqual([]);
  });
});

describe('smartSnapThreshold (8/zoom, capped)', () => {
  it('keeps ~8 CSS px until SMART_SNAP_MAX_SCENE', () => {
    for (const zoom of [0.05, 0.13, 0.25, 1, 2, 40]) {
      expect(smartSnapThreshold(zoom)).toBeCloseTo(
        Math.min(SMART_SNAP_PX / zoom, SMART_SNAP_MAX_SCENE),
        6
      );
    }
    expect(smartSnapThreshold(0.05)).toBeCloseTo(SMART_SNAP_MAX_SCENE, 9);
    expect(smartSnapThreshold(1)).toBe(SMART_SNAP_PX);
  });
});
