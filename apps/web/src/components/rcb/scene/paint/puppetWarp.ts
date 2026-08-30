/**
 * Sparse-pin image warp (AE Puppet–style): rest UV grid + IDW pin deltas.
 * Destination vertices move; texture coords stay at rest UV.
 */
import type { PuppetPin } from '@/components/editor/nodes/ImageNode/puppet/puppetModel';
import { readPuppetDensity } from '@/components/editor/nodes/ImageNode/puppet/puppetModel';

export type PuppetWarpGrid = {
  density: number;
  /** Rest UVs length (density+1)^2, interleaved u,v */
  restUv: Float32Array;
  /** Dest UVs after pin field, interleaved u,v */
  destUv: Float32Array;
};

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

/** IDW displacement field in UV space. */
export function samplePinField(
  u: number,
  v: number,
  pins: readonly PuppetPin[]
): { du: number; dv: number } {
  if (!pins.length) return { du: 0, dv: 0 };
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (const p of pins) {
    const du = u - p.u;
    const dv = v - p.v;
    const d2 = du * du + dv * dv;
    const w = 1 / (d2 + 1e-4);
    sx += p.dx * w;
    sy += p.dy * w;
    sw += w;
  }
  if (sw <= 0) return { du: 0, dv: 0 };
  return { du: sx / sw, dv: sy / sw };
}

export function buildPuppetWarpGrid(
  pins: readonly PuppetPin[],
  density: number
): PuppetWarpGrid {
  const n = Math.max(2, Math.round(density));
  const count = (n + 1) * (n + 1);
  const restUv = new Float32Array(count * 2);
  const destUv = new Float32Array(count * 2);
  let i = 0;
  for (let y = 0; y <= n; y += 1) {
    const v = y / n;
    for (let x = 0; x <= n; x += 1) {
      const u = x / n;
      restUv[i] = u;
      restUv[i + 1] = v;
      const { du, dv } = samplePinField(u, v, pins);
      destUv[i] = clamp01(u + du);
      destUv[i + 1] = clamp01(v + dv);
      i += 2;
    }
  }
  return { density: n, restUv, destUv };
}

function drawTexturedTriangle(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  imgW: number,
  imgH: number,
  // dest px
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  // source UV 0–1
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  u2: number,
  v2: number
) {
  // Affine texture map via setTransform (same approach as many 2d mesh warps).
  const sx0 = u0 * imgW;
  const sy0 = v0 * imgH;
  const sx1 = u1 * imgW;
  const sy1 = v1 * imgH;
  const sx2 = u2 * imgW;
  const sy2 = v2 * imgH;

  const denom = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
  if (Math.abs(denom) < 1e-6) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.closePath();
  ctx.clip();

  // Solve affine map from source → dest for the triangle.
  const m11 =
    (x0 * (sy1 - sy2) + x1 * (sy2 - sy0) + x2 * (sy0 - sy1)) / denom;
  const m12 =
    (x0 * (sx2 - sx1) + x1 * (sx0 - sx2) + x2 * (sx1 - sx0)) / denom;
  const m13 =
    (x0 * (sx1 * sy2 - sx2 * sy1) +
      x1 * (sx2 * sy0 - sx0 * sy2) +
      x2 * (sx0 * sy1 - sx1 * sy0)) /
    denom;
  const m21 =
    (y0 * (sy1 - sy2) + y1 * (sy2 - sy0) + y2 * (sy0 - sy1)) / denom;
  const m22 =
    (y0 * (sx2 - sx1) + y1 * (sx0 - sx2) + y2 * (sx1 - sx0)) / denom;
  const m23 =
    (y0 * (sx1 * sy2 - sx2 * sy1) +
      y1 * (sx2 * sy0 - sx0 * sy2) +
      y2 * (sx0 * sy1 - sx1 * sy0)) /
    denom;

  ctx.setTransform(m11, m21, m12, m22, m13, m23);
  ctx.drawImage(img, 0, 0, imgW, imgH);
  ctx.restore();
}

function imageSourceSize(img: CanvasImageSource): { w: number; h: number } {
  if (img instanceof HTMLImageElement) {
    return {
      w: Math.max(1, img.naturalWidth || img.width || 1),
      h: Math.max(1, img.naturalHeight || img.height || 1),
    };
  }
  if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
    return { w: Math.max(1, img.width), h: Math.max(1, img.height) };
  }
  if (img instanceof HTMLCanvasElement) {
    return { w: Math.max(1, img.width), h: Math.max(1, img.height) };
  }
  const any = img as { width?: number; height?: number };
  return { w: Math.max(1, Number(any.width) || 1), h: Math.max(1, Number(any.height) || 1) };
}

/**
 * Paint warped image into a destination box (local 0,0 → w×h).
 */
export function paintPuppetWarpedImage(
  ctx: CanvasRenderingContext2D,
  opts: {
    image: CanvasImageSource;
    width: number;
    height: number;
    pins: readonly PuppetPin[];
    density?: number;
    attrs?: Record<string, unknown> | null;
  }
): void {
  const w = Math.max(1, opts.width);
  const h = Math.max(1, opts.height);
  const density =
    opts.density ??
    readPuppetDensity(opts.attrs || undefined);
  const grid = buildPuppetWarpGrid(opts.pins, density);
  const n = grid.density;
  const { w: imgW, h: imgH } = imageSourceSize(opts.image);

  const idx = (x: number, y: number) => (y * (n + 1) + x) * 2;

  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const i00 = idx(x, y);
      const i10 = idx(x + 1, y);
      const i01 = idx(x, y + 1);
      const i11 = idx(x + 1, y + 1);

      const ru00 = grid.restUv[i00]!;
      const rv00 = grid.restUv[i00 + 1]!;
      const ru10 = grid.restUv[i10]!;
      const rv10 = grid.restUv[i10 + 1]!;
      const ru01 = grid.restUv[i01]!;
      const rv01 = grid.restUv[i01 + 1]!;
      const ru11 = grid.restUv[i11]!;
      const rv11 = grid.restUv[i11 + 1]!;

      const x00 = grid.destUv[i00]! * w;
      const y00 = grid.destUv[i00 + 1]! * h;
      const x10 = grid.destUv[i10]! * w;
      const y10 = grid.destUv[i10 + 1]! * h;
      const x01 = grid.destUv[i01]! * w;
      const y01 = grid.destUv[i01 + 1]! * h;
      const x11 = grid.destUv[i11]! * w;
      const y11 = grid.destUv[i11 + 1]! * h;

      drawTexturedTriangle(
        ctx,
        opts.image,
        imgW,
        imgH,
        x00,
        y00,
        x10,
        y10,
        x01,
        y01,
        ru00,
        rv00,
        ru10,
        rv10,
        ru01,
        rv01
      );
      drawTexturedTriangle(
        ctx,
        opts.image,
        imgW,
        imgH,
        x10,
        y10,
        x11,
        y11,
        x01,
        y01,
        ru10,
        rv10,
        ru11,
        rv11,
        ru01,
        rv01
      );
    }
  }
}

/** Bake warped plate to a data URL (for SVG `<image>` swap). */
export function bakePuppetWarpDataUrl(
  image: CanvasImageSource,
  opts: {
    width: number;
    height: number;
    pins: readonly PuppetPin[];
    density?: number;
    attrs?: Record<string, unknown> | null;
  }
): string | null {
  const w = Math.max(1, Math.round(opts.width));
  const h = Math.max(1, Math.round(opts.height));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paintPuppetWarpedImage(ctx, {
    image,
    width: w,
    height: h,
    pins: opts.pins,
    density: opts.density,
    attrs: opts.attrs,
  });
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
