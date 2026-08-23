import { describe, expect, it } from 'vitest';
import { snapBoxToGrid, snapCoordToGrid, snapResizeToGrid } from '../alignGuides';
import {
  strokeChromeOutset,
  inflateBoxByVisualOutset,
  strokeVisualOutset,
} from '../../scene/document/sceneEffects';
import { resolveClosedDrawBoxes } from '../../tools/ShapeDrawFeature';
import type { SceneNodeInput } from '@/components/rcb/sceneNode';

/**
 * Production move when gridSize > 0 (object magnets removed):
 *   snapBoxToGrid on visual outer → apply delta to path → align guides (paint-only)
 */
function moveSnapVisualOnly(opts: {
  path: { left: number; top: number; width: number; height: number };
  node: SceneNodeInput;
  gridSize: number;
  dx?: number;
  dy?: number;
}) {
  const visual0 = inflateBoxByVisualOutset(opts.path, opts.node);
  const dragged = {
    ...visual0,
    left: visual0.left + (opts.dx ?? 0),
    top: visual0.top + (opts.dy ?? 0),
  };
  const visual = snapBoxToGrid(dragged, opts.gridSize);
  const sdx = visual.left - visual0.left;
  const sdy = visual.top - visual0.top;
  return {
    visual,
    path: {
      ...opts.path,
      left: opts.path.left + sdx,
      top: opts.path.top + sdy,
    },
    sdx,
    sdy,
  };
}

function assertInkOnGrid(
  path: { left: number; top: number; width: number; height: number },
  node: SceneNodeInput,
  gridSize: number
) {
  const ink = inflateBoxByVisualOutset(path, node);
  expect(ink.left).toBe(snapCoordToGrid(ink.left, gridSize));
  expect(ink.top).toBe(snapCoordToGrid(ink.top, gridSize));
  expect(ink.left + ink.width).toBe(snapCoordToGrid(ink.left + ink.width, gridSize));
  expect(ink.top + ink.height).toBe(snapCoordToGrid(ink.top + ink.height, gridSize));
}

describe('visual-outer move snap (1px grid)', () => {
  const centerStroke1: SceneNodeInput = {
    key: 'shape',
    attrs: {
      shapeType: 'rect',
      'border-width': 1,
      'border-color': '#333333',
      strokeAlign: 'center',
      'stroke-enabled': 'true',
      'stroke-visible': 'true',
    },
  };

  it('chrome stays on stored geometry while stroke keeps its visual outset', () => {
    expect(strokeChromeOutset(centerStroke1)).toBe(0);
    expect(strokeVisualOutset(centerStroke1)).toBe(0.5);
    const path = { left: 10.5, top: 8.5, width: 3, height: 2 };
    const visual = {
      left: path.left - 0.5,
      top: path.top - 0.5,
      width: path.width + 1,
      height: path.height + 1,
    };
    expect(inflateBoxByVisualOutset(path, centerStroke1)).toEqual(visual);
  });

  it('closed draw places path so ink lands on grid', () => {
    const draft = { left: 10.2, top: 8.7, width: 12.4, height: 9.1 };
    const { visual, geom } = resolveClosedDrawBoxes(draft, true, 1, 'rect');
    assertInkOnGrid(geom, centerStroke1, 1);
    expect(visual.left).toBe(snapCoordToGrid(visual.left, 1));
  });

  it('move keeps ink on grid with subpixel pointer noise', () => {
    const path = { left: 10.5, top: 8.5, width: 7, height: 7 };
    const right = moveSnapVisualOnly({
      path,
      node: centerStroke1,
      gridSize: 1,
      dx: 2.3,
      dy: 0,
    });
    assertInkOnGrid(right.path, centerStroke1, 1);
  });

  it('gap drag with noise still lands ink on grid (no object magnets)', () => {
    const leftVis = { left: 10, top: 10, width: 8, height: 8 };
    const rightPath = { left: 22.5, top: 10.5, width: 7, height: 7 };
    const rightVis0 = inflateBoxByVisualOutset(rightPath, centerStroke1);
    expect(rightVis0.left).toBe(22);

    const noisy = {
      ...rightVis0,
      left: leftVis.left + leftVis.width + 4 + 0.37,
      top: rightVis0.top + 0.22,
    };
    const gridOnly = snapBoxToGrid(noisy, 1);

    const moved = moveSnapVisualOnly({
      path: rightPath,
      node: centerStroke1,
      gridSize: 1,
      dx: noisy.left - rightVis0.left,
      dy: noisy.top - rightVis0.top,
    });
    assertInkOnGrid(moved.path, centerStroke1, 1);
    expect(moved.visual.left).toBe(gridOnly.left);
    expect(moved.visual.top).toBe(gridOnly.top);
  });

  it('repair: path already integer (ink *.5) — one drag puts ink back on grid', () => {
    const brokenPath = { left: 14, top: 11, width: 7, height: 7 };
    const brokenInk = inflateBoxByVisualOutset(brokenPath, centerStroke1);
    expect(brokenInk.left).toBe(13.5);
    expect(brokenInk.left).not.toBe(snapCoordToGrid(brokenInk.left, 1));

    const fixed = moveSnapVisualOnly({
      path: brokenPath,
      node: centerStroke1,
      gridSize: 1,
      dx: 0.01,
      dy: 0.01,
    });
    assertInkOnGrid(fixed.path, centerStroke1, 1);
  });

  it('resize visual edge then inset path keeps ink on grid', () => {
    const path = { left: 10.5, top: 10.5, width: 7, height: 7 };
    const visual0 = inflateBoxByVisualOutset(path, centerStroke1);
    const grown = { ...visual0, width: visual0.width + 2.4 };
    const gridVisual = snapResizeToGrid(grown, 'e', 1, 2);
    const outset = strokeVisualOutset(centerStroke1);
    const pathNext = {
      left: gridVisual.left + outset,
      top: gridVisual.top + outset,
      width: Math.max(1, gridVisual.width - outset * 2),
      height: Math.max(1, gridVisual.height - outset * 2),
    };
    assertInkOnGrid(pathNext, centerStroke1, 1);
  });
});
