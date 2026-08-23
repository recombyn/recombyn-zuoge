import { describe, expect, it } from 'vitest';
import { buildOutlinePath, pathDBounds } from '../outlineToPath';

describe('pen outline keeps miter tips', () => {
  it('keeps acute tips without beveling (延用 miter)', () => {
    const tipY = 10;
    const sw = 16;
    const half = sw / 2;
    const node = {
      key: 'shape' as const,
      x: 0,
      y: 0,
      width: 120,
      height: 100,
      attrs: {
        shapeType: 'pen',
        // Very acute tip — SVG default miterlimit 4 would bevel; we keep miter.
        path: `M 10 90 L 55 ${tipY} L 100 90`,
        'border-width': sw,
        'border-color': '#111',
        strokeLinejoin: 'miter',
      },
    };
    const out = buildOutlinePath(node, { zoom: 1 });
    expect(out?.pathD).toBeTruthy();
    const bb = pathDBounds(out!.pathD);
    expect(bb).toBeTruthy();
    // Sharp miter extends well past the centerline tip.
    expect(bb!.minY).toBeLessThan(tipY - half * 0.8);
  });

  it('closed path keeps miter at Z closure (not butt-cap notch)', () => {
    const tipY = 10;
    const sw = 16;
    const half = sw / 2;
    const node = {
      key: 'shape' as const,
      x: 0,
      y: 0,
      width: 120,
      height: 100,
      attrs: {
        shapeType: 'pen',
        // Closure vertex is the acute tip — must join like mid-path miters.
        path: `M 55 ${tipY} L 100 90 L 10 90 Z`,
        'border-width': sw,
        'border-color': '#111',
        strokeLinejoin: 'miter',
      },
    };
    const out = buildOutlinePath(node, { zoom: 1 });
    expect(out?.pathD).toBeTruthy();
    expect(out!.fillRule).toBe('evenodd');
    // Two rings (outer + inner hole).
    expect((out!.pathD.match(/Z/gi) || []).length).toBeGreaterThanOrEqual(2);
    const bb = pathDBounds(out!.pathD);
    expect(bb).toBeTruthy();
    expect(bb!.minY).toBeLessThan(tipY - half * 0.8);
  });
});
