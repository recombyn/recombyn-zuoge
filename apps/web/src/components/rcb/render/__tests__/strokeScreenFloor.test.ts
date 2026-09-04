import { describe, expect, it } from 'vitest';
import {
  adaptivePathStrokeMaxSegs,
  floorContentStrokeSceneWidth,
} from '../strokeScreenFloor';

describe('floorContentStrokeSceneWidth', () => {
  it('keeps geometric width when already ≥ 1 CSS px on screen', () => {
    expect(floorContentStrokeSceneWidth(2, 1)).toBe(2);
    expect(floorContentStrokeSceneWidth(2, 2)).toBe(2);
  });

  it('floors so sw * zoom ≥ 1 CSS px when zoomed out', () => {
    expect(floorContentStrokeSceneWidth(2, 0.25)).toBe(4);
    expect(floorContentStrokeSceneWidth(1, 0.1)).toBe(10);
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
