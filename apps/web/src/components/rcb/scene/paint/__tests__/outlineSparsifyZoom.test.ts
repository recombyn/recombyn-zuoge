import { describe, expect, it } from 'vitest';
import { buildOutlinePath } from '../outlineToPath';
import { polylinePathD } from '@/components/rcb/tools/pencilBrushes';

function thickPencilNode(pointCount: number) {
  const pts = Array.from({ length: pointCount }, (_, i) => ({
    x: i * 1.2,
    y: Math.sin(i * 0.35) * 18 + Math.sin(i * 0.11) * 9 + 40,
  }));
  return {
    key: 'shape',
    width: pointCount * 1.2 + 40,
    height: 120,
    attrs: {
      shapeType: 'pencil',
      path: polylinePathD(pts),
      'border-color': '#111',
      'border-width': 28,
      brushStyle: 'vector-ink',
    },
  };
}

describe('pencil outline keeps paint curves (no zoom sparsify shred)', () => {
  it('keeps Q contours at far and near zoom', () => {
    const node = thickPencilNode(160);
    const far = buildOutlinePath(node, { zoom: 0.3 });
    const near = buildOutlinePath(node, { zoom: 4 });
    expect(far?.pathD).toBeTruthy();
    expect(near?.pathD).toBeTruthy();
    expect(far!.pathD.toLowerCase()).toMatch(/q/);
    expect(near!.pathD.toLowerCase()).toMatch(/q/);
  });

  it('does not flatten thick pencil to a sparse M/L digon', () => {
    const node = thickPencilNode(200);
    const out = buildOutlinePath(node, { zoom: 1 });
    expect(out?.pathD).toBeTruthy();
    expect(out!.pathD.toLowerCase()).toMatch(/q/);
    expect(out!.pathD.length).toBeGreaterThan(80);
  });
});
