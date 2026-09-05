/**
 * Ear-clip fill triangulation.
 * Holes: prefer WASM boolean difference, else polygon-clipping.
 */
import polygonClipping from 'polygon-clipping';
import type { Vec2 } from '@/components/rcb/render/vector/contour';
import { booleanPolygonsWasm } from '@/components/rcb/render/vector/wasmGeom';

export type FillMesh = {
  positions: Float32Array;
  triangleCount: number;
};

function area(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j]!.x * poly[i]!.y - poly[i]!.x * poly[j]!.y;
  }
  return a * 0.5;
}

function isConvex(a: Vec2, b: Vec2, c: Vec2, ccw: boolean): boolean {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return ccw ? cross > 1e-12 : cross < -1e-12;
}

function pointInTri(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const v0x = c.x - a.x;
  const v0y = c.y - a.y;
  const v1x = b.x - a.x;
  const v1y = b.y - a.y;
  const v2x = p.x - a.x;
  const v2y = p.y - a.y;
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const inv = 1 / (dot00 * dot11 - dot01 * dot01 + 1e-20);
  const u = (dot11 * dot02 - dot01 * dot12) * inv;
  const v = (dot00 * dot12 - dot01 * dot02) * inv;
  return u >= 0 && v >= 0 && u + v <= 1;
}

function cleanRing(points: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
    out.push(p);
  }
  if (out.length <= 2) return out;
  const a = out[0]!;
  const b = out[out.length - 1]!;
  if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) out.pop();
  return out;
}

function ringIsConvex(ring: Vec2[], ccw: boolean): boolean {
  for (let i = 0; i < ring.length; i += 1) {
    const prev = ring[(i - 1 + ring.length) % ring.length]!;
    const cur = ring[i]!;
    const next = ring[(i + 1) % ring.length]!;
    if (!isConvex(prev, cur, next, ccw)) return false;
  }
  return true;
}

function fanTris(ring: Vec2[]): number[] {
  const tris: number[] = [];
  const o = ring[0]!;
  for (let i = 1; i + 1 < ring.length; i += 1) {
    tris.push(o.x, o.y, ring[i]!.x, ring[i]!.y, ring[i + 1]!.x, ring[i + 1]!.y);
  }
  return tris;
}

function earclipTris(ring: Vec2[], ccw: boolean): number[] {
  const tris: number[] = [];
  const idx = ring.map((_, i) => i);
  let guard = ring.length * ring.length + 8;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i += 1) {
      const i0 = idx[(i - 1 + idx.length) % idx.length]!;
      const i1 = idx[i]!;
      const i2 = idx[(i + 1) % idx.length]!;
      const a0 = ring[i0]!;
      const a1 = ring[i1]!;
      const a2 = ring[i2]!;
      if (!isConvex(a0, a1, a2, ccw)) continue;
      let ear = true;
      for (const k of idx) {
        if (k === i0 || k === i1 || k === i2) continue;
        if (pointInTri(ring[k]!, a0, a1, a2)) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      tris.push(a0.x, a0.y, a1.x, a1.y, a2.x, a2.y);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) {
    const a0 = ring[idx[0]!]!;
    const a1 = ring[idx[1]!]!;
    const a2 = ring[idx[2]!]!;
    tris.push(a0.x, a0.y, a1.x, a1.y, a2.x, a2.y);
  }
  return tris;
}

function meshFromTris(tris: number[]): FillMesh | null {
  if (tris.length < 6) return null;
  return { positions: new Float32Array(tris), triangleCount: tris.length / 6 };
}

export function tessellateFill(points: Vec2[]): FillMesh | null {
  const ring = cleanRing(points);
  if (ring.length < 3) return null;
  const a = area(ring);
  if (Math.abs(a) < 1e-10) return null;
  const ccw = a > 0;
  const tris = ringIsConvex(ring, ccw) ? fanTris(ring) : earclipTris(ring, ccw);
  return meshFromTris(tris);
}

function toClosedRing(pts: Vec2[]): Array<[number, number]> {
  const r: Array<[number, number]> = pts.map((p) => [p.x, p.y]);
  const a = r[0]!;
  const b = r[r.length - 1]!;
  if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]);
  return r;
}

function appendMeshPositions(dst: number[], mesh: FillMesh): void {
  for (let i = 0; i < mesh.positions.length; i += 1) dst.push(mesh.positions[i]!);
}

/**
 * Outer + holes → difference → ear-clip.
 */
export function tessellateFillWithHoles(
  outer: Vec2[],
  holes: Vec2[][],
  depth = 0
): FillMesh | null {
  const outerRing = cleanRing(outer);
  if (outerRing.length < 3) return null;
  if (!holes.length) return tessellateFill(outerRing);

  let geom: Array<Array<Array<[number, number]>>> = [[toClosedRing(outerRing)]];
  for (const hole of holes) {
    const h = cleanRing(hole);
    if (h.length < 3) continue;
    const clipHole: Array<Array<[number, number]>> = [toClosedRing(h)];
    // WASM fold is pairwise on polygons — only safe when subject is one polygon.
    let next: typeof geom | null = null;
    if (geom.length === 1 && geom[0]) {
      next = booleanPolygonsWasm('difference', [geom[0], clipHole]);
    }
    if (next != null) {
      geom = next;
    } else {
      geom = polygonClipping.difference(geom, [clipHole]);
    }
  }

  const tris: number[] = [];
  for (const poly of geom) {
    if (!poly.length) continue;
    const outerPts = poly[0]!.slice(0, -1).map(([x, y]) => ({ x, y }));
    const holePts = poly
      .slice(1)
      .map((ring) => ring.slice(0, -1).map(([x, y]) => ({ x, y })))
      .filter((r) => r.length >= 3);

    let mesh: FillMesh | null;
    if (holePts.length > 0 && depth < 2) {
      mesh = tessellateFillWithHoles(outerPts, holePts, depth + 1);
    } else {
      mesh = tessellateFill(outerPts);
    }
    if (mesh) appendMeshPositions(tris, mesh);
  }
  return meshFromTris(tris);
}
