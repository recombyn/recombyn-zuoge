import { describe, expect, it } from 'vitest';
import { computeShapeBoolean, type ShapeBox } from '../shapeBoolean';

function rectBox(partial: Partial<ShapeBox> & Pick<ShapeBox, 'left' | 'top' | 'width' | 'height'>): ShapeBox {
  return {
    shapeType: 'rect',
    fill: '#fff',
    stroke: '#333',
    borderWidth: 1,
    ...partial,
  } as ShapeBox;
}

function starBox(partial: Partial<ShapeBox> & Pick<ShapeBox, 'left' | 'top' | 'width' | 'height'>): ShapeBox {
  return {
    shapeType: 'star',
    sides: 5,
    attrs: { shapeType: 'star', sides: 5 },
    fill: '#fff',
    stroke: '#333',
    borderWidth: 1,
    ...partial,
  } as ShapeBox;
}

function circleBox(partial: Partial<ShapeBox> & Pick<ShapeBox, 'left' | 'top' | 'width' | 'height'>): ShapeBox {
  return {
    shapeType: 'circle',
    attrs: { shapeType: 'circle' },
    fill: '#fff',
    stroke: '#333',
    borderWidth: 1,
    ...partial,
  } as ShapeBox;
}

describe('boolean with star', () => {
  it('subtracts a five-point star without AABB fallback', () => {
    const boxes: ShapeBox[] = [
      rectBox({ left: 0, top: 0, width: 240, height: 240 }),
      starBox({ left: 40, top: 40, width: 160, height: 160 }),
    ];
    const { result, usedFallback } = computeShapeBoolean(boxes, 'subtract');
    expect(usedFallback).toBe(false);
    expect(result?.path).toBeTruthy();
    const cmds = (result!.path.match(/[ML]/gi) || []).length;
    expect(cmds).toBeGreaterThan(8);
    expect(result!.path.toLowerCase()).not.toMatch(/^m0 0h240v240h-240zm/);
  });

  it('unions rect + star without fallback warning path', () => {
    const boxes: ShapeBox[] = [
      rectBox({ left: 0, top: 0, width: 120, height: 120 }),
      starBox({ left: 60, top: 60, width: 120, height: 120 }),
    ];
    const { result, usedFallback } = computeShapeBoolean(boxes, 'union');
    expect(usedFallback).toBe(false);
    expect(result?.path).toBeTruthy();
  });

  it('subtracts star-first without AABB fallback (self-intersecting subject)', () => {
    const boxes: ShapeBox[] = [
      starBox({ left: 52, top: 68, width: 70, height: 70 }),
      rectBox({ left: 0, top: 0, width: 174, height: 140 }),
    ];
    const { result, usedFallback } = computeShapeBoolean(boxes, 'subtract');
    // Area order punches star from rect — keep a star-shaped hole, not AABB soup.
    expect(usedFallback).toBe(false);
    expect(result?.path).toBeTruthy();
    const cmds = (result!.path.match(/[ML]/gi) || []).length;
    expect(cmds).toBeGreaterThan(8);
  });

  it('subtracts star-first with partial overlap without AABB fallback', () => {
    const boxes: ShapeBox[] = [
      starBox({ left: 100, top: 40, width: 100, height: 100 }),
      rectBox({ left: 0, top: 0, width: 140, height: 140 }),
    ];
    const { result, usedFallback } = computeShapeBoolean(boxes, 'subtract');
    expect(usedFallback).toBe(false);
    expect(result?.path).toBeTruthy();
    const cmds = (result!.path.match(/[ML]/gi) || []).length;
    expect(cmds).toBeGreaterThan(4);
  });

  it('subtracts a star near the bottom of the rect without AABB fallback', () => {
    const boxes: ShapeBox[] = [
      rectBox({ left: 0, top: 0, width: 174, height: 140 }),
      starBox({ left: 52, top: 68, width: 70, height: 70 }),
    ];
    const { result, usedFallback } = computeShapeBoolean(boxes, 'subtract');
    expect(usedFallback).toBe(false);
    expect(result?.path).toBeTruthy();
    const cmds = (result!.path.match(/[ML]/gi) || []).length;
    expect(cmds).toBeGreaterThan(8);
  });
});

describe('boolean circle crescent arcs', () => {
  it('keeps a dense rim after circle−circle subtract (not a few chords)', () => {
    const boxes: ShapeBox[] = [
      circleBox({ left: 0, top: 0, width: 80, height: 80 }),
      circleBox({ left: 28, top: 8, width: 72, height: 72 }),
    ];
    const { result, usedFallback } = computeShapeBoolean(boxes, 'subtract');
    expect(usedFallback).toBe(false);
    expect(result?.path).toBeTruthy();
    const verts = (result!.path.match(/[ML]/gi) || []).length;
    // Dense rim — previous budgets still looked faceted on crescents.
    expect(verts).toBeGreaterThan(80);
  });

  it('keeps donut holes on ring−ring subtract (not a solid crescent)', () => {
    const donut = (left: number, top: number): ShapeBox =>
      circleBox({
        left,
        top,
        width: 200,
        height: 200,
        attrs: { shapeType: 'circle', ellipseInnerRatio: 0.45 },
      });
    const boxes: ShapeBox[] = [donut(0, 0), donut(70, 40)];
    const { result, usedFallback } = computeShapeBoolean(boxes, 'subtract');
    expect(usedFallback).toBe(false);
    expect(result?.path).toBeTruthy();
    // Solid disks → one crescent subpath; donuts keep ring topology → multiple M…Z.
    // polygon-clipping often emits donut−donut as sibling solid rings (no nested
    // hole), so fillRule may be nonzero — evenodd is not required for the look.
    const subpaths = (result!.path.match(/M/gi) || []).length;
    expect(subpaths).toBeGreaterThanOrEqual(2);
  });

  it('subtracts rounded rects without collapsing to a sharp AABB L', () => {
    const boxes: ShapeBox[] = [
      rectBox({
        left: 0,
        top: 0,
        width: 200,
        height: 160,
        attrs: { shapeType: 'rect', cornerRadius: 24 },
      }),
      rectBox({
        left: 70,
        top: 50,
        width: 160,
        height: 140,
        attrs: { shapeType: 'rect', cornerRadius: 24 },
      }),
    ];
    const { result, usedFallback } = computeShapeBoolean(boxes, 'subtract');
    expect(usedFallback).toBe(false);
    expect(result?.path).toBeTruthy();
    const verts = (result!.path.match(/[ML]/gi) || []).length;
    // Sharp AABB L is ~6 verts; rounded boolean keeps many samples on arcs.
    expect(verts).toBeGreaterThan(12);
  });
});
