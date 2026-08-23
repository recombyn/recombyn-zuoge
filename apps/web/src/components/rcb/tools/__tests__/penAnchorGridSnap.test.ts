import { describe, expect, it } from 'vitest';
import { snapPenAnchorPoint, snapPenPointToArtboardEdge } from '../PenDrawFeature';
import { penAnchorsToD, boundsOfAnchors, type PenAnchor } from '../penPath';

/**
 * Mirrors PenDrawFeature place path (without DOM):
 * raw pointer → snapPenAnchorPoint → anchor list → commit bounds.
 */
function simulatePenClicks(
  rawPoints: Array<{ x: number; y: number }>,
  gridSize = 1,
  skipGrid = false
): PenAnchor[] {
  return rawPoints.map((raw) => {
    const p = snapPenAnchorPoint(raw.x, raw.y, gridSize, skipGrid);
    return { x: p.x, y: p.y };
  });
}

function assertOnPenGridPerimeter(anchors: PenAnchor[], gridSize: number) {
  const g = gridSize;
  for (const a of anchors) {
    const x2 = Math.round((a.x / g) * 2);
    const y2 = Math.round((a.y / g) * 2);
    expect(a.x / g).toBeCloseTo(x2 / 2, 9);
    expect(a.y / g).toBeCloseTo(y2 / 2, 9);
    expect(x2 % 2 === 0 || y2 % 2 === 0).toBe(true);
  }
}

describe('snapPenAnchorPoint (four corners + four edge midpoints)', () => {
  it('snaps to the nearest perimeter target', () => {
    const raw = { x: 10.3, y: 20.7 };
    const place = snapPenAnchorPoint(raw.x, raw.y, 1, false);
    expect(place).toEqual({ x: 10.5, y: 21 });
  });

  it('snaps to nearest grid cell corner', () => {
    const p = snapPenAnchorPoint(10.15, 20.85, 1, false);
    expect(p).toEqual({ x: 10, y: 21 });
  });

  it('snaps to a vertical edge midpoint', () => {
    const tip = snapPenAnchorPoint(14.12, 11.48, 1, false);
    expect(tip).toEqual({ x: 14, y: 11.5 });
  });

  it('cell center uses a stable edge midpoint and never remains at center', () => {
    const p = snapPenAnchorPoint(3.5, 7.5, 1, false);
    expect(p).toEqual({ x: 3.5, y: 7 });
  });

  it.each([
    [{ x: 10.08, y: 20.08 }, { x: 10, y: 20 }],
    [{ x: 10.5, y: 20.08 }, { x: 10.5, y: 20 }],
    [{ x: 10.92, y: 20.08 }, { x: 11, y: 20 }],
    [{ x: 10.92, y: 20.5 }, { x: 11, y: 20.5 }],
    [{ x: 10.92, y: 20.92 }, { x: 11, y: 21 }],
    [{ x: 10.5, y: 20.92 }, { x: 10.5, y: 21 }],
    [{ x: 10.08, y: 20.92 }, { x: 10, y: 21 }],
    [{ x: 10.08, y: 20.5 }, { x: 10, y: 20.5 }],
  ])('makes every perimeter target reachable: %o -> %o', (raw, expected) => {
    expect(snapPenAnchorPoint(raw.x, raw.y, 1, false)).toEqual(expected);
  });

  it('Ctrl / skip leaves the raw point (free place)', () => {
    const p = snapPenAnchorPoint(3.5, 7.5, 1, true);
    expect(p.x).toBe(3.5);
    expect(p.y).toBe(7.5);
  });

  it('gridSize 0 is a no-op', () => {
    const p = snapPenAnchorPoint(1.2, 3.4, 0, false);
    expect(p).toEqual({ x: 1.2, y: 3.4 });
  });
});

describe('snapPenPointToArtboardEdge', () => {
  it('keeps a near top edge on the exact artboard border', () => {
    expect(
      snapPenPointToArtboardEdge({ x: 42, y: 7 }, { width: 400, height: 300 }, 1)
    ).toEqual({ x: 42, y: 0 });
  });

  it('snaps the right and bottom edges without moving interior points', () => {
    expect(
      snapPenPointToArtboardEdge({ x: 394, y: 296 }, { width: 400, height: 300 }, 1)
    ).toEqual({ x: 400, y: 300 });
    expect(
      snapPenPointToArtboardEdge({ x: 30, y: 30 }, { width: 400, height: 300 }, 1)
    ).toEqual({ x: 30, y: 30 });
  });
});

describe('pen draw full flow (click → snap → path)', () => {
  it('user clicks → all anchors land on cell perimeter targets', () => {
    const rawClicks = [
      { x: 12.3, y: 8.7 },
      { x: 40.1, y: 9.4 },
      { x: 55.6, y: 30.2 },
      { x: 38.9, y: 48.5 },
      { x: 10.2, y: 45.8 },
    ];
    const anchors = simulatePenClicks(rawClicks, 1, false);
    expect(anchors).toHaveLength(5);
    assertOnPenGridPerimeter(anchors, 1);
  });

  it('rubber-band tip follows the same snapped edge midpoint', () => {
    const tip = snapPenAnchorPoint(22.37, 18.61, 1, false);
    expect(tip).toEqual({ x: 22, y: 18.5 });
  });

  it('closed path from snapped anchors keeps vertices on lattice after localize', () => {
    const anchors = simulatePenClicks(
      [
        { x: 0.4, y: 0.4 },
        { x: 10.6, y: 0.3 },
        { x: 10.2, y: 8.7 },
        { x: 0.1, y: 8.4 },
      ],
      1,
      false
    );
    assertOnPenGridPerimeter(anchors, 1);
    const bounds = boundsOfAnchors(anchors, true);
    const d = penAnchorsToD(anchors, true);
    expect(d.length).toBeGreaterThan(0);
    expect(bounds.width).toBeGreaterThan(0);
  });

  it('edit-drag: start off-grid then move → ends on lattice', () => {
    const start = { x: 14.3, y: 11.7 };
    const pointer = { x: 20.2, y: 15.1 };
    const dx = pointer.x - 14.3;
    const dy = pointer.y - 11.7;
    const next = snapPenAnchorPoint(start.x + dx, start.y + dy, 1, false);
    assertOnPenGridPerimeter([next], 1);
  });

  it('final place never stores free mid-cell floats off the lattice', () => {
    const raw = [
      { x: 18.4, y: 22.7 },
      { x: 31.2, y: 35.6 },
    ];
    const placed = simulatePenClicks(raw, 1, false);
    assertOnPenGridPerimeter(placed, 1);
  });
});
