import { describe, expect, it } from 'vitest';
import {
  resizeStrokeByEndpoint,
  strokeEndpointsFromBox,
  strokeNodeFromEndpoints,
  STROKE_GEOMETRY_HEIGHT,
} from '@/components/rcb/scene/document/sceneShapes';
import { strokeEndpointBox, type DragState } from '../selectionLogic';
import type { SceneDocument } from '@/components/rcb/sceneNode';

describe('line/arrow endpoint drag keeps fixed end', () => {
  it('resizeStrokeByEndpoint keeps the opposite world endpoint fixed', () => {
    const box = { left: 0, top: 10, width: 100, height: STROKE_GEOMETRY_HEIGHT };
    const angle = 30;
    const before = strokeEndpointsFromBox(box, angle);
    const next = resizeStrokeByEndpoint(box, angle, 'e', before.x1 + 40, before.y1 + 20);
    const after = strokeEndpointsFromBox(
      { left: next.x, top: next.y, width: next.width, height: next.height },
      next.angle
    );
    expect(after.x0).toBeCloseTo(before.x0, 2);
    expect(after.y0).toBeCloseTo(before.y0, 2);
  });

  it('strokeEndpointBox keeps the opposite endpoint fixed from origin geom', () => {
    const geom = strokeNodeFromEndpoints({ x0: 0, y0: 0, x1: 100, y1: 0 });
    const geomBox = {
      left: geom.x,
      top: geom.y,
      width: geom.width,
      height: geom.height,
    };
    const node = {
      id: 'ln',
      key: 'shape',
      x: geom.x,
      y: geom.y,
      width: geom.width,
      height: geom.height,
      attrs: {
        shapeType: 'line',
        angle: geom.angle,
        'stroke-enabled': true,
        'border-width': 8,
        'border-color': '#000',
      },
      children: [],
    };
    const doc = {
      deltaSetLike: { ln: node },
    } as unknown as SceneDocument;

    const fixedBefore = strokeEndpointsFromBox(geomBox, geom.angle);
    const drag = {
      mode: 'resize',
      handle: 'e',
      origins: [{ nodeId: 'ln', box: { ...geomBox } }],
      union: { ...geomBox },
      angle0: geom.angle,
      strokeFixedWorld: { x: fixedBefore.x0, y: fixedBefore.y0 },
      pointerId: 1,
      startClientX: 0,
      startClientY: 0,
      startSceneX: 0,
      startSceneY: 0,
    } as DragState;

    const stroke = strokeEndpointBox(drag, doc, 180, 40, false);
    expect(stroke).toBeTruthy();
    const after = strokeEndpointsFromBox(stroke!.next, stroke!.angle);
    expect(after.x0).toBeCloseTo(fixedBefore.x0, 2);
    expect(after.y0).toBeCloseTo(fixedBefore.y0, 2);
  });

  it('endpoint preview patch carries angle with box (no separate angle-only step)', () => {
    const geom = strokeNodeFromEndpoints({ x0: 10, y0: 20, x1: 110, y1: 20 });
    const drag = {
      mode: 'resize',
      handle: 'e',
      origins: [
        {
          nodeId: 'ln',
          box: { left: geom.x, top: geom.y, width: geom.width, height: geom.height },
        },
      ],
      union: { left: geom.x, top: geom.y, width: geom.width, height: geom.height },
      angle0: geom.angle,
      pointerId: 1,
      startClientX: 0,
      startClientY: 0,
      startSceneX: 0,
      startSceneY: 0,
    } as DragState;
    const doc = {
      deltaSetLike: {
        ln: {
          id: 'ln',
          key: 'shape',
          x: geom.x,
          y: geom.y,
          width: geom.width,
          height: geom.height,
          attrs: { shapeType: 'line', angle: geom.angle },
          children: [],
        },
      },
    } as unknown as SceneDocument;
    const stroke = strokeEndpointBox(drag, doc, 200, 80, false);
    expect(stroke).toBeTruthy();
    // Callers must publish box+angle together — angle alone would orbit the old center.
    expect(stroke!.angle).not.toBe(geom.angle);
    expect(stroke!.next.width).toBeGreaterThan(1);
  });
});
