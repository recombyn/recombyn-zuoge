import { describe, expect, it } from 'vitest';
import { computeShapeBoolean, type ShapeBox } from '../shapeBoolean';

function rectBox(partial: Partial<ShapeBox> & Pick<ShapeBox, 'left' | 'top' | 'width' | 'height'>): ShapeBox {
  return {
    id: 'r',
    shapeType: 'rect',
    fill: '#8B4513',
    stroke: '#333',
    borderWidth: 1,
    attrs: { shapeType: 'rect' },
    ...partial,
  } as ShapeBox;
}

function circleBox(partial: Partial<ShapeBox> & Pick<ShapeBox, 'left' | 'top' | 'width' | 'height'>): ShapeBox {
  return {
    shapeType: 'circle',
    fill: '#fff',
    stroke: '#333',
    borderWidth: 1,
    attrs: { shapeType: 'circle' },
    ...partial,
  } as ShapeBox;
}

function donutBox(partial: Partial<ShapeBox> & Pick<ShapeBox, 'left' | 'top' | 'width' | 'height'>): ShapeBox {
  return circleBox({
    ...partial,
    attrs: { shapeType: 'circle', ellipseInnerRatio: 0.45 },
  });
}

describe('boolean union fill-rule (hub rings)', () => {
  it('union of rect + two solid circles inside does not punch holes', () => {
    const boxes: ShapeBox[] = [
      rectBox({ left: 0, top: 0, width: 400, height: 200 }),
      circleBox({ id: 'c1', left: 40, top: 40, width: 120, height: 120 }),
      circleBox({ id: 'c2', left: 240, top: 40, width: 120, height: 120 }),
    ];
    const { result, usedFallback } = computeShapeBoolean(boxes, 'union');
    expect(usedFallback).toBe(false);
    expect(result).toBeTruthy();
    const subpaths = (result!.path.match(/M/gi) || []).length;
    expect(subpaths).toBe(1);
    expect(result!.fillRule).toBe('nonzero');
  });

  it('union of rect + two donuts inside fills holes (solid merge)', () => {
    const boxes: ShapeBox[] = [
      rectBox({ left: 0, top: 0, width: 400, height: 200 }),
      donutBox({ id: 'd1', left: 40, top: 40, width: 120, height: 120 }),
      donutBox({ id: 'd2', left: 240, top: 40, width: 120, height: 120 }),
    ];
    const { result, usedFallback } = computeShapeBoolean(boxes, 'union');
    expect(usedFallback).toBe(false);
    expect(result).toBeTruthy();
    const subpaths = (result!.path.match(/M/gi) || []).length;
    expect(subpaths).toBe(1);
    expect(result!.fillRule).toBe('nonzero');
  });

  it('union of two side-by-side donuts keeps holes via nested rings', () => {
    const boxes: ShapeBox[] = [
      donutBox({ id: 'd1', left: 0, top: 0, width: 120, height: 120 }),
      donutBox({ id: 'd2', left: 200, top: 0, width: 120, height: 120 }),
    ];
    const { result, usedFallback } = computeShapeBoolean(boxes, 'union');
    expect(usedFallback).toBe(false);
    expect(result).toBeTruthy();
    const subpaths = (result!.path.match(/M/gi) || []).length;
    expect(subpaths).toBeGreaterThanOrEqual(4);
    expect(result!.fillRule).toBe('evenodd');
  });

  it('union of two adjacent solid rects uses nonzero (not evenodd sibling-hole)', () => {
    const boxes: ShapeBox[] = [
      rectBox({ id: 'a', left: 0, top: 0, width: 100, height: 100 }),
      rectBox({ id: 'b', left: 120, top: 0, width: 100, height: 100 }),
    ];
    const { result, usedFallback } = computeShapeBoolean(boxes, 'union');
    expect(usedFallback).toBe(false);
    expect(result).toBeTruthy();
    const subpaths = (result!.path.match(/M/gi) || []).length;
    expect(subpaths).toBe(2);
    expect(result!.fillRule).toBe('nonzero');
  });

  it('exclude rect − two disks matches the Hub hole symptom (evenodd + 3 rings)', () => {
    const boxes: ShapeBox[] = [
      rectBox({ left: 0, top: 0, width: 400, height: 200 }),
      circleBox({ id: 'c1', left: 40, top: 40, width: 120, height: 120 }),
      circleBox({ id: 'c2', left: 240, top: 40, width: 120, height: 120 }),
    ];
    const { result, usedFallback } = computeShapeBoolean(boxes, 'exclude');
    expect(usedFallback).toBe(false);
    expect(result).toBeTruthy();
    expect((result!.path.match(/M/gi) || []).length).toBe(3);
    expect(result!.fillRule).toBe('evenodd');
  });

  it('subtract rect − contained disk keeps nested hole with evenodd', () => {
    const boxes: ShapeBox[] = [
      rectBox({ left: 0, top: 0, width: 400, height: 200 }),
      circleBox({ id: 'c1', left: 140, top: 40, width: 120, height: 120 }),
    ];
    const { result, usedFallback } = computeShapeBoolean(boxes, 'subtract');
    expect(usedFallback).toBe(false);
    expect(result).toBeTruthy();
    expect((result!.path.match(/M/gi) || []).length).toBe(2);
    expect(result!.fillRule).toBe('evenodd');
  });
});
