import { describe, expect, it } from 'vitest';
import { snapBoxToGrid, snapCoordToGrid } from '../alignGuides';
import { inflateBoxByVisualOutset } from '../../scene/document/sceneEffects';

/** Production move settle after object magnets removed: visual-outer grid only. */
function productionMoveSettle(opts: {
  path: { left: number; top: number; width: number; height: number };
  node: {
    key: string;
    attrs: Record<string, unknown>;
  };
  zoom: number;
  gridSize?: number;
}) {
  void opts.zoom;
  const gridSize = opts.gridSize ?? 1;
  const visual0 = inflateBoxByVisualOutset(opts.path, opts.node);
  const visual = gridSize > 0 ? snapBoxToGrid(visual0, gridSize) : visual0;
  const sdx = visual.left - visual0.left;
  const sdy = visual.top - visual0.top;
  return {
    path: {
      ...opts.path,
      left: opts.path.left + sdx,
      top: opts.path.top + sdy,
    },
    visual,
  };
}

function assertInkOnGrid(
  path: { left: number; top: number; width: number; height: number },
  node: { key: string; attrs: Record<string, unknown> },
  gridSize: number
) {
  const ink = inflateBoxByVisualOutset(path, node);
  expect(ink.left).toBeCloseTo(snapCoordToGrid(ink.left, gridSize), 9);
  expect(ink.top).toBeCloseTo(snapCoordToGrid(ink.top, gridSize), 9);
}

describe('move grid integrity (no object magnets)', () => {
  const centerStroke1 = {
    key: 'shape',
    attrs: {
      shapeType: 'rect',
      'border-width': 1,
      'border-color': '#333',
      strokeAlign: 'center',
      'stroke-enabled': 'true',
      'stroke-visible': 'true',
    },
  };

  it('oscillating near a sibling never leaves the ink grid at any zoom', () => {
    for (const zoom of [0.05, 0.25, 0.5, 1, 2, 8]) {
      let path = { left: 140.5, top: 0.5, width: 134, height: 291 };
      for (let i = 0; i < 40; i += 1) {
        const intended = 135 + 4 + Math.sin(i * 0.9) * 10 + (i % 3) * 0.17;
        const top = Math.cos(i * 0.6) * 5.3;
        const dragged = { ...path, left: intended, top: path.top + top };
        const { path: next } = productionMoveSettle({
          path: dragged,
          node: centerStroke1,
          zoom,
        });
        path = next;
        assertInkOnGrid(path, centerStroke1, 1);
      }
    }
  });

  it('grid settle follows pointer by whole cells on ink', () => {
    const a = productionMoveSettle({
      path: { left: 140.5, top: 0.5, width: 134, height: 291 },
      node: centerStroke1,
      zoom: 1,
    });
    const b = productionMoveSettle({
      path: { left: 141.5, top: 0.5, width: 134, height: 291 },
      node: centerStroke1,
      zoom: 1,
    });
    expect(a.visual.left).toBe(snapCoordToGrid(140, 1));
    expect(b.visual.left).toBe(a.visual.left + 1);
    assertInkOnGrid(a.path, centerStroke1, 1);
    assertInkOnGrid(b.path, centerStroke1, 1);
  });

  it('center-stroke move keeps ink on integer grid (not path origin)', () => {
    let path = { left: 140.5, top: 0.5, width: 134, height: 291 };

    for (let i = 0; i < 25; i += 1) {
      const intendedLeft = 135 + 4 + Math.sin(i) * 6;
      const dragged = {
        ...path,
        left: intendedLeft,
        top: path.top + Math.cos(i * 0.5) * 2.4,
      };
      const { path: next } = productionMoveSettle({
        path: dragged,
        node: centerStroke1,
        zoom: 1,
      });
      path = next;
      assertInkOnGrid(path, centerStroke1, 1);
      expect(path.left).toBeCloseTo(Math.round(path.left * 2) / 2, 9);
    }
  });
});
