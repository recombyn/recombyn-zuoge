import { describe, expect, it } from 'vitest';
import {
  FRAME_HIGHLIGHT_STROKE,
  FRAME_PLATE_STROKE,
  applyArtboardPlateEdgeStroke,
  framePlateStrokeSceneWidth,
} from '../types';

describe('applyArtboardPlateEdgeStroke', () => {
  it('uses scene width 1/zoom so CSS camera scale yields a 1px hairline', () => {
    const edge = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    applyArtboardPlateEdgeStroke(edge, {
      selected: false,
      highlighted: false,
      zoom: 8,
      width: 400,
      height: 300,
    });
    const sw = framePlateStrokeSceneWidth(8);
    expect(Number(edge.getAttribute('stroke-width'))).toBeCloseTo(sw, 10);
    expect(sw * 8).toBeCloseTo(1, 10);
    expect(edge.getAttribute('stroke')).toBe(FRAME_PLATE_STROKE);
    expect(Number(edge.getAttribute('x'))).toBeCloseTo(sw / 2, 10);
    expect(Number(edge.getAttribute('width'))).toBeCloseTo(400 - sw, 10);
  });

  it('clears stroke when selected (SelectionChrome owns the box)', () => {
    const edge = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    applyArtboardPlateEdgeStroke(edge, {
      selected: true,
      highlighted: false,
      zoom: 2,
      width: 100,
      height: 80,
    });
    expect(edge.getAttribute('stroke')).toBe('none');
    expect(edge.getAttribute('x')).toBe('0');
    expect(edge.getAttribute('width')).toBe('100');
  });

  it('uses highlight blue when soft-focused', () => {
    const edge = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    applyArtboardPlateEdgeStroke(edge, {
      selected: false,
      highlighted: true,
      zoom: 1,
      width: 50,
      height: 50,
    });
    expect(edge.getAttribute('stroke')).toBe(FRAME_HIGHLIGHT_STROKE);
  });
});
