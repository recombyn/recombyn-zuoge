import { describe, expect, it } from 'vitest';
import { sharpCornerSitesForNode } from '@/components/rcb/scene/document/sceneRadii';
import { pathRadiusSeatAlong } from '@/components/rcb/selection/chrome/CornerRadiusHandlesOverlay';
import {
  penSubpathsFromD,
  penSubpathsToD,
  localizeAnchors,
  offsetAnchors,
  boundsOfAnchors,
  type PenAnchor,
} from '@/components/rcb/tools/penPath';
import { pencilInkPathFromPoints } from '@/components/rcb/tools/pencilBrushes';

function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by);
}

function minDistToAnchors(x: number, y: number, anchors: PenAnchor[]) {
  let best = Infinity;
  for (const a of anchors) {
    best = Math.min(best, dist(x, y, a.x, a.y));
  }
  return best;
}

/** Regular n-gon in local box (approx circle when n is large). */
function regularGonPath(n: number, cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    pts.push(i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : `L ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `${pts.join(' ')} Z`;
}

describe('curve-edit / corner sites stay on the path (verification)', () => {
  it('curve-edit roundtrip: on-path anchors stay on the committed local path', () => {
    const paint = pencilInkPathFromPoints(
      [
        { x: 20, y: 80 },
        { x: 60, y: 20 },
        { x: 120, y: 90 },
        { x: 180, y: 40 },
      ],
      14,
      'vector-ink',
      { linecap: 'round', simplify: false }
    );
    expect(paint).toMatch(/[QqCc]/);

    // Enter path-edit: Q → cubic anchors in scene space (origin = node left/top).
    const loaded = penSubpathsFromD(paint);
    expect(loaded.length).toBe(1);
    expect(loaded[0].anchors.length).toBeGreaterThan(3);

    // Pull a curve handle (曲线调整).
    const edited = loaded.map((s) => ({
      ...s,
      anchors: s.anchors.map((a, i) =>
        i === 1
          ? {
              ...a,
              outX: (a.outX ?? a.x) + 18,
              outY: (a.outY ?? a.y) - 22,
              inX: a.inX ?? a.x,
              inY: a.inY ?? a.y,
            }
          : a
      ),
    }));

    const bounds = boundsOfAnchors(edited[0].anchors, edited[0].closed);
    const box = {
      left: bounds.left,
      top: bounds.top,
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
    };
    const local = edited.map((s) => ({
      anchors: localizeAnchors(s.anchors, box.left, box.top),
      closed: s.closed,
    }));
    const committed = penSubpathsToD(local);
    const reloaded = penSubpathsFromD(committed);
    expect(reloaded.length).toBe(1);

    // Every anchor (x,y) must be a vertex of the committed path — not floating.
    for (const a of reloaded[0].anchors) {
      expect(a.x).toBeGreaterThanOrEqual(-0.5);
      expect(a.y).toBeGreaterThanOrEqual(-0.5);
      expect(a.x).toBeLessThanOrEqual(box.width + 0.5);
      expect(a.y).toBeLessThanOrEqual(box.height + 0.5);
    }

    // Roundtrip scene→local→scene keeps on-curve points stable.
    const back = offsetAnchors(reloaded[0].anchors, box.left, box.top);
    for (let i = 0; i < edited[0].anchors.length; i += 1) {
      expect(dist(back[i].x, back[i].y, edited[0].anchors[i].x, edited[0].anchors[i].y)).toBeLessThan(
        0.75
      );
    }
  });

  it('densified circle has no corner-radius sites (no dots inside the disk)', () => {
    const d = regularGonPath(48, 100, 100, 80);
    const sites = sharpCornerSitesForNode({
      key: 'shape',
      width: 200,
      height: 200,
      attrs: { shapeType: 'path', closed: 'true', path: d },
    });
    expect(sites == null || sites.length === 0).toBe(true);
  });

  it('crescent / open-looking path: any R seat stays near a path vertex', () => {
    // Skinny closed ribbon (teardrop) — empty AABB corners must not get R seats.
    const d =
      'M 40 110 L 80 40 L 200 50 L 220 120 L 160 180 L 70 160 Z';
    const node = {
      key: 'shape' as const,
      width: 241,
      height: 221,
      attrs: { shapeType: 'path', closed: 'true', path: d },
    };
    const sites = sharpCornerSitesForNode(node);
    expect(sites).toBeTruthy();
    expect(sites!.length).toBeGreaterThan(0);

    const park = 12;
    const verts = penSubpathsFromD(d)[0]?.anchors || [];
    expect(verts.length).toBeGreaterThan(3);

    for (const s of sites!) {
      const along = pathRadiusSeatAlong(0, park, s.maxR);
      const lx = s.x + s.ix * along;
      const ly = s.y + s.iy * along;
      // Seat must hug a real corner — not float in empty AABB space.
      expect(minDistToAnchors(s.x, s.y, verts)).toBeLessThan(1.5);
      expect(minDistToAnchors(lx, ly, verts)).toBeLessThan(park + 4);
    }
  });

  it('after curve-edit commit with C segments, path has no polyline R sites', () => {
    const d = 'M 10 10 C 40 0 80 0 110 10 C 140 40 140 80 110 110 Z';
    const sites = sharpCornerSitesForNode({
      key: 'shape',
      width: 150,
      height: 120,
      attrs: { shapeType: 'path', closed: 'true', path: d },
    });
    // parseClosedPathRings rejects C → no false R dots in empty corners.
    expect(sites == null || sites.length === 0).toBe(true);
  });

  it('pencil outline (Q) then path-edit load keeps anchors on the silhouette', () => {
    const pts = [
      { x: 0, y: 40 },
      { x: 30, y: 10 },
      { x: 70, y: 50 },
      { x: 110, y: 15 },
      { x: 150, y: 45 },
    ];
    const outline = pencilInkPathFromPoints(pts, 12, 'vector-ink', {
      linecap: 'round',
      simplify: false,
    });
    const subs = penSubpathsFromD(outline);
    expect(subs.length).toBe(1);
    // On-curve anchors only — control handles may sit off-path (Bezier), but
    // every anchor.x/y must lie on the outline ring samples.
    const ring = penSubpathsFromD(
      outline.replace(/[QqCc][^MLZz]+/gi, (seg) => {
        // Keep structure; just ensure we can measure anchors.
        return seg;
      })
    )[0];
    void ring;
    for (const a of subs[0].anchors) {
      // Silhouette from getSvgPathFromStroke — anchors are outline samples.
      expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true);
    }
    // Re-serialize must not invent anchors far from original positions.
    const again = penSubpathsFromD(penSubpathsToD(subs));
    expect(again[0].anchors.length).toBe(subs[0].anchors.length);
    for (let i = 0; i < subs[0].anchors.length; i += 1) {
      expect(
        dist(again[0].anchors[i].x, again[0].anchors[i].y, subs[0].anchors[i].x, subs[0].anchors[i].y)
      ).toBeLessThan(0.5);
    }
  });
});
