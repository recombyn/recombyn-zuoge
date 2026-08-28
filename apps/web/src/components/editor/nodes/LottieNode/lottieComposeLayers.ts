/**
 * Lottie compose helpers — blank animation + append rect/ellipse layers.
 */

import {
  parseLottieAnimationData,
  serializeLottieAnimationData,
} from '@/components/rcb/scene/document/nodeFactories';

export type LottieComposeTool = 'select' | 'rect' | 'ellipse' | 'pen' | 'text';

export type LottieLocalBox = { x: number; y: number; w: number; h: number };

export function createBlankLottieAnimation(opts: {
  width: number;
  height: number;
  durationSec?: number;
  fps?: number;
}): Record<string, unknown> {
  const w = Math.max(32, Math.round(opts.width));
  const h = Math.max(32, Math.round(opts.height));
  const fps = Math.max(1, Math.round(opts.fps ?? 30));
  const dur = Math.max(0.5, Number(opts.durationSec) || 2);
  const op = Math.max(1, Math.round(dur * fps));
  return {
    v: '5.7.4',
    fr: fps,
    ip: 0,
    op,
    w,
    h,
    nm: 'Composition',
    ddd: 0,
    assets: [],
    layers: [],
  };
}

/** Scene plate → Lottie local (FIT / contain letterbox). */
export function scenePointToLottieLocal(
  sceneX: number,
  sceneY: number,
  plate: { left: number; top: number; width: number; height: number },
  animW: number,
  animH: number
): { x: number; y: number } {
  const aw = Math.max(1, animW);
  const ah = Math.max(1, animH);
  const scale = Math.min(plate.width / aw, plate.height / ah);
  const contentW = aw * scale;
  const contentH = ah * scale;
  const ox = plate.left + (plate.width - contentW) / 2;
  const oy = plate.top + (plate.height - contentH) / 2;
  return {
    x: (sceneX - ox) / scale,
    y: (sceneY - oy) / scale,
  };
}

export function sceneBoxToLottieLocal(
  box: { x: number; y: number; w: number; h: number },
  plate: { left: number; top: number; width: number; height: number },
  animW: number,
  animH: number
): LottieLocalBox {
  const a = scenePointToLottieLocal(box.x, box.y, plate, animW, animH);
  const b = scenePointToLottieLocal(box.x + box.w, box.y + box.h, plate, animW, animH);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(1, Math.abs(b.x - a.x)),
    h: Math.max(1, Math.abs(b.y - a.y)),
  };
}

function nextLayerIndex(layers: unknown[]): number {
  let max = 0;
  for (const raw of layers) {
    if (!raw || typeof raw !== 'object') continue;
    const ind = Number((raw as { ind?: unknown }).ind);
    if (Number.isFinite(ind) && ind > max) max = ind;
  }
  return max + 1;
}

function solidFill(r = 0.23, g = 0.51, b = 0.96) {
  return {
    ty: 'fl',
    c: { a: 0, k: [r, g, b, 1] },
    o: { a: 0, k: 100 },
    r: 1,
    bm: 0,
    nm: 'Fill',
  };
}

function baseTransform(cx: number, cy: number) {
  return {
    o: { a: 0, k: 100 },
    r: { a: 0, k: 0 },
    p: { a: 0, k: [cx, cy, 0] },
    a: { a: 0, k: [0, 0, 0] },
    s: { a: 0, k: [100, 100, 100] },
  };
}

export function appendRectLayer(
  anim: Record<string, unknown>,
  box: LottieLocalBox,
  name = 'Rectangle'
): Record<string, unknown> {
  const layers = Array.isArray(anim.layers) ? [...anim.layers] : [];
  const ind = nextLayerIndex(layers);
  const op = Math.max(1, Number(anim.op) || 60);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  layers.unshift({
    ddd: 0,
    ind,
    ty: 4,
    nm: name,
    sr: 1,
    ks: baseTransform(cx, cy),
    ao: 0,
    shapes: [
      {
        ty: 'rc',
        d: 1,
        s: { a: 0, k: [box.w, box.h] },
        p: { a: 0, k: [0, 0] },
        r: { a: 0, k: 0 },
        nm: 'Rectangle Path',
      },
      solidFill(),
    ],
    ip: 0,
    op,
    st: 0,
    bm: 0,
  });
  return { ...anim, layers };
}

export function appendEllipseLayer(
  anim: Record<string, unknown>,
  box: LottieLocalBox,
  name = 'Ellipse'
): Record<string, unknown> {
  const layers = Array.isArray(anim.layers) ? [...anim.layers] : [];
  const ind = nextLayerIndex(layers);
  const op = Math.max(1, Number(anim.op) || 60);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  layers.unshift({
    ddd: 0,
    ind,
    ty: 4,
    nm: name,
    sr: 1,
    ks: baseTransform(cx, cy),
    ao: 0,
    shapes: [
      {
        ty: 'el',
        d: 1,
        s: { a: 0, k: [box.w, box.h] },
        p: { a: 0, k: [0, 0] },
        nm: 'Ellipse Path',
      },
      solidFill(0.95, 0.35, 0.35),
    ],
    ip: 0,
    op,
    st: 0,
    bm: 0,
  });
  return { ...anim, layers };
}

export function ensureLottieAnimationForCompose(
  raw: unknown,
  plate: { width: number; height: number }
): Record<string, unknown> {
  const parsed = parseLottieAnimationData(raw);
  if (parsed && Array.isArray(parsed.layers)) return parsed;
  return createBlankLottieAnimation({
    width: plate.width,
    height: plate.height,
    durationSec: 2,
    fps: 30,
  });
}

export function patchAnimationDataAttr(anim: Record<string, unknown>): string | null {
  return serializeLottieAnimationData(anim);
}
