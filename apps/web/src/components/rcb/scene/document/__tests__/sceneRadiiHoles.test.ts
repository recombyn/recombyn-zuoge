import { describe, expect, it } from 'vitest';
import {
  filletPathD,
  parseClosedPathRings,
  primaryClosedPathRingIndex,
  roundedPolygonPath,
  sharpCornerIndices,
  sharpCornerSitesForNode,
} from '../sceneRadii';

/** Outer rect + dense scalloped hole (boolean subtract-style compound path). */
function compoundRectWithScallopedHole(): string {
  const outer = 'M 0 0 L 200 0 L 200 160 L 0 160 Z';
  const cx = 100;
  const cy = 80;
  const r = 36;
  const bumps = 24;
  const parts: string[] = [];
  for (let i = 0; i < bumps; i += 1) {
    const a = (i / bumps) * Math.PI * 2;
    const rr = r + (i % 2 === 0 ? 6 : 0);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    parts.push(i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
  }
  parts.push('Z');
  return `${outer}${parts.join(' ')}`;
}

/** Sharp rect outer + 5-point star hole (boolean-style). */
function compoundRectWithStarHole(): string {
  const outer = 'M 0 0 L 256 0 L 256 211 L 0 211 Z';
  const cx = 128;
  const cy = 105.5;
  const ro = 70;
  const ri = 28;
  const pts: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? ro : ri;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    pts.push(i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
  }
  pts.push('Z');
  return `${outer}${pts.join(' ')}`;
}

describe('compound path corner fillet', () => {
  it('picks the largest-area ring as primary (not densest hole)', () => {
    const rings = parseClosedPathRings(compoundRectWithScallopedHole());
    expect(rings.length).toBe(2);
    expect(rings[1].length).toBeGreaterThan(rings[0].length);
    expect(primaryClosedPathRingIndex(rings)).toBe(0);
  });

  it('fillets exterior and hole when linked R is set', () => {
    const d = compoundRectWithScallopedHole();
    const before = parseClosedPathRings(d);
    const holeBefore = before[1];
    const holeCanon = `M ${holeBefore.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`;
    const filleted = filletPathD(
      d,
      { tl: 20, tr: 20, br: 20, bl: 20 },
      { radiusLinked: 'true', radiusTL: 20, radiusTR: 20, radiusBR: 20, radiusBL: 20 }
    );
    expect(filleted).not.toBe(d);
    expect(filleted.toLowerCase()).toContain('a ');
    // Dense scalloped hole may keep most verts; linked R still rewrites the hole ring.
    expect(filleted).not.toContain(holeCanon);
  });

  it('path hole corners expose maxR from hole edges, not outer AABB', () => {
    // Outer 400×200 stadium-ish rect; small 80×40 hole — hole half-min is 20.
    const d =
      'M 0 0 L 400 0 L 400 200 L 0 200 Z' +
      'M 160 80 L 240 80 L 240 120 L 160 120 Z';
    const sites = sharpCornerSitesForNode({
      key: 'shape',
      width: 400,
      height: 200,
      attrs: { shapeType: 'path', closed: 'true', path: d },
    });
    expect(sites).toBeTruthy();
    const boxHalf = Math.min(400, 200) / 2; // 100
    const holeSites = sites!.filter((s) => s.x >= 160 && s.x <= 240 && s.y >= 80 && s.y <= 120);
    expect(holeSites.length).toBe(4);
    for (const s of holeSites) {
      expect(s.maxR).toBeGreaterThan(0);
      // Alone: min(edge)×tan(α/2) = 40 on the short side; AABB half is 100.
      expect(s.maxR).toBeLessThanOrEqual(40 + 1e-6);
      expect(s.maxR).toBeLessThan(boxHalf);
    }
    const outer = sites!.find((s) => s.x === 0 && s.y === 0);
    expect(outer?.maxR).toBeGreaterThan(50);
  });

  it('keeps notch-mouth R sites on the AABB edge (short boolean stubs)', () => {
    // Rect with a right-side bay; collinear micro-verts on the flush edge used
    // to make mouth folds fail the short-edge filter (missing R-dots).
    const ring: Array<[number, number]> = [
      [0, 0],
      [427, 0],
      [427, 40],
      [427, 78],
      [427, 80], // mouth top
      [300, 100],
      [260, 200],
      [310, 300],
      [427, 350], // mouth bottom
      [427, 355],
      [427, 390],
      [427, 411],
      [0, 411],
    ];
    const sharp = sharpCornerIndices(ring);
    expect(sharp).toContain(4); // mouth top
    expect(sharp).toContain(8); // mouth bottom
    expect(sharp).toContain(0); // TL
    expect(sharp).toContain(1); // TR
    expect(sharp).toContain(11); // BR
    expect(sharp).toContain(12); // BL

    const d = `M ${ring.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`;
    const sites = sharpCornerSitesForNode({
      key: 'shape',
      width: 427,
      height: 411,
      attrs: { shapeType: 'path', closed: 'true', path: d },
    });
    expect(sites).toBeTruthy();
    const rightMouth = sites!.filter((s) => Math.abs(s.x - 427) < 0.5 && s.y > 50 && s.y < 380);
    expect(rightMouth.length).toBeGreaterThanOrEqual(2);
  });

  it('exposes R sites on outer corners and star hole folds', () => {
    const d = compoundRectWithStarHole();
    const rings = parseClosedPathRings(d);
    expect(rings.length).toBe(2);
    const outerSharp = sharpCornerIndices(rings[0]);
    const holeSharp = sharpCornerIndices(rings[1]);
    expect(outerSharp.length).toBe(4);
    expect(holeSharp.length).toBeGreaterThanOrEqual(10);

    const sites = sharpCornerSitesForNode({
      key: 'shape',
      width: 256,
      height: 211,
      attrs: { shapeType: 'path', closed: 'true', path: d },
    });
    expect(sites).toBeTruthy();
    // 4 outer + star tips/valleys
    expect(sites!.length).toBe(outerSharp.length + holeSharp.length);
    expect(sites!.length).toBeGreaterThan(4);
  });

  it('star-hole tips park inward; valleys park into the exterior notch', () => {
    const d = compoundRectWithStarHole();
    const rings = parseClosedPathRings(d);
    const hole = rings[1];
    let cx = 0;
    let cy = 0;
    for (const [x, y] of hole) {
      cx += x;
      cy += y;
    }
    cx /= hole.length;
    cy /= hole.length;

    const sites = sharpCornerSitesForNode({
      key: 'shape',
      width: 256,
      height: 211,
      attrs: { shapeType: 'path', closed: 'true', path: d },
    });
    const holeSites = sites!.slice(4); // primary rect first
    expect(holeSites.length).toBeGreaterThan(0);
    // Star hole: tips (far from center) park inward; valleys park outward into the notch.
    const byDist = [...holeSites].sort(
      (a, b) => Math.hypot(b.x - cx, b.y - cy) - Math.hypot(a.x - cx, a.y - cy)
    );
    const tip = byDist[0];
    const valley = byDist[byDist.length - 1];
    const tipAfter = Math.hypot(tip.x + tip.ix * 4 - cx, tip.y + tip.iy * 4 - cy);
    const tipBefore = Math.hypot(tip.x - cx, tip.y - cy);
    expect(tipAfter).toBeLessThan(tipBefore);
    const valleyAfter = Math.hypot(
      valley.x + valley.ix * 4 - cx,
      valley.y + valley.iy * 4 - cy
    );
    const valleyBefore = Math.hypot(valley.x - cx, valley.y - cy);
    expect(valleyAfter).toBeGreaterThan(valleyBefore);
  });
});

describe('roundedPolygonPath tangent fillets', () => {
  it('uses r/tan(α/2) offsets so non-90° corners stay tangent (no bulge)', () => {
    // Isosceles 60° tip at (0,0), base wide enough for R=10.
    const r = 10;
    const deg = 60;
    const a = (deg * Math.PI) / 180;
    const points: Array<[number, number]> = [
      [80, 0],
      [0, 0],
      [80 * Math.cos(a), 80 * Math.sin(a)],
    ];
    // Force-fillet only the tip (index 1); leave base sharp via 0 radii.
    // sharpCornerIndices may keep all three — set radii explicitly.
    const d = roundedPolygonPath(points, [0, r, 0]);
    expect(d).toMatch(/A /i);
    const off = r / Math.tan(a / 2);
    // Arc endpoints must lie at `off` along each edge from the tip.
    const m = d.match(
      /L\s+([-\d.eE]+)\s+([-\d.eE]+)\s+A\s+([\d.eE]+)\s+([\d.eE]+)\s+\d\s+\d\s+\d\s+([-\d.eE]+)\s+([-\d.eE]+)/
    );
    expect(m).toBeTruthy();
    const p1x = Number(m![1]);
    const p1y = Number(m![2]);
    const arcR = Number(m![3]);
    const p2x = Number(m![5]);
    const p2y = Number(m![6]);
    expect(arcR).toBeCloseTo(r, 6);
    expect(Math.hypot(p1x - 0, p1y - 0)).toBeCloseTo(off, 5);
    expect(Math.hypot(p2x - 0, p2y - 0)).toBeCloseTo(off, 5);
    // Fillet center along the angle bisector at r/sin(α/2) from the tip.
    const bisX = Math.cos(a / 2);
    const bisY = Math.sin(a / 2);
    const distC = r / Math.sin(a / 2);
    const cx = bisX * distC;
    const cy = bisY * distC;
    expect(Math.hypot(p1x - cx, p1y - cy)).toBeCloseTo(r, 5);
    expect(Math.hypot(p2x - cx, p2y - cy)).toBeCloseTo(r, 5);
  });

  it('keeps offset=r for square corners (90°)', () => {
    const r = 12;
    const points: Array<[number, number]> = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const d = roundedPolygonPath(points, r);
    // First arc starts after M at (r, 0) for TL going toward top edge… winding:
    // at (0,0): prev=(0,100), next=(100,0) → offset along +y and +x by r.
    expect(d.startsWith(`M 0 ${r}`) || d.includes(`A ${r} ${r}`)).toBe(true);
    expect(d).toContain(`A ${r} ${r}`);
  });
});
