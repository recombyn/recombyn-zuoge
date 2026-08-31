import { describe, expect, it } from 'vitest';
import {
  sampleSoaPathPolyline,
  densifySoaPathD,
  pathDLooksClosed,
  SOA_PATH_MAX_PTS,
} from '../soaPathSamples';

describe('soaPathSamples', () => {
  it('parses M/L and respects max pts', () => {
    const pts = sampleSoaPathPolyline('M 0 0 L 10 0 L 20 0 L 30 0');
    expect(pts.length).toBe(4);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[3]).toEqual({ x: 30, y: 0 });

    const dense = Array.from({ length: 200 }, (_, i) => `${i === 0 ? 'M' : 'L'} ${i} 0`).join(' ');
    const capped = sampleSoaPathPolyline(dense, SOA_PATH_MAX_PTS);
    expect(capped.length).toBeLessThanOrEqual(SOA_PATH_MAX_PTS + 4);
    expect(capped[0].x).toBe(0);
  });

  it('densifies cubic Bezier into multiple samples', () => {
    const d = 'M 0 0 C 0 40 40 40 40 0';
    const pts = densifySoaPathD(d, 4);
    expect(pts.length).toBeGreaterThan(3);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    const last = pts[pts.length - 1];
    expect(last.x).toBeCloseTo(40, 5);
    expect(last.y).toBeCloseTo(0, 5);
    // Mid sample should leave the chord (curve bulges in +Y).
    const mid = pts[Math.floor(pts.length / 2)];
    expect(mid.y).toBeGreaterThan(5);
  });

  it('densifies quadratic and relative commands', () => {
    const pts = densifySoaPathD('M 0 0 q 20 40 40 0', 4);
    expect(pts.length).toBeGreaterThan(2);
    expect(pts[pts.length - 1].x).toBeCloseTo(40, 5);
  });

  it('inserts NaN break between subpaths', () => {
    const pts = densifySoaPathD('M 0 0 L 10 0 M 20 20 L 30 20');
    const breakIdx = pts.findIndex((p) => !Number.isFinite(p.x));
    expect(breakIdx).toBeGreaterThan(0);
    expect(pts[breakIdx + 1].x).toBeCloseTo(20, 5);
  });

  it('densifies elliptical arcs (A command)', () => {
    const pts = densifySoaPathD('M 0 50 A 50 50 0 0 1 100 50', 4);
    expect(pts.length).toBeGreaterThan(4);
    expect(pts[0]).toEqual({ x: 0, y: 50 });
    const last = pts[pts.length - 1];
    expect(last.x).toBeCloseTo(100, 0);
    expect(last.y).toBeCloseTo(50, 0);
    const mid = pts[Math.floor(pts.length / 2)];
    // Semicircle above: mid y should drop below 50.
    expect(mid.y).toBeLessThan(45);
  });

  it('detects closed paths', () => {
    expect(pathDLooksClosed('M 0 0 L 10 0 Z', false)).toBe(true);
    expect(pathDLooksClosed('M 0 0 L 10 0', true)).toBe(true);
    expect(pathDLooksClosed('M 0 0 L 10 0', false)).toBe(false);
  });
});
