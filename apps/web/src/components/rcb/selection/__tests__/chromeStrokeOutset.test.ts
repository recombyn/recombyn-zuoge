import { describe, expect, it } from 'vitest';
import {
  deflateSelectionBox,
  inflateSelectionBox,
  inflateBoxByVisualOutset,
  strokeChromeOutset,
  strokeVisualOutset,
  geometryPatchForStrokeVisibilityToggle,
  geometryPatchForStrokeOutsetChange,
} from '../../scene/document/sceneEffects';

/**
 * Control box follows stored geometry, the same lattice used by resize commits.
 * Painted stroke can extend beyond it but must never move resize anchors.
 */
describe('selection chrome vs stroke (AABB on stored geometry)', () => {
  const centerStroke = (sw: number) => ({
    key: 'shape',
    attrs: {
      shapeType: 'polygon',
      'border-width': sw,
      'border-color': '#333',
      strokeAlign: 'center',
      'stroke-enabled': 'true',
      'stroke-visible': 'true',
    },
  });

  it('1px center stroke: chrome stays on stored geometry', () => {
    const node = centerStroke(1);
    const path = { left: 10.5, top: 20.5, width: 4, height: 3 };
    const chrome = inflateSelectionBox(path, node);
    const visual = inflateBoxByVisualOutset(path, node);

    expect(strokeChromeOutset(node)).toBe(0);
    expect(strokeVisualOutset(node)).toBe(0.5);
    expect(chrome).toEqual(path);
    expect(visual).toEqual({ left: 10, top: 20, width: 5, height: 4 });
    expect(deflateSelectionBox(chrome, node)).toEqual(path);
  });

  it('thick center stroke does not move resize anchors', () => {
    const node = centerStroke(2);
    const path = { left: 10, top: 10, width: 4, height: 3 };
    const chrome = inflateSelectionBox(path, node);
    expect(strokeChromeOutset(node)).toBe(0);
    expect(chrome).toEqual(path);
    const rotateFrom = {
      nw: { x: chrome.left, y: chrome.top },
      se: { x: chrome.left + chrome.width, y: chrome.top + chrome.height },
    };
    expect(rotateFrom.nw.x).toBe(10);
    expect(rotateFrom.se.x).toBe(14);
  });

  it('outside stroke does not pad control geometry', () => {
    const node = {
      key: 'shape',
      attrs: {
        shapeType: 'rect',
        'border-width': 2,
        'border-color': '#333',
        strokeAlign: 'outside',
        'stroke-enabled': 'true',
        'stroke-visible': 'true',
        'fill-color': '#fff',
      },
    };
    const path = { left: 10, top: 10, width: 8, height: 6 };
    const chrome = inflateSelectionBox(path, node);
    const visual = inflateBoxByVisualOutset(path, node);
    expect(strokeChromeOutset(node)).toBe(0);
    expect(chrome).toEqual(path);
    expect(visual).toEqual({ left: 8, top: 8, width: 12, height: 10 });
  });

  it('inside stroke: chrome stays on path (outset 0)', () => {
    const node = {
      key: 'shape',
      attrs: {
        shapeType: 'rect',
        'border-width': 4,
        'border-color': '#333',
        strokeAlign: 'inside',
        'stroke-enabled': 'true',
        'stroke-visible': 'true',
        'fill-color': '#fff',
      },
    };
    const path = { left: 10, top: 10, width: 8, height: 6 };
    const chrome = inflateSelectionBox(path, node);
    expect(strokeChromeOutset(node)).toBe(0);
    expect(chrome).toEqual(path);
  });

  it('polygon knobs + AABB both deflate back to path geom', () => {
    const node = centerStroke(1);
    const path = { left: 10.5, top: 20.5, width: 4, height: 3 };
    const chrome = inflateSelectionBox(path, node);
    const geomForPolygonKnobs = deflateSelectionBox(chrome, node);
    expect(geomForPolygonKnobs).toEqual(path);
    expect(chrome).toEqual(path);
  });
});

describe('geometryPatchForStrokeVisibilityToggle', () => {
  const rectCenter1 = {
    key: 'shape',
    x: 10.5,
    y: 8.5,
    width: 42,
    height: 31,
    attrs: {
      shapeType: 'rect',
      'border-width': 1,
      'border-color': '#333',
      strokeAlign: 'center',
      'stroke-enabled': 'true',
      'stroke-visible': 'true',
      'fill-color': '#fff',
    },
  };

  it('hide 1px center stroke expands fill to prior outer ink (on grid)', () => {
    const patch = geometryPatchForStrokeVisibilityToggle(rectCenter1, false);
    expect(patch).toEqual({ x: 10, y: 8, width: 43, height: 32 });
    const hidden = {
      ...rectCenter1,
      ...patch,
      attrs: { ...rectCenter1.attrs, 'stroke-enabled': 'false', 'stroke-visible': 'false' },
    };
    expect(strokeVisualOutset(hidden)).toBe(0);
    expect(hidden.x).toBe(10);
    expect(hidden.y).toBe(8);
  });

  it('show stroke again insets back to path *.5', () => {
    const expanded = {
      ...rectCenter1,
      x: 10,
      y: 8,
      width: 43,
      height: 32,
      attrs: { ...rectCenter1.attrs, 'stroke-enabled': 'false', 'stroke-visible': 'false' },
    };
    const patch = geometryPatchForStrokeVisibilityToggle(expanded, true);
    expect(patch).toEqual({ x: 10.5, y: 8.5, width: 42, height: 31 });
  });

  it('inside stroke: no geom change (outset 0)', () => {
    const node = {
      ...rectCenter1,
      attrs: { ...rectCenter1.attrs, strokeAlign: 'inside' },
    };
    expect(geometryPatchForStrokeVisibilityToggle(node, false)).toBeNull();
  });

  it('custom path d: skip (AABB alone cannot offset the curve)', () => {
    const node = {
      ...rectCenter1,
      attrs: { ...rectCenter1.attrs, shapeType: 'path', path: 'M0 0 L10 0 L10 10 Z', closed: 'true' },
    };
    expect(geometryPatchForStrokeVisibilityToggle(node, false)).toBeNull();
  });
});

describe('geometryPatchForStrokeOutsetChange', () => {
  const rectCenter1 = {
    key: 'shape',
    x: 10.5,
    y: 8.5,
    width: 42,
    height: 31,
    attrs: {
      shapeType: 'rect',
      'border-width': 1,
      'border-color': '#333',
      strokeAlign: 'center',
      'stroke-enabled': 'true',
      'stroke-visible': 'true',
      'fill-color': '#fff',
    },
  };

  it('thicker center stroke insets path so outer ink stays on grid', () => {
    const outer0 = inflateBoxByVisualOutset(
      { left: rectCenter1.x, top: rectCenter1.y, width: rectCenter1.width, height: rectCenter1.height },
      rectCenter1
    );
    expect(outer0.left).toBe(10);

    const patch = geometryPatchForStrokeOutsetChange(rectCenter1, { 'border-width': 3 });
    expect(patch).toEqual({ x: 11.5, y: 9.5, width: 40, height: 29 });
    const next = {
      ...rectCenter1,
      ...patch,
      attrs: { ...rectCenter1.attrs, 'border-width': 3 },
    };
    const outer1 = inflateBoxByVisualOutset(
      { left: next.x, top: next.y, width: next.width, height: next.height },
      next
    );
    expect(outer1.left).toBe(10);
    expect(outer1.top).toBe(8);
    expect(outer1.width).toBe(43);
    expect(outer1.height).toBe(32);
  });
});
