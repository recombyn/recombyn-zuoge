import type { SceneNode, SceneNodeInput } from '@/components/rcb/sceneNode';
/**
 * Fill / shadow paint onto native SVG elements.
 */

import {
  ensureDefs,
  setAttrs,
  setFill,
  setStyles,
  svgEl,
  urlRef,
  XLINK_NS,
} from './svgDom';
import {
  resolveLinearCoords,
  stopsWithOpacity,
  type FillImageFit,
  type SvgPaint,
} from '../document/sceneFill';
import {
  resolveBackdropBlur,
  resolveInnerShadow,
  resolveObjectBlur,
  resolveShadow,
  type BackdropBlurSpec,
  type InnerShadowSpec,
  type ObjectBlurSpec,
  type ShadowSpec,
} from '../document/sceneEffects';

let paintSeq = 0;

function nextPaintId(prefix: string) {
  paintSeq += 1;
  return `${prefix}-${paintSeq}`;
}

function preserveAspectForFit(fit: FillImageFit) {
  if (fit === 'fit') return 'xMidYMid meet';
  if (fit === 'crop' || fit === 'fill') return 'xMidYMid slice';
  return 'none';
}

function tileSize(width: number, height: number) {
  return {
    w: Math.max(24, Math.round(width / 3)),
    h: Math.max(24, Math.round(height / 3)),
  };
}

/** Apply fill paint (solid / gradient / image pattern) onto an SVG element. */
export function applySvgFill(
  svg: SVGSVGElement,
  el: SVGElement,
  paint: SvgPaint,
  idHint = 'fill'
) {
  if (paint.kind === 'none') {
    setFill(el, 'none');
    return;
  }
  if (paint.kind === 'solid') {
    setFill(el, paint.color);
    return;
  }

  const defs = ensureDefs(svg);

  if (paint.kind === 'pattern') {
    const id = nextPaintId(idHint);
    const fit = paint.imageFit ?? 'fill';
    const rotate = paint.imageRotate ?? 0;
    const scalePct = Math.max(1, Number(paint.imageScale ?? 100));
    const offsetX = Number(paint.imageOffsetX ?? 0);
    const offsetY = Number(paint.imageOffsetY ?? 0);
    const filter = paint.imageFilter;
    const opacityPct = paint.opacityPct ?? 100;
    const tile = fit === 'tile' ? tileSize(paint.width, paint.height) : null;
    const patternW = tile?.w ?? paint.width;
    const patternH = tile?.h ?? paint.height;

    const pattern = svgEl('pattern', {
      id,
      width: patternW,
      height: patternH,
      patternUnits: 'userSpaceOnUse',
    });
    const img = svgEl('image', {
      width: patternW,
      height: patternH,
      preserveAspectRatio: preserveAspectForFit(fit),
    });
    img.setAttributeNS(XLINK_NS, 'href', paint.dataUrl);
    img.setAttribute('href', paint.dataUrl);
    if (filter) setStyles(img, { filter });
    const cx = patternW / 2;
    const cy = patternH / 2;
    const transforms: string[] = [];
    if (rotate) transforms.push(`rotate(${rotate} ${cx} ${cy})`);
    if (scalePct !== 100) transforms.push(`translate(${cx} ${cy}) scale(${scalePct / 100}) translate(${-cx} ${-cy})`);
    if (offsetX || offsetY) {
      transforms.push(`translate(${(offsetX / 100) * patternW} ${(offsetY / 100) * patternH})`);
    }
    if (transforms.length) img.setAttribute('transform', transforms.join(' '));
    pattern.appendChild(img);
    defs.appendChild(pattern);
    setFill(el, urlRef(id));
    el.setAttribute('fill-opacity', String(Math.max(0, Math.min(1, opacityPct / 100))));
    return;
  }

  const id = nextPaintId(idHint);
  const stops = stopsWithOpacity(paint.gradient.colorStops, paint.opacityPct);

  if (paint.kind === 'linear') {
    const c = resolveLinearCoords(paint.gradient);
    const grad = svgEl('linearGradient', {
      id,
      x1: `${c.x1 * 100}%`,
      y1: `${c.y1 * 100}%`,
      x2: `${c.x2 * 100}%`,
      y2: `${c.y2 * 100}%`,
      gradientUnits: 'objectBoundingBox',
    });
    for (const s of stops) {
      grad.appendChild(
        svgEl('stop', { offset: String(s.offset), 'stop-color': s.color })
      );
    }
    defs.appendChild(grad);
    setFill(el, urlRef(id));
    return;
  }

  const cx = (paint.gradient.cx ?? 50) / 100;
  const cy = (paint.gradient.cy ?? 50) / 100;
  const r = Math.max(0.01, (paint.gradient.r ?? 50) / 100);
  const grad = svgEl('radialGradient', {
    id,
    cx: `${cx * 100}%`,
    cy: `${cy * 100}%`,
    r: `${r * 100}%`,
    fx: `${cx * 100}%`,
    fy: `${cy * 100}%`,
    gradientUnits: 'objectBoundingBox',
  });
  for (const s of stops) {
    grad.appendChild(
      svgEl('stop', { offset: String(s.offset), 'stop-color': s.color })
    );
  }
  defs.appendChild(grad);
  setFill(el, urlRef(id));
}

export function applyNodeEffects(_svg: SVGSVGElement, el: SVGElement, node: SceneNodeInput) {
  applySvgEffects(_svg, el, {
    shadow: resolveShadow(node),
    innerShadow: resolveInnerShadow(node),
    object: resolveObjectBlur(node),
    backdrop: resolveBackdropBlur(node),
  });
}

function applySvgEffects(
  svg: SVGSVGElement,
  el: SVGElement,
  effects: {
    shadow: ShadowSpec;
    innerShadow: InnerShadowSpec;
    object: ObjectBlurSpec;
    backdrop: BackdropBlurSpec;
  }
) {
  const { shadow, innerShadow, object, backdrop } = effects;
  if (!shadow && !innerShadow && !object && !backdrop) {
    setStyles(el, { filter: null, 'backdrop-filter': null, '-webkit-backdrop-filter': null });
    return;
  }

  // `BackgroundImage` in SVG filters is disabled by modern
  // browsers in many nested/shared SVG setups. CSS backdrop-filter is the
  // primary interactive path; the SVG branch below remains for exported SVGs.
  const backdropFilter = backdrop
    ? `blur(${backdrop.blur}px) brightness(${backdrop.brightness}%)`
    : null;
  setStyles(el, {
    'backdrop-filter': backdropFilter,
    '-webkit-backdrop-filter': backdropFilter,
    // Give Chromium a compositing surface for backdrop-filter without
    // changing the node's visible fill or opacity.
    'background-color': backdrop ? 'rgba(255,255,255,0.001)' : null,
  });

  // BackgroundImage is not implemented consistently for live SVG filters.
  // Keep backdrop blur on the CSS backdrop-filter path; only build an SVG
  // filter when a source-alpha effect actually needs one.
  if (!shadow && !innerShadow && !object) {
    setStyles(el, { filter: null });
    return;
  }

  const id = nextPaintId('effect');
  const filter = svgEl('filter', {
    id,
    x: '-50%',
    y: '-50%',
    width: '200%',
    height: '200%',
    'color-interpolation-filters': 'sRGB',
  });
  const underlayResults: string[] = [];
  if (object && object.blur > 0) {
    filter.appendChild(
      svgEl('feGaussianBlur', {
        in: 'SourceGraphic',
        stdDeviation: object.blur / 2,
        result: 'objectBlur',
      })
    );
    underlayResults.push('objectBlur');
  }
  if (shadow) {
    filter.appendChild(
      svgEl('feDropShadow', {
        in: 'SourceAlpha',
        dx: shadow.offsetX,
        dy: shadow.offsetY,
        stdDeviation: shadow.blur / 2,
        'flood-color': shadow.color,
        result: 'dropShadow',
      })
    );
    underlayResults.push('dropShadow');
  }
  if (innerShadow) {
    filter.appendChild(
      svgEl('feGaussianBlur', {
        in: 'SourceAlpha',
        stdDeviation: innerShadow.blur / 2,
        result: 'innerBlur',
      })
    );
    filter.appendChild(
      svgEl('feOffset', {
        in: 'innerBlur',
        dx: innerShadow.offsetX,
        dy: innerShadow.offsetY,
        result: 'innerOffset',
      })
    );
    filter.appendChild(
      svgEl('feComposite', {
        in: 'innerOffset',
        in2: 'SourceAlpha',
        operator: 'in',
        result: 'innerCut',
      })
    );
    filter.appendChild(svgEl('feFlood', { 'flood-color': innerShadow.color, result: 'innerColor' }));
    filter.appendChild(
      svgEl('feComposite', { in: 'innerColor', in2: 'innerCut', operator: 'in', result: 'innerShadow' })
    );
  }
  const merge = svgEl('feMerge');
  for (const result of underlayResults) merge.appendChild(svgEl('feMergeNode', { in: result }));
  merge.appendChild(
    svgEl('feMergeNode', { in: object && object.blur > 0 ? 'objectBlur' : 'SourceGraphic' })
  );
  if (innerShadow) merge.appendChild(svgEl('feMergeNode', { in: 'innerShadow' }));
  filter.appendChild(merge);
  ensureDefs(svg).appendChild(filter);
  setStyles(el, { filter: urlRef(id) });
}
