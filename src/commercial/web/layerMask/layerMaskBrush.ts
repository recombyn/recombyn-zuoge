/** PS-like soft round brush for grayscale layer masks (white=reveal, black=hide). */

export type MaskPaintColor = 'white' | 'black';

export type LayerMaskBrushSettings = {
  /** Brush diameter in world (image) pixels. */
  size: number;
  /** 0 = softest, 100 = hard edge. */
  hardness: number;
  /** 0–100 — max stroke strength per dab. */
  opacity: number;
  /** 0–100 — build-up rate when overlapping dabs. */
  flow: number;
  /** 1–5 — dab spacing as % of brush diameter. */
  spacing: number;
  /** 0–100 — extra interpolation between pointer samples. */
  smooth: number;
  pressureOpacity: boolean;
  pressureFlow: boolean;
  pressureSize: boolean;
};

export const DEFAULT_LAYER_MASK_BRUSH: LayerMaskBrushSettings = {
  size: 48,
  hardness: 0,
  opacity: 100,
  flow: 100,
  spacing: 3,
  smooth: 20,
  pressureOpacity: true,
  pressureFlow: true,
  pressureSize: true,
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function grayValue(color: MaskPaintColor): number {
  return color === 'white' ? 255 : 0;
}

function effectivePressure(settings: LayerMaskBrushSettings, pressure: number): number {
  const p = Number.isFinite(pressure) && pressure > 0 ? pressure : 1;
  return clamp01(p);
}

/** Scene brush radius (half diameter) from world size, zoom, and optional pressure. */
export function maskBrushRadiusScene(
  settings: LayerMaskBrushSettings,
  zoom: number,
  pressure = 1
): number {
  const z = Math.max(0.05, zoom || 1);
  let size = Math.max(1, settings.size);
  if (settings.pressureSize) {
    const p = effectivePressure(settings, pressure);
    size *= 0.35 + 0.65 * p;
  }
  return Math.max(0.5, (size * z) / 2);
}

function dabAlpha(settings: LayerMaskBrushSettings, pressure: number): number {
  const p = effectivePressure(settings, pressure);
  const opacity = clamp01(settings.opacity / 100) * (settings.pressureOpacity ? p : 1);
  const flow = clamp01(settings.flow / 100) * (settings.pressureFlow ? p : 1);
  return clamp01(opacity * flow);
}

/** Paint one soft/hard round dab onto a mask canvas (stage-pixel coordinates). */
export function paintMaskDab(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: MaskPaintColor,
  settings: LayerMaskBrushSettings,
  pressure: number
) {
  if (radius <= 0) return;
  const alpha = dabAlpha(settings, pressure);
  if (alpha <= 0) return;
  const g = grayValue(color);
  const hard = clamp01(settings.hardness / 100);

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = alpha;

  if (hard >= 0.98) {
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const inner = radius * hard;
  const grad = ctx.createRadialGradient(x, y, inner, x, y, radius);
  grad.addColorStop(0, `rgba(${g},${g},${g},1)`);
  grad.addColorStop(1, `rgba(${g},${g},${g},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/** Stroke between two canvas points with spacing + optional smoothing. */
export function paintMaskStroke(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number } | null,
  to: { x: number; y: number },
  color: MaskPaintColor,
  settings: LayerMaskBrushSettings,
  zoom: number,
  pressure: number
) {
  const radius = maskBrushRadiusScene(settings, zoom, pressure);
  if (!from) {
    paintMaskDab(ctx, to.x, to.y, radius, color, settings, pressure);
    return;
  }

  const spacingPx = Math.max(1, (settings.size * Math.max(0.05, zoom) * settings.spacing) / 100);
  const smoothSteps = Math.max(0, Math.round((settings.smooth / 100) * 4));
  const points: { x: number; y: number }[] = [];
  if (smoothSteps > 0) {
    for (let i = 0; i <= smoothSteps; i += 1) {
      const t = i / smoothSteps;
      points.push({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      });
    }
  } else {
    points.push(to);
  }

  let last = from;
  for (const pt of points) {
    const d = dist(last.x, last.y, pt.x, pt.y);
    if (d < spacingPx * 0.25) continue;
    const steps = Math.max(1, Math.ceil(d / spacingPx));
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const x = last.x + (pt.x - last.x) * t;
      const y = last.y + (pt.y - last.y) * t;
      paintMaskDab(ctx, x, y, radius, color, settings, pressure);
    }
    last = pt;
  }
}
