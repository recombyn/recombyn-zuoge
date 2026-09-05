/**
 * Stroke → triangle list. Default join is miter (matches attrs / Canvas).
 * Bevel only when miterLength/half exceeds miterLimit — never always-bevel
 * (that clipped star tips and square corners flat).
 */
import type { Vec2 } from '@/components/rcb/render/vector/contour';

export type StrokeMesh = {
  positions: Float32Array;
  triangleCount: number;
};

export type StrokeTessOpts = {
  width: number;
  closed?: boolean;
  /** 'center' | 'inside' | 'outside' */
  align?: string;
  /** Default 'miter' — product attrs / Canvas. */
  linejoin?: 'miter' | 'round' | 'bevel';
  /** Default 100 — keep acute tips (see resolveStrokeMiterlimit). */
  miterLimit?: number;
};

type SegOff = {
  l0: Vec2;
  r0: Vec2;
  l1: Vec2;
  r1: Vec2;
  n: Vec2;
};

function leftNormal(dx: number, dy: number): Vec2 {
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

function strokeBias(align: string, half: number): number {
  if (align === 'inside') return -half * 0.5;
  if (align === 'outside') return half * 0.5;
  return 0;
}

function closePolylineIfNeeded(points: Vec2[], closed: boolean): Vec2[] {
  const pts = points.slice();
  if (!closed || pts.length <= 2) return pts;
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  if (Math.abs(a.x - b.x) > 1e-5 || Math.abs(a.y - b.y) > 1e-5) pts.push({ ...a });
  return pts;
}

function pushTri(
  tris: number[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
) {
  tris.push(ax, ay, bx, by, cx, cy);
}

function pushQuad(tris: number[], s: SegOff) {
  pushTri(tris, s.l0.x, s.l0.y, s.r0.x, s.r0.y, s.l1.x, s.l1.y);
  pushTri(tris, s.l1.x, s.l1.y, s.r0.x, s.r0.y, s.r1.x, s.r1.y);
}

function pushBevelWedges(tris: number[], cur: Vec2, a: SegOff, b: SegOff) {
  pushTri(tris, cur.x, cur.y, a.l1.x, a.l1.y, b.l0.x, b.l0.y);
  pushTri(tris, cur.x, cur.y, a.r1.x, a.r1.y, b.r0.x, b.r0.y);
}

/** Round join: fan on the outer side, bevel the inner. */
function pushRoundJoin(
  tris: number[],
  cur: Vec2,
  a: SegOff,
  b: SegOff,
  hl: number,
  hr: number
) {
  const cross = a.n.x * b.n.y - a.n.y * b.n.x;
  const leftOuter = cross < 0;
  if (leftOuter) {
    pushTri(tris, cur.x, cur.y, a.r1.x, a.r1.y, b.r0.x, b.r0.y);
    fanOuterArc(tris, cur, a.l1, b.l0, Math.max(hl, 1e-4));
  } else {
    pushTri(tris, cur.x, cur.y, a.l1.x, a.l1.y, b.l0.x, b.l0.y);
    fanOuterArc(tris, cur, a.r1, b.r0, Math.max(hr, 1e-4));
  }
}

function fanOuterArc(tris: number[], cur: Vec2, from: Vec2, to: Vec2, radius: number) {
  let a0 = Math.atan2(from.y - cur.y, from.x - cur.x);
  let a1 = Math.atan2(to.y - cur.y, to.x - cur.x);
  let d = a1 - a0;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const steps = Math.max(2, Math.min(24, Math.ceil((Math.abs(d) * radius) / Math.max(0.5, radius * 0.35))));
  let prev = from;
  for (let s = 1; s <= steps; s += 1) {
    const t = s / steps;
    const ang = a0 + d * t;
    const p = {
      x: cur.x + Math.cos(ang) * radius,
      y: cur.y + Math.sin(ang) * radius,
    };
    if (s === steps) {
      p.x = to.x;
      p.y = to.y;
    }
    pushTri(tris, cur.x, cur.y, prev.x, prev.y, p.x, p.y);
    prev = p;
  }
}

/**
 * Try miter tip at `cur`. Returns null → caller keeps segment butts + bevel wedges.
 */
function tryMiterTips(
  cur: Vec2,
  n0: Vec2,
  n1: Vec2,
  hl: number,
  hr: number,
  miterLimit: number
): { left: Vec2; right: Vec2 } | null {
  let mx = n0.x + n1.x;
  let my = n0.y + n1.y;
  const mlen = Math.hypot(mx, my);
  if (mlen < 1e-8) return null;
  mx /= mlen;
  my /= mlen;
  const den = mx * n0.x + my * n0.y;
  if (Math.abs(den) < 1e-6) return null;
  const scaleL = hl / den;
  const scaleR = hr / den;
  // Canvas: miterLength / (lineWidth/2) > miterLimit → bevel.
  if (Math.abs(scaleL) > hl * miterLimit + 1e-6) return null;
  if (Math.abs(scaleR) > hr * miterLimit + 1e-6) return null;
  return {
    left: { x: cur.x + mx * scaleL, y: cur.y + my * scaleL },
    right: { x: cur.x - mx * scaleR, y: cur.y - my * scaleR },
  };
}

export function tessellateStroke(points: Vec2[], opts: StrokeTessOpts): StrokeMesh | null {
  const w = Math.max(0, Number(opts.width) || 0);
  if (!(w > 0) || points.length < 2) return null;

  const closed = Boolean(opts.closed);
  const half = w * 0.5;
  const bias = strokeBias(String(opts.align || 'center').toLowerCase(), half);
  const hl = half + bias;
  const hr = half - bias;
  const join = String(opts.linejoin || 'miter').toLowerCase();
  const wantMiter = join === 'miter';
  const wantRound = join === 'round';
  const miterLimit = Math.max(1, Number(opts.miterLimit) || 100);

  const pts = closePolylineIfNeeded(points, closed);
  const n = pts.length;
  if (n < 2) return null;

  const segs: SegOff[] = [];
  for (let i = 0; i + 1 < n; i += 1) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const nor = leftNormal(b.x - a.x, b.y - a.y);
    segs.push({
      n: nor,
      l0: { x: a.x + nor.x * hl, y: a.y + nor.y * hl },
      r0: { x: a.x - nor.x * hr, y: a.y - nor.y * hr },
      l1: { x: b.x + nor.x * hl, y: b.y + nor.y * hl },
      r1: { x: b.x - nor.x * hr, y: b.y - nor.y * hr },
    });
  }
  if (!segs.length) return null;

  const tris: number[] = [];
  const joinCount = segs.length - (closed ? 0 : 1);

  for (let j = 0; j < joinCount; j += 1) {
    const aIdx = j;
    const bIdx = closed ? (j + 1) % segs.length : j + 1;
    if (bIdx >= segs.length) break;
    const a = segs[aIdx]!;
    const b = segs[bIdx]!;
    const cur = pts[closed && bIdx === 0 ? 0 : aIdx + 1]!;
    // Vertex between seg a and seg b.
    if (wantMiter) {
      const tips = tryMiterTips(cur, a.n, b.n, hl, hr, miterLimit);
      if (tips) {
        a.l1 = tips.left;
        a.r1 = tips.right;
        b.l0 = tips.left;
        b.r0 = tips.right;
        continue;
      }
    }
    if (wantRound) {
      pushRoundJoin(tris, cur, a, b, hl, hr);
      continue;
    }
    pushBevelWedges(tris, cur, a, b);
  }

  for (const s of segs) pushQuad(tris, s);

  if (tris.length < 6) return null;
  return { positions: new Float32Array(tris), triangleCount: tris.length / 6 };
}
