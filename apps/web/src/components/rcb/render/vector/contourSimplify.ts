/**
 * Closed-ring RDP with epsilon growth + turn-drop cap (shared main + Worker).
 * Prefers WASM simplify_rdp_closed when `rdpClosed` is provided.
 */
export type RdpClosedFn = (
  pts: Array<[number, number]>,
  epsilon: number
) => Array<[number, number]> | null;

function distPointToSeg(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-20) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function simplifyRdpJs(
  pts: Array<[number, number]>,
  epsilon: number
): Array<[number, number]> {
  if (pts.length <= 2) return pts.slice();
  let maxDist = 0;
  let maxIdx = 0;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const d = distPointToSeg(pts[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  if (maxDist <= epsilon) return [first, last];
  const left = simplifyRdpJs(pts.slice(0, maxIdx + 1), epsilon);
  const right = simplifyRdpJs(pts.slice(maxIdx), epsilon);
  return left.slice(0, -1).concat(right);
}

function closeRing(arr: Array<[number, number]>): Array<[number, number]> {
  if (arr.length < 2) return arr;
  const f = arr[0]!;
  const l = arr[arr.length - 1]!;
  if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) return arr.slice(0, -1);
  return arr;
}

export function simplifyClosedPolylineGrow(
  pts: Array<[number, number]>,
  epsilon: number,
  maxPts: number,
  maxEpsilon?: number,
  rdpClosed?: RdpClosedFn | null
): Array<[number, number]> {
  if (pts.length < 3) return pts.slice();
  let ring = pts;
  const a = ring[0]!;
  const b = ring[ring.length - 1]!;
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) {
    ring = ring.slice(0, -1);
  }
  if (ring.length < 3) return pts.slice();

  const run = (src: Array<[number, number]>, eps: number) => {
    const wasm = rdpClosed?.(src, eps) ?? null;
    if (wasm && wasm.length >= 3) return closeRing(wasm);
    return closeRing(simplifyRdpJs(src.concat([src[0]!]), eps));
  };

  let out = run(ring, epsilon);
  if (out.length > maxPts) {
    const epsCap = maxEpsilon ?? Math.max(epsilon * 4, epsilon + 0.5);
    let eps = epsilon;
    let guarded = 0;
    while (out.length > maxPts && guarded < 12 && eps < epsCap - 1e-6) {
      eps = Math.min(epsCap, eps * 1.35);
      out = run(ring, eps);
      guarded += 1;
    }
    if (out.length > maxPts) {
      const turnMag = (i: number) => {
        const n = out.length;
        const prev = out[(i - 1 + n) % n]!;
        const curr = out[i]!;
        const next = out[(i + 1) % n]!;
        const ax = curr[0] - prev[0];
        const ay = curr[1] - prev[1];
        const bx = next[0] - curr[0];
        const by = next[1] - curr[1];
        const la = Math.hypot(ax, ay) || 1;
        const lb = Math.hypot(bx, by) || 1;
        const dot = Math.max(-1, Math.min(1, (ax / la) * (bx / lb) + (ay / la) * (by / lb)));
        return Math.acos(dot);
      };
      while (out.length > maxPts && out.length > 3) {
        let minI = 0;
        let minTurn = Infinity;
        for (let i = 0; i < out.length; i += 1) {
          const t = turnMag(i);
          if (t < minTurn) {
            minTurn = t;
            minI = i;
          }
        }
        out = out.filter((_, i) => i !== minI);
      }
    }
  }
  return out.length >= 3 ? out : ring.slice(0, Math.min(ring.length, maxPts));
}

export function packContours(contours: Array<Array<[number, number]>>): Float32Array {
  const buf: number[] = [contours.length];
  for (const c of contours) {
    buf.push(c.length);
    for (const p of c) {
      buf.push(p[0], p[1]);
    }
  }
  return new Float32Array(buf);
}

export function unpackContours(packed: ArrayLike<number>): Array<Array<[number, number]>> {
  if (!packed.length) return [];
  let i = 0;
  const count = packed[i++]! | 0;
  const out: Array<Array<[number, number]>> = [];
  for (let c = 0; c < count; c += 1) {
    if (i >= packed.length) break;
    const n = packed[i++]! | 0;
    if (n < 0 || i + n * 2 > packed.length) break;
    const ring: Array<[number, number]> = [];
    for (let v = 0; v < n; v += 1) {
      ring.push([Number(packed[i++]), Number(packed[i++])]);
    }
    if (ring.length >= 3) out.push(ring);
  }
  return out;
}
