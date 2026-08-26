/**
 * Processing plate paint — radial gradients live in SVG defs (resize with path).
 */

import {
  append,
  ensureDefs,
  setAttrs,
  setFill,
  setStroke,
  svgEl,
  urlRef,
} from '@/components/rcb/scene/paint/svgDom';
import {
  PROCESS_PLATE_FILL,
  PROCESS_PLATE_STROKE,
  processGlowForeignObjectBounds,
} from './processGlow';

export type ProcessPlateStroke = {
  color: string;
  width: number;
  dasharray?: string;
};

const GLOW_CORE = 'rgb(175, 200, 230)';
const GLOW_SOFT = 'rgb(210, 225, 240)';

export function processPlateGradientIds(plateKey: string): { coreId: string; softId: string } {
  const safe = String(plateKey || 'plate')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 48);
  return {
    coreId: `rcb-process-glow-core-${safe}`,
    softId: `rcb-process-glow-soft-${safe}`,
  };
}

function upsertRadialGradient(
  defs: SVGDefsElement,
  id: string,
  opts: {
    cx: number;
    cy: number;
    r: number;
    coreColor: string;
    coreOpacity: number;
    baseColor: string;
    fadeOffset: string;
  }
): void {
  let grad = defs.querySelector(`#${CSS.escape(id)}`) as SVGRadialGradientElement | null;
  if (!grad) {
    grad = svgEl('radialGradient', {
      id,
      gradientUnits: 'objectBoundingBox',
      cx: opts.cx,
      cy: opts.cy,
      r: opts.r,
    });
    defs.appendChild(grad);
  } else {
    setAttrs(grad, { cx: opts.cx, cy: opts.cy, r: opts.r });
    while (grad.firstChild) grad.removeChild(grad.firstChild);
  }
  grad.appendChild(
    svgEl('stop', {
      offset: '0%',
      'stop-color': opts.coreColor,
      'stop-opacity': opts.coreOpacity,
    })
  );
  grad.appendChild(
    svgEl('stop', {
      offset: opts.fadeOffset,
      'stop-color': opts.baseColor,
      'stop-opacity': 0,
    })
  );
}

export function ensureProcessPlateGradients(
  root: SVGSVGElement,
  plateKey: string
): { coreId: string; softId: string } {
  const defs = ensureDefs(root);
  const ids = processPlateGradientIds(plateKey);
  upsertRadialGradient(defs, ids.coreId, {
    cx: 0.58,
    cy: 0.38,
    r: 0.65,
    coreColor: GLOW_CORE,
    coreOpacity: 0.55,
    baseColor: PROCESS_PLATE_FILL,
    fadeOffset: '82%',
  });
  upsertRadialGradient(defs, ids.softId, {
    cx: 0.32,
    cy: 0.68,
    r: 0.6,
    coreColor: GLOW_SOFT,
    coreOpacity: 0.38,
    baseColor: PROCESS_PLATE_FILL,
    fadeOffset: '84%',
  });
  return ids;
}

/** Opaque base + two radial blooms — same geometry, scales with path on resize. */
export function appendProcessPlatePaths(
  parent: SVGElement,
  root: SVGSVGElement,
  plateKey: string,
  clipD: string,
  stroke?: ProcessPlateStroke
): void {
  const { coreId, softId } = ensureProcessPlateGradients(root, plateKey);

  const base = svgEl('path', { d: clipD });
  setFill(base, PROCESS_PLATE_FILL);
  setAttrs(base, {
    'data-process-plate-base': '1',
    'data-radius-body': '1',
    'data-baseline': '1',
  });
  if (stroke) setStroke(base, stroke);
  append(parent, base);

  for (const fillId of [coreId, softId]) {
    const glow = svgEl('path', {
      d: clipD,
      fill: urlRef(fillId),
      'pointer-events': 'none',
    });
    setAttrs(glow, { 'data-process-plate-glow': '1' });
    append(parent, glow);
  }
}

/** Keep all process plate paths in sync during live resize. */
export function syncProcessPlateGeometry(host: SVGElement, clipD: string): void {
  host.querySelectorAll('[data-process-plate-base], [data-process-plate-glow]').forEach((node) => {
    if (node instanceof SVGPathElement) node.setAttribute('d', clipD);
  });
}

/** Status pill foreignObject — gradient is SVG-only; FO is label chrome. */
export function syncProcessPillForeignObject(
  host: SVGElement | null | undefined,
  width: number,
  height: number
): void {
  if (!host) return;
  const box = processGlowForeignObjectBounds(width, height);
  const fo = host.querySelector(
    'foreignObject[data-rcb-process-glow]'
  ) as SVGForeignObjectElement | null;
  if (!fo) return;
  fo.setAttribute('x', String(box.x));
  fo.setAttribute('y', String(box.y));
  fo.setAttribute('width', String(box.width));
  fo.setAttribute('height', String(box.height));
}

/** Canvas idle underlay — matches SVG process plate blooms. */
export function paintProcessPlateCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opacity = 1
): void {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = PROCESS_PLATE_FILL;
  ctx.fillRect(0, 0, w, h);

  const bloom = (cx: number, cy: number, r: number, inner: string, fade: number) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, inner);
    g.addColorStop(fade, 'rgba(238, 242, 247, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };

  bloom(w * 0.58, h * 0.38, Math.max(w, h) * 0.65, 'rgba(175, 200, 230, 0.55)', 0.82);
  bloom(w * 0.32, h * 0.68, Math.max(w, h) * 0.6, 'rgba(210, 225, 240, 0.38)', 0.84);
  ctx.restore();
}

export { PROCESS_PLATE_FILL, PROCESS_PLATE_STROKE };
