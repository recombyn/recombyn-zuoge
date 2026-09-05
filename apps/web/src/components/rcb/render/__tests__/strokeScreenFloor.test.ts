import { describe, expect, it } from 'vitest';
import {
  adaptivePathStrokeMaxSegs,
  floorContentStrokeSceneWidth,
} from '../strokeScreenFloor';

describe('floorContentStrokeSceneWidth', () => {
  it('keeps geometric width at any zoom (no hairline floor)', () => {
    expect(floorContentStrokeSceneWidth(2, 1)).toBe(2);
    expect(floorContentStrokeSceneWidth(2, 2)).toBe(2);
    expect(floorContentStrokeSceneWidth(2, 0.25)).toBe(2);
    expect(floorContentStrokeSceneWidth(1, 0.1)).toBe(1);
    expect(floorContentStrokeSceneWidth(1, 0.77)).toBe(1);
  });

  it('still honors an explicit minCssPx when callers opt in', () => {
    expect(floorContentStrokeSceneWidth(2, 0.25, 1)).toBe(4);
    expect(floorContentStrokeSceneWidth(1, 0.1, 1)).toBe(10);
  });

  it('returns 0 for missing stroke', () => {
    expect(floorContentStrokeSceneWidth(0, 0.2)).toBe(0);
    expect(floorContentStrokeSceneWidth(-1, 0.2)).toBe(0);
  });
});

describe('adaptivePathStrokeMaxSegs', () => {
  it('keeps full cap near 1× zoom', () => {
    expect(adaptivePathStrokeMaxSegs(1, 96)).toBe(96);
    expect(adaptivePathStrokeMaxSegs(0.8, 96)).toBe(96);
  });

  it('reduces segments when zoomed out', () => {
    expect(adaptivePathStrokeMaxSegs(0.5, 96)).toBeLessThan(96);
    expect(adaptivePathStrokeMaxSegs(0.15, 96)).toBeLessThanOrEqual(24);
  });
});