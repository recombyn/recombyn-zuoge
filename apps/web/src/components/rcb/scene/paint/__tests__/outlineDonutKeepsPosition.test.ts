import { describe, expect, it } from 'vitest';
import {
  buildOutlinePath,
  outlineNodePatch,
  pathDBounds,
} from '../outlineToPath';

describe('donut / arc circle outline keeps scene box', () => {
  it('does not shift selection box after outlining a ring with arc commands', () => {
    const node = {
      key: 'shape' as const,
      x: 120,
      y: 80,
      width: 320,
      height: 280,
      attrs: {
        shapeType: 'circle',
        ellipseInnerRatio: 0.55,
        ellipseArcPercent: 92,
        'fill-color': '#ffffff',
      },
    };
    const outline = buildOutlinePath(node, { zoom: 1 });
    expect(outline?.pathD).toBeTruthy();
    expect(outline?.pathD).toMatch(/A\s/i);

    const patch = outlineNodePatch(node, outline!);
    expect(patch.x).toBe(node.x);
    expect(patch.y).toBe(node.y);
    expect(patch.width).toBe(node.width);
    expect(patch.height).toBe(node.height);
    expect(patch.attrs['fill-rule']).toBe('evenodd');

    const localBb = pathDBounds(String(patch.attrs.path));
    expect(localBb).toBeTruthy();
    // Partial arcs do not fill the whole node box — only ensure ink stays inside it.
    expect(localBb!.minX).toBeGreaterThanOrEqual(-1);
    expect(localBb!.minY).toBeGreaterThanOrEqual(-1);
    expect(localBb!.minX + localBb!.width).toBeLessThanOrEqual(node.width + 2);
    expect(localBb!.minY + localBb!.height).toBeLessThanOrEqual(node.height + 2);
  });

  it('keeps full donut ring aligned when inner hole uses cubic subpaths', () => {
    const node = {
      key: 'shape' as const,
      x: 40,
      y: 60,
      width: 200,
      height: 200,
      attrs: {
        shapeType: 'circle',
        ellipseInnerRatio: 0.4,
        ellipseArcPercent: 100,
        'fill-color': '#eeeeee',
      },
    };
    const outline = buildOutlinePath(node, { zoom: 1 });
    expect(outline?.pathD).toBeTruthy();

    const patch = outlineNodePatch(node, outline!);
    expect(patch.x).toBe(node.x);
    expect(patch.y).toBe(node.y);
    expect(patch.width).toBe(node.width);
    expect(patch.height).toBe(node.height);
  });
});
