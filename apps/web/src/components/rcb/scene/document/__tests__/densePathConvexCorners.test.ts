import { describe, expect, it } from 'vitest';
import {
  parseClosedPathRings,
  sharpCornerIndices,
  sharpCornerSitesForNode,
} from '../sceneRadii';

/** Densified closed teardrop-ish ring (≥24 verts) with intentional concave notches. */
function denseTeardropWithNotches(): string {
  const pts: Array<[number, number]> = [];
  const n = 36;
  for (let i = 0; i < n; i += 1) {
    const t = (i / n) * Math.PI * 2;
    // Cardioid-ish body; every 6th sample pulls inward → concave notch.
    let r = 80 + 35 * Math.cos(t);
    if (i % 6 === 0) r *= 0.72;
    pts.push([120 + Math.cos(t) * r, 100 + Math.sin(t) * r * 0.75]);
  }
  return `M ${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ')} Z`;
}

describe('dense path corner sites after curve/outline densify', () => {
  it('only keeps convex sharp corners on dense rings', () => {
    const d = denseTeardropWithNotches();
    const rings = parseClosedPathRings(d);
    expect(rings.length).toBe(1);
    expect(rings[0].length).toBeGreaterThanOrEqual(24);

    const sharp = sharpCornerIndices(rings[0]);
    // Without convex filter this ring sprouts notch sites; convex-only stays small.
    expect(sharp.length).toBeLessThanOrEqual(12);
    expect(sharp.length).toBeGreaterThan(0);

    const sites = sharpCornerSitesForNode({
      key: 'shape',
      width: 240,
      height: 200,
      attrs: { shapeType: 'path', closed: 'true', path: d },
    });
    expect(sites).toBeTruthy();
    expect(sites!.length).toBe(sharp.length);

    // Convex tips park into the fill — seat at R=0 (+small along) stays near the ring.
    for (const s of sites!) {
      expect(s.x).toBeGreaterThan(-5);
      expect(s.y).toBeGreaterThan(-5);
      expect(s.x).toBeLessThan(250);
      expect(s.y).toBeLessThan(210);
    }
  });

  it('still exposes star-hole valleys on sparse (non-dense) rings', () => {
    // 10-vert star hole — below dense threshold; valleys must remain.
    const outer = 'M 0 0 L 256 0 L 256 211 L 0 211 Z';
    const cx = 128;
    const cy = 105.5;
    const parts: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? 70 : 28;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      parts.push(i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
    }
    parts.push('Z');
    const d = `${outer}${parts.join(' ')}`;
    const hole = parseClosedPathRings(d)[1];
    expect(hole.length).toBeLessThan(24);
    expect(sharpCornerIndices(hole).length).toBeGreaterThanOrEqual(10);
  });
});
