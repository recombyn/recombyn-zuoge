/**
 * SoA path centerline samples — sidecar polylines for pen/pencil/path idle ink.
 * SceneDocument still owns the SVG `d`; this densifies M/L/H/V/C/Q/S/T(+Z) into
 * world-space samples for Canvas bake / WebGL segment batching (ADR 0027 Phase 4).
 *
 * Multi-subpath contours are separated by a NaN,NaN break in the point stream so
 * paint/WebGL do not draw a spurious chord between contours.
 */
/** Max vertices retained per path slot (matches Canvas idle stroke budget). */
export const SOA_PATH_MAX_PTS = 64;
/** Approx scene-unit chord length between cubic/quadratic samples. */
export const SOA_PATH_CURVE_STEP = 4;

export type SoaPathPoint = { x: number; y: number };

function tokenizePathD(d: string): string[] {
  return String(d || '').match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
}

function cubicPoint(
  p0: SoaPathPoint,
  p1: SoaPathPoint,
  p2: SoaPathPoint,
  p3: SoaPathPoint,
  t: number
): SoaPathPoint {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  return {
    x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
    y: uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y,
  };
}

function quadPoint(p0: SoaPathPoint, p1: SoaPathPoint, p2: SoaPathPoint, t: number): SoaPathPoint {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

function dist(a: SoaPathPoint, b: SoaPathPoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pushPoint(out: SoaPathPoint[], p: SoaPathPoint) {
  const last = out[out.length - 1];
  if (last && Number.isFinite(last.x) && Math.hypot(last.x - p.x, last.y - p.y) < 1e-4) return;
  out.push({ x: p.x, y: p.y });
}

function pushBreak(out: SoaPathPoint[]) {
  if (out.length === 0) return;
  const last = out[out.length - 1];
  if (!Number.isFinite(last.x)) return;
  out.push({ x: Number.NaN, y: Number.NaN });
}

function sampleCubic(
  out: SoaPathPoint[],
  p0: SoaPathPoint,
  p1: SoaPathPoint,
  p2: SoaPathPoint,
  p3: SoaPathPoint,
  step: number
) {
  const approx = dist(p0, p1) + dist(p1, p2) + dist(p2, p3);
  const n = Math.max(2, Math.min(24, Math.ceil(approx / Math.max(0.5, step))));
  for (let i = 1; i <= n; i += 1) {
    pushPoint(out, cubicPoint(p0, p1, p2, p3, i / n));
  }
}

function sampleQuad(
  out: SoaPathPoint[],
  p0: SoaPathPoint,
  p1: SoaPathPoint,
  p2: SoaPathPoint,
  step: number
) {
  const approx = dist(p0, p1) + dist(p1, p2);
  const n = Math.max(2, Math.min(16, Math.ceil(approx / Math.max(0.5, step))));
  for (let i = 1; i <= n; i += 1) {
    pushPoint(out, quadPoint(p0, p1, p2, i / n));
  }
}

/**
 * SVG elliptical arc densify (W3C F.6 endpoint→center).
 * Samples along the arc; degenerate radii collapse to the endpoint.
 */
export function sampleSoaArc(
  out: SoaPathPoint[],
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  phiDeg: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number,
  step = SOA_PATH_CURVE_STEP
) {
  let rxAbs = Math.abs(rxIn);
  let ryAbs = Math.abs(ryIn);
  if (rxAbs < 1e-6 || ryAbs < 1e-6 || (Math.abs(x1 - x2) < 1e-6 && Math.abs(y1 - y2) < 1e-6)) {
    pushPoint(out, { x: x2, y: y2 });
    return;
  }
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const phi = (phiDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  const lambda = (x1p * x1p) / (rxAbs * rxAbs) + (y1p * y1p) / (ryAbs * ryAbs);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rxAbs *= s;
    ryAbs *= s;
  }

  const rxSq = rxAbs * rxAbs;
  const rySq = ryAbs * ryAbs;
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;
  let sq =
    (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) / Math.max(1e-12, rxSq * y1pSq + rySq * x1pSq);
  sq = Math.max(0, sq);
  const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(sq);
  const cxp = (coef * (rxAbs * y1p)) / ryAbs;
  const cyp = (coef * -(ryAbs * x1p)) / rxAbs;

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const angleBetween = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let ang = Math.acos(Math.max(-1, Math.min(1, len > 0 ? dot / len : 1)));
    if (ux * vy - uy * vx < 0) ang = -ang;
    return ang;
  };

  const ux = (x1p - cxp) / rxAbs;
  const uy = (y1p - cyp) / ryAbs;
  const vx = (-x1p - cxp) / rxAbs;
  const vy = (-y1p - cyp) / ryAbs;
  const theta1 = angleBetween(1, 0, ux, uy);
  let dTheta = angleBetween(ux, uy, vx, vy);
  if (!sweep && dTheta > 0) dTheta -= Math.PI * 2;
  if (sweep && dTheta < 0) dTheta += Math.PI * 2;

  const arcLen = Math.abs(dTheta) * ((rxAbs + ryAbs) * 0.5);
  const n = Math.max(2, Math.min(48, Math.ceil(arcLen / Math.max(0.5, step))));
  for (let i = 1; i <= n; i += 1) {
    const theta = theta1 + (dTheta * i) / n;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    pushPoint(out, {
      x: cosPhi * rxAbs * cosT - sinPhi * ryAbs * sinT + cx,
      y: sinPhi * rxAbs * cosT + cosPhi * ryAbs * sinT + cy,
    });
  }
}

function sampleArc(
  out: SoaPathPoint[],
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  phiDeg: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number,
  step: number
) {
  sampleSoaArc(out, x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2, step);
}

/**
 * Densify SVG path `d` into a polyline (local coords).
 * Curve commands are sampled; arcs (A) fall back to endpoint only.
 */
export function densifySoaPathD(
  d: string,
  step = SOA_PATH_CURVE_STEP
): SoaPathPoint[] {
  const tokens = tokenizePathD(d);
  if (!tokens.length) return [];

  const out: SoaPathPoint[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let prevCx = 0;
  let prevCy = 0;
  let lastWasCurve = false;
  let subStarted = false;

  const readNum = (): number | null => {
    if (i >= tokens.length) return null;
    const t = tokens[i];
    if (/^[a-zA-Z]$/.test(t)) return null;
    i += 1;
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
  };

  while (i < tokens.length) {
    const raw = tokens[i++];
    if (!/^[a-zA-Z]$/.test(raw)) continue;
    const lower = raw.toLowerCase();
    const rel = raw === lower;

    if (lower === 'z') {
      if (subStarted) pushPoint(out, { x: startX, y: startY });
      cx = startX;
      cy = startY;
      lastWasCurve = false;
      continue;
    }

    if (lower === 'm') {
      if (subStarted) pushBreak(out);
      let x = readNum();
      let y = readNum();
      if (x == null || y == null) continue;
      if (rel) {
        x += cx;
        y += cy;
      }
      cx = x;
      cy = y;
      startX = x;
      startY = y;
      subStarted = true;
      lastWasCurve = false;
      pushPoint(out, { x, y });
      // Implicit linetos after moveto
      while (i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])) {
        let lx = readNum();
        let ly = readNum();
        if (lx == null || ly == null) break;
        if (rel) {
          lx += cx;
          ly += cy;
        }
        cx = lx;
        cy = ly;
        pushPoint(out, { x: lx, y: ly });
      }
      continue;
    }

    if (lower === 'l') {
      while (i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])) {
        let x = readNum();
        let y = readNum();
        if (x == null || y == null) break;
        if (rel) {
          x += cx;
          y += cy;
        }
        cx = x;
        cy = y;
        lastWasCurve = false;
        pushPoint(out, { x, y });
      }
      continue;
    }

    if (lower === 'h') {
      while (i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])) {
        let x = readNum();
        if (x == null) break;
        if (rel) x += cx;
        cx = x;
        lastWasCurve = false;
        pushPoint(out, { x: cx, y: cy });
      }
      continue;
    }

    if (lower === 'v') {
      while (i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])) {
        let y = readNum();
        if (y == null) break;
        if (rel) y += cy;
        cy = y;
        lastWasCurve = false;
        pushPoint(out, { x: cx, y: cy });
      }
      continue;
    }

    if (lower === 'c') {
      while (i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])) {
        let x1 = readNum();
        let y1 = readNum();
        let x2 = readNum();
        let y2 = readNum();
        let x = readNum();
        let y = readNum();
        if (x1 == null || y1 == null || x2 == null || y2 == null || x == null || y == null) break;
        if (rel) {
          x1 += cx;
          y1 += cy;
          x2 += cx;
          y2 += cy;
          x += cx;
          y += cy;
        }
        const p0 = { x: cx, y: cy };
        const p1 = { x: x1, y: y1 };
        const p2 = { x: x2, y: y2 };
        const p3 = { x, y };
        sampleCubic(out, p0, p1, p2, p3, step);
        prevCx = x2;
        prevCy = y2;
        cx = x;
        cy = y;
        lastWasCurve = true;
      }
      continue;
    }

    if (lower === 's') {
      while (i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])) {
        let x2 = readNum();
        let y2 = readNum();
        let x = readNum();
        let y = readNum();
        if (x2 == null || y2 == null || x == null || y == null) break;
        if (rel) {
          x2 += cx;
          y2 += cy;
          x += cx;
          y += cy;
        }
        const x1 = lastWasCurve ? 2 * cx - prevCx : cx;
        const y1 = lastWasCurve ? 2 * cy - prevCy : cy;
        const p0 = { x: cx, y: cy };
        sampleCubic(out, p0, { x: x1, y: y1 }, { x: x2, y: y2 }, { x, y }, step);
        prevCx = x2;
        prevCy = y2;
        cx = x;
        cy = y;
        lastWasCurve = true;
      }
      continue;
    }

    if (lower === 'q') {
      while (i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])) {
        let x1 = readNum();
        let y1 = readNum();
        let x = readNum();
        let y = readNum();
        if (x1 == null || y1 == null || x == null || y == null) break;
        if (rel) {
          x1 += cx;
          y1 += cy;
          x += cx;
          y += cy;
        }
        sampleQuad(out, { x: cx, y: cy }, { x: x1, y: y1 }, { x, y }, step);
        prevCx = x1;
        prevCy = y1;
        cx = x;
        cy = y;
        lastWasCurve = true;
      }
      continue;
    }

    if (lower === 't') {
      while (i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])) {
        let x = readNum();
        let y = readNum();
        if (x == null || y == null) break;
        if (rel) {
          x += cx;
          y += cy;
        }
        const x1 = lastWasCurve ? 2 * cx - prevCx : cx;
        const y1 = lastWasCurve ? 2 * cy - prevCy : cy;
        sampleQuad(out, { x: cx, y: cy }, { x: x1, y: y1 }, { x, y }, step);
        prevCx = x1;
        prevCy = y1;
        cx = x;
        cy = y;
        lastWasCurve = true;
      }
      continue;
    }

    if (lower === 'a') {
      while (i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i])) {
        let rx = readNum();
        let ry = readNum();
        const rot = readNum();
        const largeArc = readNum();
        const sweep = readNum();
        let x = readNum();
        let y = readNum();
        if (
          rx == null ||
          ry == null ||
          rot == null ||
          largeArc == null ||
          sweep == null ||
          x == null ||
          y == null
        ) {
          break;
        }
        if (rel) {
          x += cx;
          y += cy;
        }
        sampleArc(
          out,
          cx,
          cy,
          rx,
          ry,
          rot,
          largeArc ? 1 : 0,
          sweep ? 1 : 0,
          x,
          y,
          step
        );
        cx = x;
        cy = y;
        lastWasCurve = false;
      }
    }
  }

  return out;
}

/** Drop NaN breaks and uniform-subsample to maxPts while keeping endpoints. */
export function capSoaPathPoints(pts: SoaPathPoint[], maxPts = SOA_PATH_MAX_PTS): SoaPathPoint[] {
  if (pts.length <= maxPts) return pts;
  // Prefer keeping break markers + endpoints of each contour.
  const finite = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (finite.length <= maxPts) return pts;

  const step = Math.max(1, Math.ceil(pts.length / maxPts));
  const out: SoaPathPoint[] = [];
  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i];
    if (p) out.push(p);
  }
  const last = pts[pts.length - 1];
  if (last && (out.length === 0 || out[out.length - 1] !== last)) out.push(last);
  // Ensure we didn't exceed too far past budget after +last
  if (out.length <= maxPts + 4) return out;
  const step2 = Math.max(1, Math.ceil(out.length / maxPts));
  const capped: SoaPathPoint[] = [];
  for (let i = 0; i < out.length; i += step2) capped.push(out[i]);
  if (capped[capped.length - 1] !== out[out.length - 1]) capped.push(out[out.length - 1]);
  return capped;
}

/**
 * Sample path `d` into local polyline points (curves densified, then capped).
 * Prefer this over M/L-only parse for SoA idle ink.
 */
export function sampleSoaPathPolyline(
  d: string,
  maxPts = SOA_PATH_MAX_PTS,
  step = SOA_PATH_CURVE_STEP
): SoaPathPoint[] {
  const densified = densifySoaPathD(d, step);
  const finiteCount = densified.reduce(
    (n, p) => n + (Number.isFinite(p.x) && Number.isFinite(p.y) ? 1 : 0),
    0
  );
  if (finiteCount < 2) return [];
  return capSoaPathPoints(densified, maxPts);
}

export function pathDLooksClosed(d: string, closedAttr: unknown): boolean {
  if (closedAttr === true || closedAttr === 'true' || closedAttr === 1 || closedAttr === '1') {
    return true;
  }
  return /[zZ]\s*$/.test(String(d || '').trim());
}

export function isSoaPathBreak(p: SoaPathPoint | undefined): boolean {
  return !p || !Number.isFinite(p.x) || !Number.isFinite(p.y);
}
