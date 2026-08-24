import { describe, expect, it } from 'vitest';
import { computeShapeBoolean, type ShapeBox } from '../shapeBoolean';

/** L-shape with notch at bottom-right in local 100×100 box. */
const NOTCH_PATH = 'M0 0L100 0L100 60L60 60L60 100L0 100Z';

function pathBox(
  partial: Partial<ShapeBox> & Pick<ShapeBox, 'left' | 'top' | 'width' | 'height'>,
  attrs: Record<string, unknown> = {}
): ShapeBox {
  return {
    shapeType: 'path',
    path: NOTCH_PATH,
    attrs: { shapeType: 'path', path: NOTCH_PATH, ...attrs },
    ...partial,
  } as ShapeBox;
}

describe('boolean with mirrored operands', () => {
  it('union respects flipX on a mirrored path operand', () => {
    const left = pathBox({ left: 0, top: 0, width: 100, height: 100 });
    const rightMirrored = pathBox(
      { left: 100, top: 0, width: 100, height: 100 },
      { flipX: 'true' }
    );
    const rightUnmirrored = pathBox({ left: 100, top: 0, width: 100, height: 100 });

    const mirrored = computeShapeBoolean([left, rightMirrored], 'union');
    const unmirrored = computeShapeBoolean([left, rightUnmirrored], 'union');

    expect(mirrored.usedFallback).toBe(false);
    expect(unmirrored.usedFallback).toBe(false);
    expect(mirrored.result?.path).toBeTruthy();
    expect(mirrored.result?.path).not.toBe(unmirrored.result?.path);

    // Symmetric arch: inner bottom edge sits near the shared seam (x ≈ 100).
    expect(mirrored.result!.path).toMatch(/100.*100|100.*60/);
    expect(mirrored.result!.width).toBeGreaterThanOrEqual(195);
    expect(mirrored.result!.width).toBeLessThanOrEqual(205);
  });

  it('union respects flipY on a vertically mirrored operand', () => {
    const top = pathBox({ left: 0, top: 0, width: 100, height: 100 });
    const bottomMirrored = pathBox(
      { left: 0, top: 100, width: 100, height: 100 },
      { flipY: 'true' }
    );
    const bottomPlain = pathBox({ left: 0, top: 100, width: 100, height: 100 });

    const mirrored = computeShapeBoolean([top, bottomMirrored], 'union');
    const plain = computeShapeBoolean([top, bottomPlain], 'union');

    expect(mirrored.result?.path).toBeTruthy();
    expect(mirrored.result?.path).not.toBe(plain.result?.path);
  });
});
