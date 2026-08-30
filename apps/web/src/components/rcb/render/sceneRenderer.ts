/**
 * SceneRenderer — paint/hit backend boundary (ADR 0027).
 *
 * Business code should depend on this contract, not on SVG hosts or a specific
 * Canvas/WebGL library. `SvgSceneRenderer` adapts the live host pipeline;
 * `CanvasSceneRenderer` owns Canvas2D underlay paint (grid → shapes / paths / text).
 */
import type { SceneDocument, SceneNodeInput } from '@/components/rcb/sceneNode';
import type { RcbBox, RcbCamera, RcbVec } from '@/components/rcb/core/types';
import {
  SceneSpatialRuntime,
} from '@/components/rcb/core/spatialIndex';
import { rcbCameraCssZoom, rcbCameraScreenOffset, rcbViewportSceneBounds } from '@/components/rcb/core/math';
import { createCameraTransform, worldToScreen } from '@/components/rcb/camera/transform';
import { getShapeBaseline } from '@/components/rcb/core/geometry';
import { effectivePaintBox } from '@/components/rcb/core/transformPreview';
import { isImageProcessRunning } from '@/components/rcb/scene/document/nodeCapabilities';
import { PROCESS_PLATE_STROKE } from '@/components/rcb/process/processGlow';
import { paintProcessPlateCanvas } from '@/components/rcb/process/processPlateSvg';
import {
  hitTestSceneAtPoint,
  type SceneHitBox,
} from '@/components/rcb/scene/document/sceneHitBridge';
import {
  ellipseArcEndAngles,
  ellipseArcPercentFromAttrs,
  ellipseInnerRatioFromAttrs,
  ellipseStartDegFromAttrs,
  HEAVY_PATH_D_CHARS,
  sceneHitSlop,
  shapeVertexPoints,
  sidesFromAttrs,
  starInnerRatioFromAttrs,
} from '@/components/rcb/scene/document/sceneShapes';
import { resolveFillColor, resolveStroke, resolveStrokeAlign, resolveShadow, hexWithOpacity, boolEffectAttr, TEXT_FRAME_PADDING, TEXT_FRAME_RADIUS } from '@/components/rcb/scene/document/sceneEffects';
import { stackZIndex } from '@/components/rcb/scene/document/sceneDocument';
import { findClippingFrameForNode } from '@/components/rcb/frames/frameContentClip';
import {
  nodeNeedsPuppetWarp,
  readPuppetPins,
  samplePuppetPinsAtFrame,
} from '@/components/editor/nodes/ImageNode/puppet/puppetModel';
import { paintPuppetWarpedImage } from '@/components/rcb/scene/paint/puppetWarp';
import { getAnimationWorkbenchPlayheadSec } from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';
import { secToFrame } from '@/components/editor/nodes/AnimationNode/animationTimelineModel';
import {
  resolveFill,
  resolveLinearCoords,
  parseFillType,
  parseFillGradient,
  parseFillImageFit,
  parseFillImageRotate,
  parseFillImageAdjust,
  parseFillImageScale,
  parseFillImageOffset,
  fillImageTileSize,
  buildImageAdjustFilterCss,
  type FillStop,
  type FillGradient,
  type FillImageFit,
} from '@/components/rcb/scene/document/sceneFill';
import {
  bakeDiffuseMesh,
  normalizeMeshPoints,
} from '@/components/rcb/scene/document/sceneDiffuseMesh';
import {
  clampCornerRadii,
  radiiFromAttrs,
} from '@/components/rcb/scene/document/sceneRadii';
import {
  parseNodeText,
  parseNodeTextStyle,
  wrapPlainTextLines,
} from '@/components/rcb/scene/document/sceneText';
import { shouldShowPixelGrid } from '@/components/rcb/selection/alignGuides';
import { parseSimplePathPoints } from '@/components/rcb/tools/pencilBrushes';

/** Cap centerline samples when stroking a dense pencil/path as Canvas idle ink. */
export const CANVAS_IDLE_STROKE_MAX_PTS = 64;

export type SceneNodeId = string;

export type DirtyRegion =
  | { kind: 'full' }
  | { kind: 'aabb'; box: RcbBox }
  | { kind: 'nodes'; ids: readonly SceneNodeId[] };

export type SceneRenderRequest = {
  document: SceneDocument;
  camera: RcbCamera;
  dirty: DirtyRegion;
  /** Unscaled stage size (layout CSS px). */
  stage: { width: number; height: number };
  dpr?: number;
};

export type SceneRendererBackend = 'svg' | 'canvas2d';

export type SceneRenderer = {
  readonly backend: SceneRendererBackend;
  render(req: SceneRenderRequest): void;
  /**
   * World-space hit. Optional `screen` keeps SVG path DOM fallbacks available
   * for the svg backend until Path2D covers every shape.
   */
  hitTest(
    point: RcbVec,
    screen?: { clientX: number; clientY: number }
  ): SceneNodeId | null;
  dispose(): void;
};

export type SceneRendererHitDeps = {
  getDocument: () => SceneDocument | null | undefined;
  getSpatial: () => SceneSpatialRuntime;
  getZoom: () => number;
  listNodeIds: () => readonly string[];
  getNodeBox: (nodeId: string) => SceneHitBox | null;
  /**
   * Optional SVG hosts for DOM hit. Ignored unless {@link allowSvgDomHit}.
   * Prefer Path2D / AABB (ADR 0027).
   */
  getNodeEls?: () => Map<string, Element> | null | undefined;
  /** Default false — do not use live SVG DOM for precise hit. */
  allowSvgDomHit?: boolean;
};

/** Spatial coarse → precise geometry (shared by svg + canvas backends). */
export function hitTestWithSpatialIndex(
  deps: SceneRendererHitDeps,
  point: RcbVec,
  screen?: { clientX: number; clientY: number }
): SceneNodeId | null {
  const doc = deps.getDocument();
  const zoom = Math.max(0.05, deps.getZoom() || 1);
  const pad = sceneHitSlop(zoom);
  const order = doc
    ? deps.getSpatial().hitCandidateIds({
        x: point.x,
        y: point.y,
        pad: pad + 64 / zoom,
      })
    : [];
  const hitOrder = doc
    ? order.slice().sort((a, b) => {
        const zDiff = stackZIndex(doc, 'node', b) - stackZIndex(doc, 'node', a);
        return zDiff || order.indexOf(b) - order.indexOf(a);
      })
    : order;
  const allowSvgDomHit = deps.allowSvgDomHit === true;
  const hit =
    doc
      ? hitTestSceneAtPoint({
          document: doc,
          order: hitOrder,
          x: point.x,
          y: point.y,
          zoom,
          screen,
          getNodeBox: deps.getNodeBox,
          nodeEls: allowSvgDomHit ? (deps.getNodeEls?.() ?? null) : null,
          allowSvgDomHit,
        })
      : null;
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    const boxes = order.slice(0, 12).map((id) => {
      const box = deps.getNodeBox(id);
      return { id, box };
    });
    (window as unknown as { __rcbHitTrace?: unknown }).__rcbHitTrace = {
      point,
      zoom,
      doc: Boolean(doc),
      disposed: false,
      allIdsLen: doc ? deps.listNodeIds().length : 0,
      orderLen: order.length,
      orderHead: order.slice(0, 8),
      boxes,
      hit,
    };
  }
  return hit;
}

export function isFullDirty(dirty: DirtyRegion): boolean {
  return dirty.kind === 'full';
}

export function dirtyTouchesNode(dirty: DirtyRegion, nodeId: string): boolean {
  if (dirty.kind === 'full') return true;
  if (dirty.kind === 'nodes') return dirty.ids.includes(nodeId);
  return true;
}

/** Live SVG hosts remain the paint path; this adapter owns the hit contract. */
export function createSvgSceneRenderer(deps: SceneRendererHitDeps): SceneRenderer {
  let disposed = false;
  return {
    backend: 'svg',
    render(_req) {
      // Full hosts stay in RcbShapesLayer until more ink migrates to Canvas.
    },
    hitTest(point, screen) {
      // Never no-op hit after dispose — bridge may briefly retain this instance
      // across React effect reorder; precise hit is pure and safe.
      if (disposed && typeof window !== 'undefined') {
        (window as unknown as { __rcbHitDisposed?: boolean }).__rcbHitDisposed = true;
      }
      return hitTestWithSpatialIndex(deps, point, screen);
    },
    dispose() {
      disposed = true;
    },
  };
}

export type CanvasSceneRendererDeps = SceneRendererHitDeps & {
  canvas: HTMLCanvasElement;
  /** Debug AABB outlines (default false — idle Canvas has its own paint path). */
  drawNodeProxies?: boolean;
  /**
   * Paint filled rect / ellipse / circle for shape nodes in the viewport.
   * Default false on the stage underlay.
   */
  drawBasicShapes?: boolean;
  /**
   * Full Canvas idle paint (paths, text, shapes, media).
   * Stage ink overlay enables this and reads ids from `getSceneCanvasIdlePaint()`.
   */
  drawCanvasIdle?: boolean;
  /** Pixel / scene grid (default true). Gated by `shouldShowGrid`. */
  paintGrid?: boolean;
  gridSize?: number;
  getGridSize?: () => number;
  shouldShowGrid?: (zoom: number) => boolean;
};

/**
 * Canvas2D backend — clear + camera transform + grid + idle Canvas ink.
 * Hit uses the same spatial index path as the svg adapter.
 */
export function createCanvasSceneRenderer(deps: CanvasSceneRendererDeps): SceneRenderer {
  let disposed = false;
  const canvas = deps.canvas;
  const drawProxies = deps.drawNodeProxies === true;
  const drawBasic = deps.drawBasicShapes === true;
  const drawIdle = deps.drawCanvasIdle === true;
  const paintGrid = deps.paintGrid !== false;
  const shouldShowGrid = deps.shouldShowGrid ?? shouldShowPixelGrid;

  const resolveGridSize = () => {
    const fromGetter = deps.getGridSize?.();
    if (fromGetter != null && fromGetter > 0) return fromGetter;
    return Math.max(1, deps.gridSize || 8);
  };

  const getCtx = () => {
    try {
      return canvas.getContext('2d');
    } catch {
      return null;
    }
  };

  return {
    backend: 'canvas2d',
    render(req) {
      if (disposed) return;
      const ctx = getCtx();
      if (!ctx) return;
      const dpr = req.dpr && req.dpr > 0 ? req.dpr : 1;
      const sw = Math.max(1, req.stage.width);
      const sh = Math.max(1, req.stage.height);
      const bw = Math.max(1, Math.round(sw * dpr));
      const bh = Math.max(1, Math.round(sh * dpr));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      canvas.style.width = `${sw}px`;
      canvas.style.height = `${sh}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, sw, sh);

      const z = rcbCameraCssZoom(req.camera);
      const pan = rcbCameraScreenOffset(req.camera, dpr);
      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(z, z);

      const view = rcbViewportSceneBounds(req.camera, { width: sw, height: sh }, dpr);
      const gridSize = resolveGridSize();

      if (paintGrid && shouldShowGrid(z)) {
        drawSceneGrid(ctx, view, gridSize, z);
      }

      if (drawIdle || drawBasic || drawProxies) {
        const doc = req.document;
        const ids = deps.listNodeIds();
        for (const id of ids) {
          if (!dirtyTouchesNode(req.dirty, id)) continue;
          const box = deps.getNodeBox(id);
          if (!box) continue;
          const node = doc.deltaSetLike?.[id] as SceneNodeInput | undefined;
          if (!node) continue;
          const paint = effectivePaintBox(id, box, Number(node.attrs?.angle) || 0);
          if (
            !aabbIntersectsView(
              {
                left: paint.left,
                top: paint.top,
                width: paint.width,
                height: paint.height,
              },
              view
            )
          ) {
            continue;
          }
          if (drawIdle) {
            paintCanvasIdleNode(ctx, {
              left: paint.left,
              top: paint.top,
              width: paint.width,
              height: paint.height,
              angle: paint.angle,
              node,
              zoom: z,
              document: doc,
            });
          } else if (drawBasic) {
            paintBasicShapeFill(ctx, {
              left: paint.left,
              top: paint.top,
              width: paint.width,
              height: paint.height,
              angle: paint.angle,
              fill: resolveNodeProxyFill(node),
              shapeType: String(node.attrs?.shapeType || node.key || ''),
              opacity: Math.min(1, Math.max(0.15, Number(node.attrs?.opacity) || 1)),
            });
          }
          if (drawProxies) {
            ctx.fillStyle = 'rgba(51,136,255,0.06)';
            ctx.strokeStyle = 'rgba(51,136,255,0.35)';
            ctx.lineWidth = 1 / z;
            ctx.fillRect(paint.left, paint.top, paint.width, paint.height);
            ctx.strokeRect(paint.left, paint.top, paint.width, paint.height);
          }
        }
      }
      ctx.restore();
    },
    hitTest(point, screen) {
      // Same as svg adapter: do not no-op hit after dispose while a bridge may
      // still point here across React effect reorder.
      if (disposed && typeof window !== 'undefined') {
        (window as unknown as { __rcbHitDisposed?: boolean }).__rcbHitDisposed = true;
      }
      return hitTestWithSpatialIndex(deps, point, screen);
    },
    dispose() {
      disposed = true;
      const ctx = getCtx();
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    },
  };
}

function aabbIntersectsView(
  box: SceneHitBox,
  view: RcbBox
): boolean {
  return (
    box.left < view.x + view.width &&
    box.left + box.width > view.x &&
    box.top < view.y + view.height &&
    box.top + box.height > view.y
  );
}

/** Match SVG pixel-grid stroke: ~1 screen px, capped vs cell size. */
export function sceneGridLineWidth(gridSize: number, zoom: number): number {
  const g = gridSize > 0 ? gridSize : 1;
  const z = Math.max(0.05, zoom || 1);
  return Math.min(g * 0.35, 1 / z);
}

/**
 * Scene-space lattice for the Canvas underlay (camera already applied on ctx).
 * Axes are exact multiples of `gridSize` — same lattice as `snapCoordToGrid` /
 * pen tips. Do not device-snap axes here: that shifted lines off the snap grid
 * (visible mid-cell tips / off-grid plates at high zoom).
 */
export function drawSceneGrid(
  ctx: CanvasRenderingContext2D,
  view: RcbBox,
  gridSize: number,
  zoom = 1
) {
  const g = gridSize > 0 ? gridSize : 1;
  const z = Math.max(0.05, zoom || 1);
  const x0 = Math.floor(view.x / g) * g;
  const y0 = Math.floor(view.y / g) * g;
  const x1 = view.x + view.width;
  const y1 = view.y + view.height;
  const lineW = sceneGridLineWidth(g, z);

  ctx.beginPath();
  ctx.strokeStyle = resolveGridStrokeStyle();
  ctx.lineWidth = lineW;
  ctx.lineCap = 'butt';
  for (let x = x0; x <= x1 + 1e-6; x += g) {
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
  }
  for (let y = y0; y <= y1 + 1e-6; y += g) {
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
  }
  ctx.stroke();
}

function resolveGridStrokeStyle(): string {
  if (typeof document === 'undefined') return 'rgba(120,120,120,0.35)';
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--line').trim();
    if (raw) return mixLineStroke(raw, 0.5);
  } catch {
    /* ignore */
  }
  return 'rgba(120,120,120,0.35)';
}

function mixLineStroke(cssColor: string, alpha: number): string {
  const c = cssColor.trim();
  if (c.startsWith('#') && (c.length === 7 || c.length === 4)) {
    const hex =
      c.length === 4
        ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`
        : c;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if ([r, g, b].every((n) => Number.isFinite(n))) {
      return `rgba(${r},${g},${b},${alpha})`;
    }
  }
  return `color-mix(in srgb, ${c} ${Math.round(alpha * 100)}%, transparent)`;
}

export function resolveNodeProxyFill(node: SceneNodeInput): string {
  const a = node?.attrs || {};
  const solid = String(a['fill-color'] || '').trim();
  if (solid && solid !== 'none' && solid !== 'transparent') return solid;
  const fillType = parseFillType(a['fill-type']);
  if (fillType !== 'solid' && fillType !== 'image' && a['fill-gradient'] != null) {
    const g = parseFillGradient(a['fill-gradient'], fillType, solid || '#FFFFFF');
    const stop = String(g.colorStops?.[0]?.color || '').trim();
    if (stop && stop !== 'none' && stop !== 'transparent') return stop;
  }
  const stroke = String(a['border-color'] || '').trim();
  if (stroke && stroke !== 'none' && stroke !== 'transparent') return stroke;
  return '#94a3b8';
}

export type BasicShapePaintOpts = {
  left: number;
  top: number;
  width: number;
  height: number;
  angle?: number;
  fill: string;
  shapeType: string;
  opacity?: number;
};

/**
 * Filled rect / ellipse / circle (Canvas idle + CanvasSceneRenderer basic shapes).
 * Local origin when angle≠0: caller may already have translated; here we own transform.
 */
export function paintBasicShapeFill(
  ctx: CanvasRenderingContext2D,
  opts: BasicShapePaintOpts
): void {
  const w = Math.max(1, opts.width);
  const h = Math.max(1, opts.height);
  const left = opts.left;
  const top = opts.top;
  const angle = Number(opts.angle) || 0;
  const opacity = Math.min(1, Math.max(0.05, opts.opacity ?? 1));
  const t = String(opts.shapeType || '').toLowerCase();
  const isEllipse = t === 'ellipse' || t === 'circle' || t === 'oval';

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = opts.fill || '#94a3b8';

  if (Math.abs(angle) > 0.5) {
    const cx = left + w / 2;
    const cy = top + h / 2;
    ctx.translate(cx, cy);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.translate(-w / 2, -h / 2);
    if (isEllipse) {
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(0, 0, w, h);
    }
  } else if (isEllipse) {
    ctx.beginPath();
    ctx.ellipse(left + w / 2, top + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillRect(left, top, w, h);
  }
  ctx.restore();
}

function isTransparentCssColor(c: string): boolean {
  const s = String(c || '')
    .trim()
    .toLowerCase();
  return !s || s === 'none' || s === 'transparent' || s === 'rgba(0,0,0,0)';
}

/**
 * Idle nodes that can leave SVG hosts for Canvas2D underlay/overlay paint (ADR 0027 S3).
 *
 * Allowed: solid / linear / radial / angular / image / diffuse fills,
 * center-aligned stroke, drop shadow, rect/ellipse/line/light path,
 * and image / video media (poster or decoded src).
 *
 * Still SVG: lottie/audio/group/text, non-center strokeAlign, inner/backdrop/blur,
 * heavy paths, donut·arc ellipses, blend modes other than normal, polygons/stars.
 */
export function canIdlePaintOnCanvas(node: SceneNodeInput | null | undefined): boolean {
  if (!node) return false;
  if (isImageProcessRunning(node)) return false;
  const key = String(node.key || '');
  if (key === 'lottie' || key === 'audio' || key === 'group' || key === 'text') {
    return false;
  }

  const attrs = node.attrs || {};
  const blend = String(attrs.blendMode || attrs['blend-mode'] || 'normal')
    .trim()
    .toLowerCase();
  if (blend && blend !== 'normal' && blend !== 'pass-through' && blend !== 'passthrough') {
    return false;
  }

  if (
    boolEffectAttr(attrs['inner-shadow-enabled'], false) ||
    boolEffectAttr(attrs['backdrop-blur-enabled'], false) ||
    boolEffectAttr(attrs['blur-enabled'], false)
  ) {
    return false;
  }

  // Canvas stroke is centered; outside/inside stay on SVG until strokeAlign paint lands.
  if (resolveStrokeAlign(attrs) !== 'center') return false;

  if (key === 'image' || key === 'video') {
    return true;
  }

  const fillType = String(attrs['fill-type'] || 'solid').toLowerCase();
  if (
    fillType !== 'solid' &&
    fillType !== '' &&
    fillType !== 'linear' &&
    fillType !== 'radial' &&
    fillType !== 'angular' &&
    fillType !== 'image' &&
    fillType !== 'diffuse'
  ) {
    return false;
  }

  const t = String(attrs.shapeType || (key === 'shape' ? 'rect' : key) || '').toLowerCase();
  if (t === 'rect' || t === 'roundrect' || t === '') return true;
  if (t === 'circle' || t === 'ellipse' || t === 'oval') {
    if (ellipseInnerRatioFromAttrs(attrs) > 1e-6) return false;
    const arc = ellipseArcPercentFromAttrs(attrs);
    if (arc > 0 && arc < 100 - 1e-6) return false;
    return true;
  }
  if (t === 'line' || t === 'arrow') return true;

  if (t === 'pen' || t === 'pencil' || t === 'path' || key === 'path') {
    const d = String(attrs.path || '').trim();
    if (!d) return false;
    if (d.length >= HEAVY_PATH_D_CHARS) return false;
    return true;
  }

  return false;
}

function addCanvasGradientStops(
  gradient: CanvasGradient,
  stops: FillStop[] | undefined,
  opacityPct: number
) {
  const global = Math.max(0, Math.min(100, Number(opacityPct) || 100)) / 100;
  const list =
    Array.isArray(stops) && stops.length
      ? stops
      : [
          { offset: 0, color: '#000' },
          { offset: 1, color: '#fff' },
        ];
  for (const s of list) {
    const local = Math.max(0, Math.min(100, Number(s.opacity ?? 100))) / 100;
    const offset = Math.max(0, Math.min(1, Number(s.offset) || 0));
    const color = hexWithOpacity(String(s.color || '#000'), Math.round(global * local * 100));
    try {
      gradient.addColorStop(offset, color);
    } catch {
      /* ignore invalid stop */
    }
  }
}

/**
 * Match `bakeAngularGradientDataUrl`: start = (angle - 90)° in radians, center from cx/cy %.
 * Returns null when `createConicGradient` is unavailable.
 */
export function createCanvasAngularGradient(
  ctx: CanvasRenderingContext2D,
  gradient: FillGradient,
  w: number,
  h: number,
  opacityPct = 100
): CanvasGradient | null {
  const createConic = (
    ctx as CanvasRenderingContext2D & {
      createConicGradient?: (startAngle: number, x: number, y: number) => CanvasGradient;
    }
  ).createConicGradient;
  if (typeof createConic !== 'function') return null;
  const cx = (Math.max(0, Math.min(100, Number(gradient.cx) || 50)) / 100) * w;
  const cy = (Math.max(0, Math.min(100, Number(gradient.cy) || 50)) / 100) * h;
  const start = (((Number(gradient.angle) || 0) - 90) * Math.PI) / 180;
  const g = createConic.call(ctx, start, cx, cy);
  addCanvasGradientStops(g, gradient.colorStops, opacityPct);
  return g;
}

/**
 * Canvas fill style for a node box (local 0,0 → w×h).
 * Returns null when there is no fill, or when the fill is image/diffuse (use `fillCanvasShapeGeometry`).
 * Angular uses native conic when available; otherwise falls back to radial.
 */
export function resolveCanvasFillStyle(
  ctx: CanvasRenderingContext2D,
  node: SceneNodeInput,
  w: number,
  h: number,
  fallback = '#FFFFFF'
): string | CanvasGradient | null {
  const attrs = node.attrs || {};
  const fillType = parseFillType(attrs['fill-type']);
  const opacityPct = Number(attrs['fill-opacity'] ?? 100);

  if (fillType === 'image' || fillType === 'diffuse') return null;

  // resolveFill bakes angular → pattern for SVG; handle conic natively here.
  if (fillType === 'angular') {
    const solid = String(attrs['fill-color'] || fallback);
    const gradient = parseFillGradient(attrs['fill-gradient'], 'angular', solid);
    gradient.type = 'angular';
    const conic = createCanvasAngularGradient(ctx, gradient, w, h, opacityPct);
    if (conic) return conic;
    // No conic API: approximate with radial so idle Canvas still paints something.
    const cx = ((Number(gradient.cx) || 50) / 100) * w;
    const cy = ((Number(gradient.cy) || 50) / 100) * h;
    const halfDiag = Math.sqrt(w * w + h * h) / 2;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, halfDiag));
    addCanvasGradientStops(g, gradient.colorStops, opacityPct);
    return g;
  }

  const paint = resolveFill(node, fallback);
  if (paint.kind === 'none') return null;
  if (paint.kind === 'solid') return paint.color;
  if (paint.kind === 'linear') {
    const c = resolveLinearCoords(paint.gradient);
    const g = ctx.createLinearGradient(c.x1 * w, c.y1 * h, c.x2 * w, c.y2 * h);
    addCanvasGradientStops(g, paint.gradient.colorStops, paint.opacityPct);
    return g;
  }
  if (paint.kind === 'radial') {
    const cx = ((Number(paint.gradient.cx) || 50) / 100) * w;
    const cy = ((Number(paint.gradient.cy) || 50) / 100) * h;
    const halfDiag = Math.sqrt(w * w + h * h) / 2;
    const r = Math.max(1, halfDiag * ((Number(paint.gradient.r) || 50) / 100));
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    addCanvasGradientStops(g, paint.gradient.colorStops, paint.opacityPct);
    return g;
  }
  return null;
}

/** Cap diffuse bake resolution (matches `bakeDiffuseMeshDataUrl`). */
const DIFFUSE_BAKE_MAX_SIDE = 384;
const FILL_IMAGE_CACHE_MAX = 64;
const DIFFUSE_BAKE_CACHE_MAX = 24;

const fillImageCache = new Map<string, CanvasImageSource>();
const diffuseBakeCache = new Map<string, HTMLCanvasElement>();

export function imageSourceSize(img: CanvasImageSource): { iw: number; ih: number } {
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) {
    return { iw: img.naturalWidth || img.width || 1, ih: img.naturalHeight || img.height || 1 };
  }
  if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) {
    return { iw: img.width || 1, ih: img.height || 1 };
  }
  const anyImg = img as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
  return {
    iw: anyImg.naturalWidth || anyImg.width || 1,
    ih: anyImg.naturalHeight || anyImg.height || 1,
  };
}

/** Sync image ready for fill paint. Starts decode when missing; on load bumps idle ink. */
export function getFillImageReady(src: string): CanvasImageSource | null {
  const url = String(src || '').trim();
  if (!url) return null;
  const cached = fillImageCache.get(url);
  if (cached) {
    if (typeof HTMLImageElement !== 'undefined' && cached instanceof HTMLImageElement) {
      if (cached.complete && (cached.naturalWidth || cached.width)) return cached;
      return null;
    }
    return cached;
  }
  if (typeof Image === 'undefined') return null;
  if (fillImageCache.size >= FILL_IMAGE_CACHE_MAX) {
    const oldest = fillImageCache.keys().next().value;
    if (oldest != null) fillImageCache.delete(oldest);
  }
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  fillImageCache.set(url, img);
  if (img.complete && (img.naturalWidth || img.width)) return img;
  if (!(img as HTMLImageElement & { __fillNotify?: boolean }).__fillNotify) {
    (img as HTMLImageElement & { __fillNotify?: boolean }).__fillNotify = true;
    img.addEventListener(
      'load',
      () => {
        bumpSceneCanvasIdlePaint();
      },
      { once: true }
    );
  }
  return null;
}

/** Test helper: seed a decoded fill image / canvas (skips network / decode). */
export function setFillImageCacheEntry(src: string, img: CanvasImageSource): void {
  const url = String(src || '').trim();
  if (!url) return;
  fillImageCache.set(url, img);
}

/** Test / dispose helper. */
export function clearFillImageCache(): void {
  fillImageCache.clear();
  diffuseBakeCache.clear();
}

function getDiffuseBakeCanvas(
  node: SceneNodeInput,
  w: number,
  h: number
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const attrs = node.attrs || {};
  const solid = String(attrs['fill-color'] || '#CCCCCC');
  const opacityPct = Number(attrs['fill-opacity'] ?? 100);
  const gradient = parseFillGradient(attrs['fill-gradient'], 'diffuse', solid);
  gradient.type = 'diffuse';
  const meshSizeRaw = Number(gradient.meshSize) || 4;
  const meshSize = Math.min(8, Math.max(3, Math.round(meshSizeRaw))) as 3 | 4 | 5 | 6 | 7 | 8;
  const points = normalizeMeshPoints(gradient.meshPoints, meshSize, solid);
  const scale = Math.min(1, DIFFUSE_BAKE_MAX_SIDE / Math.max(w, h, 1));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const key = `${cw}x${ch}:${opacityPct}:${meshSize}:${points.map((p) => `${p.x},${p.y},${p.color}`).join(';')}`;
  const hit = diffuseBakeCache.get(key);
  if (hit) return hit;
  let baked: HTMLCanvasElement;
  try {
    baked = bakeDiffuseMesh(cw, ch, points, opacityPct);
  } catch {
    return null;
  }
  if (diffuseBakeCache.size >= DIFFUSE_BAKE_CACHE_MAX) {
    const oldest = diffuseBakeCache.keys().next().value;
    if (oldest != null) diffuseBakeCache.delete(oldest);
  }
  diffuseBakeCache.set(key, baked);
  return baked;
}

/** Draw source into box with SVG-aligned fit (fit=contain, fill/crop=cover, tile=repeat cell). */
export function drawFillImageInBox(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  boxW: number,
  boxH: number,
  fit: FillImageFit,
  rotate: number,
  opts?: {
    scalePct?: number;
    offsetXPct?: number;
    offsetYPct?: number;
  }
): void {
  const { iw, ih } = imageSourceSize(img);
  if (iw < 1 || ih < 1) return;
  const scaleMul = Math.max(0.01, Number(opts?.scalePct ?? 100) / 100);
  const offsetXPct = Number(opts?.offsetXPct ?? 0);
  const offsetYPct = Number(opts?.offsetYPct ?? 0);

  if (fit === 'tile') {
    const tile = fillImageTileSize(iw, ih, opts?.scalePct ?? 100);
    const scale = Math.max(tile.w / iw, tile.h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const ox = (tile.w - dw) / 2 + (offsetXPct / 100) * tile.w;
    const oy = (tile.h - dh) / 2 + (offsetYPct / 100) * tile.h;
    for (let y = 0; y < boxH; y += tile.h) {
      for (let x = 0; x < boxW; x += tile.w) {
        ctx.drawImage(img, x + ox, y + oy, dw, dh);
      }
    }
    return;
  }

  ctx.save();
  ctx.translate(boxW / 2, boxH / 2);
  if (rotate) ctx.rotate((rotate * Math.PI) / 180);
  const destW = boxW;
  const destH = boxH;
  // SVG: fit → meet (contain); fill/crop → slice (cover).
  const baseScale =
    fit === 'fit' ? Math.min(destW / iw, destH / ih) : Math.max(destW / iw, destH / ih);
  const scale = baseScale * scaleMul;
  const dw = iw * scale;
  const dh = ih * scale;
  const ox = (offsetXPct / 100) * destW;
  const oy = (offsetYPct / 100) * destH;
  ctx.drawImage(img, -dw / 2 + ox, -dh / 2 + oy, dw, dh);
  ctx.restore();
}

function createImageOrDiffusePattern(
  ctx: CanvasRenderingContext2D,
  node: SceneNodeInput,
  w: number,
  h: number
): CanvasPattern | null {
  const attrs = node.attrs || {};
  const fillType = parseFillType(attrs['fill-type']);
  if (!boolEffectAttr(attrs['fill-enabled'], true)) return null;
  if (!boolEffectAttr(attrs['fill-visible'], true)) return null;

  let source: CanvasImageSource | null = null;
  let fit: FillImageFit = 'fill';
  let rotate = 0;
  let filterCss = 'none';
  let opacityPct = Number(attrs['fill-opacity'] ?? 100);
  let imageScale = 100;
  let imageOffsetX = 0;
  let imageOffsetY = 0;

  if (fillType === 'image') {
    const src = String(attrs['fill-image-src'] || '').trim();
    if (!src) return null;
    source = getFillImageReady(src);
    if (!source) return null;
    fit = parseFillImageFit(attrs['fill-image-fit']);
    rotate = parseFillImageRotate(attrs['fill-image-rotate']);
    filterCss = buildImageAdjustFilterCss(parseFillImageAdjust(attrs['fill-image-adjust']));
    imageScale = parseFillImageScale(attrs['fill-image-scale']);
    imageOffsetX = parseFillImageOffset(attrs['fill-image-offset-x']);
    imageOffsetY = parseFillImageOffset(attrs['fill-image-offset-y']);
  } else if (fillType === 'diffuse') {
    source = getDiffuseBakeCanvas(node, w, h);
    if (!source) return null;
    fit = 'fill';
    rotate = 0;
    // Opacity already baked into mesh pixels.
    opacityPct = 100;
  } else {
    return null;
  }

  if (typeof document === 'undefined') return null;
  const { iw, ih } = imageSourceSize(source);
  const tile = fit === 'tile' ? fillImageTileSize(iw, ih, imageScale) : null;
  const pw = tile?.w ?? Math.max(1, Math.round(w));
  const ph = tile?.h ?? Math.max(1, Math.round(h));
  const canvas = document.createElement('canvas');
  canvas.width = pw;
  canvas.height = ph;
  const tctx = canvas.getContext('2d');
  if (!tctx) return null;
  if (filterCss && filterCss !== 'none') {
    try {
      tctx.filter = filterCss;
    } catch {
      /* ignore */
    }
  }
  const alpha = Math.max(0, Math.min(100, opacityPct)) / 100;
  tctx.globalAlpha = alpha;
  drawFillImageInBox(tctx, source, pw, ph, fit === 'tile' ? 'crop' : fit, rotate, {
    scalePct: fit === 'tile' ? 100 : imageScale,
    offsetXPct: imageOffsetX,
    offsetYPct: imageOffsetY,
  });
  tctx.filter = 'none';
  tctx.globalAlpha = 1;
  try {
    return ctx.createPattern(canvas, fit === 'tile' ? 'repeat' : 'no-repeat');
  } catch {
    return null;
  }
}

/**
 * Fill current path or Path2D with solid/gradient/image/diffuse.
 * Image uses cached decode; diffuse uses IDW bake (capped resolution).
 */
export function fillCanvasShapeGeometry(
  ctx: CanvasRenderingContext2D,
  opts: {
    node: SceneNodeInput;
    width: number;
    height: number;
    path?: Path2D;
    fillRule?: CanvasFillRule;
    /** When no Path2D: caller builds the current path inside this callback. */
    trace?: () => void;
  }
): void {
  const { node, width: w, height: h, path, fillRule, trace } = opts;
  const attrs = node.attrs || {};
  const fillType = parseFillType(attrs['fill-type']);

  applyCanvasDropShadow(ctx, node);

  if (fillType === 'image' || fillType === 'diffuse') {
    const pattern = createImageOrDiffusePattern(ctx, node, w, h);
    if (pattern) {
      ctx.fillStyle = pattern;
      if (path) {
        if (fillRule) ctx.fill(path, fillRule);
        else ctx.fill(path);
      } else {
        trace?.();
        if (fillRule) ctx.fill(fillRule);
        else ctx.fill();
      }
    }
    clearCanvasDropShadow(ctx);
    return;
  }

  const fillStyle = resolveCanvasFillStyle(ctx, node, w, h, '#FFFFFF');
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    if (path) {
      if (fillRule) ctx.fill(path, fillRule);
      else ctx.fill(path);
    } else {
      trace?.();
      if (fillRule) ctx.fill(fillRule);
      else ctx.fill();
    }
  }
  clearCanvasDropShadow(ctx);
}

function applyCanvasDropShadow(ctx: CanvasRenderingContext2D, node: SceneNodeInput): void {
  const shadow = resolveShadow(node);
  if (!shadow) {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    return;
  }
  ctx.shadowColor = shadow.color;
  ctx.shadowBlur = shadow.blur;
  ctx.shadowOffsetX = shadow.offsetX;
  ctx.shadowOffsetY = shadow.offsetY;
}

function clearCanvasDropShadow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

/**
 * Trace donut / arc / polygon / star / triangle from the same baseline `d` as SVG
 * when Path2D is available; otherwise a Canvas-native fallback (happy-dom / older engines).
 * Returns true when geo ink was painted.
 */
function paintCanvasShapeInkViaBaseline(
  ctx: CanvasRenderingContext2D,
  opts: {
    node: SceneNodeInput;
    width: number;
    height: number;
    shapeType: string;
    stroke: string;
    strokeWidth: number;
  }
): boolean {
  const { node, width: w, height: h, shapeType, stroke, strokeWidth } = opts;
  const isEllipse =
    shapeType === 'ellipse' || shapeType === 'circle' || shapeType === 'oval';
  const isPolyStar =
    shapeType === 'triangle' || shapeType === 'star' || shapeType === 'polygon';
  if (!isEllipse && !isPolyStar) return false;

  const baselineShapeType = isEllipse ? 'circle' : shapeType;
  const useEvenodd = isEllipse && ellipseInnerRatioFromAttrs(node.attrs) > 1e-4;

  if (typeof Path2D !== 'undefined') {
    const baseline = getShapeBaseline(
      {
        key: 'shape',
        width: w,
        height: h,
        attrs: { ...(node.attrs || {}), shapeType: baselineShapeType },
      } as SceneNodeInput,
      { width: w, height: h }
    );
    const d = String(baseline?.d || '').trim();
    if (d) {
      try {
        const path = new Path2D(d);
        fillCanvasShapeGeometry(ctx, {
          node,
          width: w,
          height: h,
          path,
          fillRule: useEvenodd ? 'evenodd' : undefined,
        });
        if (strokeWidth > 0 && !isTransparentCssColor(stroke)) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = strokeWidth;
          ctx.stroke(path);
        }
        return true;
      } catch {
        /* fall through to native */
      }
    }
  }

  if (isEllipse) {
    return paintEllipseVariantNative(ctx, {
      node,
      width: w,
      height: h,
      stroke,
      strokeWidth,
    });
  }
  return paintPolyStarNative(ctx, {
    node,
    width: w,
    height: h,
    shapeType: baselineShapeType,
    stroke,
    strokeWidth,
  });
}

/** Full disk / donut / pie / annular sector without Path2D. */
function paintEllipseVariantNative(
  ctx: CanvasRenderingContext2D,
  opts: {
    node: SceneNodeInput;
    width: number;
    height: number;
    stroke: string;
    strokeWidth: number;
  }
): boolean {
  const { node, width: w, height: h, stroke, strokeWidth } = opts;
  const cx = w / 2;
  const cy = h / 2;
  const rx = Math.max(0.5, w / 2);
  const ry = Math.max(0.5, h / 2);
  const inner = ellipseInnerRatioFromAttrs(node.attrs);
  const arcPct = ellipseArcPercentFromAttrs(node.attrs);
  const startDeg = ellipseStartDegFromAttrs(node.attrs);
  const full = Math.abs(arcPct) >= 99.5;
  const hasHole = inner > 1e-4;
  const irx = Math.max(0.25, rx * inner);
  const iry = Math.max(0.25, ry * inner);
  const { a0, a1 } = ellipseArcEndAngles(arcPct, startDeg);
  const ccw = arcPct < 0;

  const traceEllipse = () => {
    ctx.beginPath();
    if (full && !hasHole) {
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    } else if (full && hasHole) {
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.ellipse(cx, cy, irx, iry, 0, 0, Math.PI * 2, true);
    } else if (!hasHole) {
      ctx.moveTo(cx, cy);
      ctx.ellipse(cx, cy, rx, ry, 0, a0, a1, ccw);
      ctx.closePath();
    } else {
      ctx.ellipse(cx, cy, rx, ry, 0, a0, a1, ccw);
      ctx.ellipse(cx, cy, irx, iry, 0, a1, a0, !ccw);
      ctx.closePath();
    }
  };

  fillCanvasShapeGeometry(ctx, {
    node,
    width: w,
    height: h,
    fillRule: hasHole ? 'evenodd' : undefined,
    trace: traceEllipse,
  });
  if (strokeWidth > 0 && !isTransparentCssColor(stroke)) {
    traceEllipse();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
  return true;
}

/** Sharp triangle / polygon / star without Path2D (vertex radii omitted). */
function paintPolyStarNative(
  ctx: CanvasRenderingContext2D,
  opts: {
    node: SceneNodeInput;
    width: number;
    height: number;
    shapeType: string;
    stroke: string;
    strokeWidth: number;
  }
): boolean {
  const { node, width: w, height: h, shapeType, stroke, strokeWidth } = opts;
  const pts = shapeVertexPoints(
    shapeType,
    w,
    h,
    sidesFromAttrs(node.attrs),
    starInnerRatioFromAttrs(node.attrs)
  );
  if (pts.length < 3) return false;

  const tracePoly = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.closePath();
  };

  fillCanvasShapeGeometry(ctx, {
    node,
    width: w,
    height: h,
    trace: tracePoly,
  });
  if (strokeWidth > 0 && !isTransparentCssColor(stroke)) {
    tracePoly();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
  return true;
}

/** Local-origin fill + stroke ink for idle Canvas shapes (0,0 → w×h). */
export function paintCanvasShapeInk(
  ctx: CanvasRenderingContext2D,
  opts: {
    node: SceneNodeInput;
    width: number;
    height: number;
    opacity?: number;
  }
): void {
  const node = opts.node;
  const w = Math.max(1, opts.width);
  const h = Math.max(1, opts.height);
  const opacity = Math.min(1, Math.max(0.05, opts.opacity ?? 1));
  const { stroke, strokeWidth } = resolveStroke(node, '#333333');
  const t = String(node.attrs?.shapeType || 'rect').toLowerCase();
  const isEllipse = t === 'ellipse' || t === 'circle' || t === 'oval';

  ctx.save();
  ctx.globalAlpha = opacity;

  if (
    paintCanvasShapeInkViaBaseline(ctx, {
      node,
      width: w,
      height: h,
      shapeType: t,
      stroke,
      strokeWidth,
    })
  ) {
    ctx.restore();
    return;
  }

  const trace = () => {
    if (isEllipse) {
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else {
      const r = clampCornerRadii(radiiFromAttrs(node.attrs), w, h);
      traceRoundedRectLocal(ctx, w, h, r);
    }
  };

  fillCanvasShapeGeometry(ctx, {
    node,
    width: w,
    height: h,
    trace,
  });
  // Stroke without shadow so the outline stays sharp.
  if (strokeWidth > 0 && !isTransparentCssColor(stroke)) {
    trace();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Pen / pencil / path ink in local node space.
 * Pencil ribbons are closed filled outlines; pen/line stroke the path `d`.
 * Falls back to subsampled centerline when Path2D is unavailable.
 */
export function paintCanvasPathInk(
  ctx: CanvasRenderingContext2D,
  opts: {
    node: SceneNodeInput;
    width: number;
    height: number;
    opacity?: number;
    zoom?: number;
  }
): void {
  const node = opts.node;
  const w = Math.max(1, opts.width);
  const h = Math.max(1, opts.height);
  const opacity = Math.min(1, Math.max(0.05, opts.opacity ?? 1));
  const d = String(node.attrs?.path || '');
  const t = String(node.attrs?.shapeType || node.key || '').toLowerCase();
  const isPencil = t === 'pencil';
  const strokeOnly = canvasIdleIsStrokeOnly(node);
  const paintColor = resolveNodeProxyFill(node);
  const { stroke, strokeWidth } = resolveStroke(node, paintColor || '#333333');
  const lineW =
    strokeWidth > 0
      ? strokeWidth
      : canvasIdleStrokeWidth(node, opts.zoom ?? 1);

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (typeof Path2D !== 'undefined' && d.trim()) {
    try {
      const path = new Path2D(d);
      if (isPencil) {
        ctx.fillStyle = paintColor;
        ctx.fill(path);
      } else if (!strokeOnly) {
        const fill = resolveFillColor(node, '#FFFFFF');
        if (!isTransparentCssColor(fill)) {
          ctx.fillStyle = fill;
          ctx.fill(path);
        }
        if (lineW > 0 && !isTransparentCssColor(stroke)) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = lineW;
          ctx.stroke(path);
        }
      } else if (lineW > 0) {
        ctx.strokeStyle = !isTransparentCssColor(stroke) ? stroke : paintColor;
        ctx.lineWidth = lineW;
        ctx.stroke(path);
      }
      ctx.restore();
      return;
    } catch {
      /* fall through */
    }
  }

  paintStrokeCanvasIdle(ctx, {
    pathD: d,
    width: w,
    height: h,
    stroke: paintColor,
    lineWidth: Math.max(lineW, canvasIdleStrokeWidth(node, opts.zoom ?? 1)),
  });
  ctx.restore();
}

/** Idle text glyphs (wrapped) in local node space — not greeking bars. */
export function paintCanvasTextInk(
  ctx: CanvasRenderingContext2D,
  opts: {
    node: SceneNodeInput;
    width: number;
    height: number;
    opacity?: number;
  }
): void {
  const node = opts.node;
  const w = Math.max(1, opts.width);
  const h = Math.max(1, opts.height);
  const opacity = Math.min(1, Math.max(0.05, opts.opacity ?? 1));
  const style = parseNodeTextStyle(node.attrs || {});
  const plain = parseNodeText(node.attrs || {});
  const textFrame =
    node.attrs?.textFrame === true ||
    node.attrs?.textFrame === 'true' ||
    node.attrs?.textFrame === 1 ||
    node.attrs?.textFrame === '1';
  const framePad = textFrame ? TEXT_FRAME_PADDING : 0;
  const innerW = textFrame ? Math.max(1, w - framePad * 2) : w;
  const lines = wrapPlainTextLines(plain, style, innerW);
  const fontSize = Math.max(1, Number(style.fontSize) || 14);
  const lineH = fontSize * Math.max(0.8, Number(style.lineHeight) || 1.4);
  const italic = style.fontStyle === 'italic' ? 'italic ' : '';
  const weight = style.fontWeight || 'normal';
  const fillOpacity = Math.max(0, Math.min(100, Number(style.fillOpacity) || 100)) / 100;

  ctx.save();
  ctx.globalAlpha = opacity * fillOpacity;
  if (textFrame) {
    const radii = radiiFromAttrs(node.attrs || {});
    const cornerR = clampCornerRadii(
      {
        tl: radii.tl > 0 ? radii.tl : TEXT_FRAME_RADIUS,
        tr: radii.tr > 0 ? radii.tr : TEXT_FRAME_RADIUS,
        br: radii.br > 0 ? radii.br : TEXT_FRAME_RADIUS,
        bl: radii.bl > 0 ? radii.bl : TEXT_FRAME_RADIUS,
      },
      w,
      h
    );
    traceRoundedRectLocal(ctx, w, h, cornerR);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    traceRoundedRectLocal(ctx, w, h, cornerR);
    ctx.clip();
  }
  applyCanvasDropShadow(ctx, node);
  ctx.font = `${italic}${weight} ${fontSize}px "${style.fontFamily}"`;
  ctx.fillStyle = style.fill || '#333333';
  ctx.textBaseline = 'top';

  const align = String(style.textAlign || 'left');
  let x = framePad;
  if (align === 'center' || align === 'middle') {
    ctx.textAlign = 'center';
    x = w / 2;
  } else if (align === 'right' || align === 'end') {
    ctx.textAlign = 'right';
    x = w - framePad;
  } else {
    ctx.textAlign = 'left';
    x = framePad;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || ' ';
    const y = framePad + i * lineH;
    // Fixed text frames: skip lines fully below the plate (scroll lives in HTML).
    if (textFrame && y >= h - framePad) break;
    ctx.fillText(line, x, y);
  }
  clearCanvasDropShadow(ctx);
  ctx.restore();
}

function traceRoundedRectLocal(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  r: { tl: number; tr: number; br: number; bl: number }
): void {
  const { tl, tr, br, bl } = r;
  ctx.beginPath();
  ctx.moveTo(tl, 0);
  ctx.lineTo(w - tr, 0);
  if (tr > 0) ctx.arcTo(w, 0, w, tr, tr);
  else ctx.lineTo(w, 0);
  ctx.lineTo(w, h - br);
  if (br > 0) ctx.arcTo(w, h, w - br, h, br);
  else ctx.lineTo(w, h);
  ctx.lineTo(bl, h);
  if (bl > 0) ctx.arcTo(0, h, 0, h - bl, bl);
  else ctx.lineTo(0, h);
  ctx.lineTo(0, tl);
  if (tl > 0) ctx.arcTo(0, 0, tl, 0, tl);
  else ctx.lineTo(0, 0);
  ctx.closePath();
}

function isTransparentPaint(v: unknown): boolean {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return !s || s === 'none' || s === 'transparent' || s === 'rgba(0,0,0,0)';
}

/** Pencil / open strokes must never become solid AABB 色块 at far zoom. */
export function canvasIdleIsStrokeOnly(node: SceneNodeInput): boolean {
  const a = node?.attrs || {};
  const t = String(a.shapeType || '');
  if (t === 'pencil' || t === 'line' || t === 'arrow') return true;
  if (t === 'pen') {
    const d = String(a.path || '');
    const closed =
      a.closed !== false &&
      a.closed !== 'false' &&
      (a.closed === true || a.closed === 'true' || /\sZ\s*$/i.test(d.trim()));
    if (!closed) return true;
    if (!boolEffectAttr(a['fill-enabled'], true) || !boolEffectAttr(a['fill-visible'], true)) {
      return true;
    }
    return isTransparentPaint(a['fill-color']);
  }
  if (t === 'path' || String(node?.key || '') === 'path') {
    return isTransparentPaint(a['fill-color']);
  }
  return false;
}

export function canvasIdleStrokeWidth(node: SceneNodeInput, zoom: number): number {
  const a = node?.attrs || {};
  const raw = Number(a['border-width'] ?? 2);
  const w = Number.isFinite(raw) && raw > 0 ? raw : 2;
  return Math.max(0.75, Math.min(6, w * Math.max(0.35, zoom || 1)));
}

/**
 * Subsample path centerline into ctx stroke (local path coords).
 * Returns false if path unusable — caller may draw a fallback midline.
 */
export function strokeCanvasIdleCenterline(
  ctx: CanvasRenderingContext2D,
  d: string,
  maxPts = CANVAS_IDLE_STROKE_MAX_PTS
): boolean {
  const trimmed = String(d || '').trim();
  if (!trimmed) return false;
  const pts = parseSimplePathPoints(trimmed);
  if (pts.length < 2) return false;
  const step = Math.max(1, Math.ceil(pts.length / maxPts));
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i];
    if (!p) continue;
    if (!started) {
      ctx.moveTo(p.x, p.y);
      started = true;
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }
  const last = pts[pts.length - 1];
  if (last && started) ctx.lineTo(last.x, last.y);
  ctx.stroke();
  return started;
}

/** Stroke path centerline or a horizontal midline fallback inside the node box. */
export function paintStrokeCanvasIdle(
  ctx: CanvasRenderingContext2D,
  opts: {
    pathD: string;
    width: number;
    height: number;
    stroke: string;
    lineWidth: number;
  }
): void {
  const w = Math.max(1, opts.width);
  const h = Math.max(1, opts.height);
  ctx.strokeStyle = opts.stroke;
  ctx.lineWidth = opts.lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (!strokeCanvasIdleCenterline(ctx, opts.pathD)) {
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
  }
}

/** Idle text proxy: greeking bars (no solid AABB slab). Origin = top-left of node. */
export function paintTextProxyLines(
  ctx: CanvasRenderingContext2D,
  opts: {
    node: SceneNodeInput;
    width: number;
    height: number;
    fill: string;
    opacity?: number;
  }
): void {
  const w = Math.max(1, opts.width);
  const h = Math.max(1, opts.height);
  const opacity = Math.min(1, Math.max(0.05, opts.opacity ?? 1));
  const fontSize = Math.max(6, Number(opts.node.attrs?.fontSize) || 14);
  const lineH = fontSize * (Number(opts.node.attrs?.lineHeight) || 1.4);
  const lineCount = Math.max(1, Math.round(h / lineH));
  const barH = Math.max(1, Math.min(fontSize * 0.55, lineH * 0.55));
  const lastLineW = w * (0.35 + 0.4 * Math.abs(Math.sin(w * 0.05)));
  ctx.fillStyle = opts.fill;
  for (let li = 0; li < lineCount; li++) {
    const barW = li === lineCount - 1 && lineCount > 1 ? lastLineW : w;
    ctx.globalAlpha = opacity * 0.72;
    ctx.fillRect(0, li * lineH + (lineH - barH) / 2, barW, barH);
  }
}

/** Minimal image/video/lottie placeholder (mountain + sun) at local (0,0). */
export function paintMediaProxyIcon(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opacity: number
): void {
  const s = Math.min(w, h) * 0.28;
  if (s < 3) return;
  const cx = w / 2;
  const cy = h / 2;
  ctx.save();
  ctx.globalAlpha = opacity * 0.55;
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = Math.max(0.5, Math.min(1.5, s * 0.06));
  ctx.strokeRect(0, 0, w, h);
  const sunR = s * 0.18;
  ctx.fillStyle = '#94a3b8';
  ctx.beginPath();
  ctx.arc(cx - s * 0.28, cy - s * 0.22, sunR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.5, cy + s * 0.35);
  ctx.lineTo(cx, cy - s * 0.2);
  ctx.lineTo(cx + s * 0.5, cy + s * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.1, cy + s * 0.35);
  ctx.lineTo(cx + s * 0.45, cy + s * 0.05);
  ctx.lineTo(cx + s * 0.8, cy + s * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Normalized crop from image/video attrs (matches sceneToSvg). */
function readMediaCropNorm(
  node: SceneNodeInput
): { x: number; y: number; w: number; h: number } | null {
  const fx = Number(node?.attrs?.cropX);
  const fy = Number(node?.attrs?.cropY);
  const fw = Number(node?.attrs?.cropW);
  const fh = Number(node?.attrs?.cropH);
  if (
    Number.isFinite(fx) &&
    Number.isFinite(fy) &&
    Number.isFinite(fw) &&
    Number.isFinite(fh) &&
    fw > 0 &&
    fh > 0 &&
    (fx !== 0 || fy !== 0 || fw !== 1 || fh !== 1)
  ) {
    return { x: fx, y: fy, w: fw, h: fh };
  }
  return null;
}

function mediaPaintSrc(node: SceneNodeInput): string {
  const key = String(node.key || '');
  const attrs = node.attrs || {};
  if (key === 'video') {
    const poster = String(attrs.poster || '').trim();
    if (poster) return poster;
  }
  return String(attrs.src || '').trim();
}

/**
 * Local-origin image / video poster ink (0,0 → w×h), with crop + corner clip.
 * Starts decode via `getFillImageReady` when missing; falls back to icon.
 */
export function paintCanvasMediaInk(
  ctx: CanvasRenderingContext2D,
  opts: {
    node: SceneNodeInput;
    width: number;
    height: number;
    opacity?: number;
  }
): void {
  const w = Math.max(1, opts.width);
  const h = Math.max(1, opts.height);
  const opacity = Math.min(1, Math.max(0.05, opts.opacity ?? 1));
  const src = mediaPaintSrc(opts.node);
  const img = src ? getFillImageReady(src) : null;
  if (!img) {
    paintMediaProxyIcon(ctx, w, h, opacity);
    return;
  }

  ctx.save();
  ctx.globalAlpha = opacity;
  const r = clampCornerRadii(radiiFromAttrs(opts.node.attrs), w, h);
  traceRoundedRectLocal(ctx, w, h, r);
  ctx.clip();

  const attrs = (opts.node.attrs || {}) as Record<string, unknown>;
  if (nodeNeedsPuppetWarp(opts.node)) {
    const pins = (() => {
      const track = attrs.puppetTrack;
      if (Array.isArray(track) && track.length) {
        const frame = secToFrame(getAnimationWorkbenchPlayheadSec(), 30);
        return samplePuppetPinsAtFrame(attrs, frame);
      }
      return readPuppetPins(attrs);
    })();
    paintPuppetWarpedImage(ctx, {
      image: img,
      width: w,
      height: h,
      pins,
      attrs,
    });
    ctx.restore();
    return;
  }

  const crop = readMediaCropNorm(opts.node);
  if (crop) {
    const imgW = w / crop.w;
    const imgH = h / crop.h;
    const imgX = (-crop.x / crop.w) * w;
    const imgY = (-crop.y / crop.h) * h;
    ctx.drawImage(img, imgX, imgY, imgW, imgH);
  } else {
    drawFillImageInBox(ctx, img, w, h, 'fill', 0);
  }
  ctx.restore();
}

export type CanvasIdleNodePaintOpts = {
  left: number;
  top: number;
  width: number;
  height: number;
  node: SceneNodeInput;
  zoom: number;
  angle?: number;
  /** Scene document — clipContent artboard clip for overlay ink. */
  document?: SceneDocument | null;
};

/**
 * Clip Canvas ink to the node's owning clipContent frame (scene space).
 * Needed when idle ink paints above artboard plates.
 */
export function clipCanvasIdleToOwningFrame(
  ctx: CanvasRenderingContext2D,
  document: SceneDocument | null | undefined,
  node: SceneNodeInput | null | undefined,
  zoom = 1
): boolean {
  const frame = findClippingFrameForNode(document, node as Record<string, unknown> | null);
  if (!frame) return false;
  const ox = Number(document?.x) || 0;
  const oy = Number(document?.y) || 0;
  const fx = Number(frame.x) - ox;
  const fy = Number(frame.y) - oy;
  const fw = Math.max(1, Number(frame.width) || 1);
  const fh = Math.max(1, Number(frame.height) || 1);
  const inset = Math.min(2, 0.5 / Math.max(0.05, zoom || 1));
  ctx.beginPath();
  ctx.rect(fx + inset, fy + inset, Math.max(1, fw - inset * 2), Math.max(1, fh - inset * 2));
  ctx.clip();
  return true;
}

/**
 * One Canvas2D idle node (path / text / media / shape fill).
 * Scene coords; applies node angle when needed.
 */
export function paintCanvasIdleNode(
  ctx: CanvasRenderingContext2D,
  opts: CanvasIdleNodePaintOpts
): void {
  const node = opts.node;
  const w = Math.max(1, opts.width);
  const h = Math.max(1, opts.height);
  const left = opts.left;
  const top = opts.top;
  const angle = opts.angle != null ? Number(opts.angle) : Number(node.attrs?.angle) || 0;
  const fill = resolveNodeProxyFill(node);
  const opacity = Math.min(1, Math.max(0.15, Number(node.attrs?.opacity) || 1));
  const strokeOnly = canvasIdleIsStrokeOnly(node);
  const pathD = String(node.attrs?.path || '');
  const key = String(node.key || '');
  const isMedia = key === 'image' || key === 'video' || key === 'lottie';

  const paintAtLocalOrigin = () => {
    if (key === 'text') {
      if (canIdlePaintOnCanvas(node)) {
        paintCanvasTextInk(ctx, { node, width: w, height: h, opacity });
      } else {
        ctx.save();
        ctx.globalAlpha = opacity;
        paintTextProxyLines(ctx, { node, width: w, height: h, fill, opacity });
        ctx.restore();
      }
      return;
    }
    if (isMedia) {
      if (isImageProcessRunning(node)) {
        paintProcessPlateCanvas(ctx, w, h, opacity, String(node.id || ''));
        return;
      }
      if (key === 'image' || key === 'video') {
        paintCanvasMediaInk(ctx, { node, width: w, height: h, opacity });
      } else {
        ctx.save();
        ctx.globalAlpha = opacity;
        paintMediaProxyIcon(ctx, w, h, opacity);
        ctx.restore();
      }
      return;
    }
    const shapeType = String(node.attrs?.shapeType || key || '').toLowerCase();
    const isPathLike =
      strokeOnly ||
      shapeType === 'pencil' ||
      shapeType === 'pen' ||
      shapeType === 'path' ||
      shapeType === 'line' ||
      shapeType === 'arrow' ||
      key === 'path';
    if (isPathLike) {
      if (canIdlePaintOnCanvas(node)) {
        paintCanvasPathInk(ctx, {
          node,
          width: w,
          height: h,
          opacity,
          zoom: opts.zoom,
        });
      } else {
        ctx.save();
        ctx.globalAlpha = opacity;
        paintStrokeCanvasIdle(ctx, {
          pathD,
          width: w,
          height: h,
          stroke: fill,
          lineWidth: canvasIdleStrokeWidth(node, opts.zoom),
        });
        ctx.restore();
      }
      return;
    }
    if (canIdlePaintOnCanvas(node)) {
      paintCanvasShapeInk(ctx, { node, width: w, height: h, opacity });
      return;
    }
    ctx.save();
    ctx.globalAlpha = opacity;
    paintBasicShapeFill(ctx, {
      left: 0,
      top: 0,
      width: w,
      height: h,
      fill,
      shapeType: String(node.attrs?.shapeType || key || ''),
      opacity,
    });
    ctx.restore();
  };

  ctx.save();
  clipCanvasIdleToOwningFrame(ctx, opts.document, node, opts.zoom);
  if (Math.abs(angle) > 0.5) {
    const cx = left + w / 2;
    const cy = top + h / 2;
    ctx.translate(cx, cy);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.translate(-w / 2, -h / 2);
  } else {
    ctx.translate(left, top);
  }
  paintAtLocalOrigin();
  ctx.restore();
}

/**
 * Live Canvas-idle id list published by RcbShapesLayer for the stage ink overlay.
 * Screen-space paint uses CameraTransform (same lattice as the pixel grid).
 */
export type SceneCanvasIdlePaintSnapshot = {
  document: SceneDocument;
  canvasIds: readonly string[];
  hiddenNodeId: string | null;
  getNodeBox: (nodeId: string) => SceneHitBox | null;
};

let sceneCanvasIdlePaint: SceneCanvasIdlePaintSnapshot | null = null;
const sceneCanvasIdlePaintListeners = new Set<() => void>();

export function getSceneCanvasIdlePaint(): SceneCanvasIdlePaintSnapshot | null {
  return sceneCanvasIdlePaint;
}

export function setSceneCanvasIdlePaint(next: SceneCanvasIdlePaintSnapshot | null): void {
  sceneCanvasIdlePaint = next;
  for (const fn of sceneCanvasIdlePaintListeners) {
    fn();
  }
}

/** Re-paint idle ink without changing the id set (e.g. fill-image decode finished). */
export function bumpSceneCanvasIdlePaint(): void {
  for (const fn of sceneCanvasIdlePaintListeners) {
    fn();
  }
}

export function clearSceneCanvasIdlePaint(): void {
  if (sceneCanvasIdlePaint == null) return;
  setSceneCanvasIdlePaint(null);
}

export function subscribeSceneCanvasIdlePaint(listener: () => void): () => void {
  sceneCanvasIdlePaintListeners.add(listener);
  return () => {
    sceneCanvasIdlePaintListeners.delete(listener);
  };
}

/** Ids to paint on the underlay (excludes the inline-edit hidden node). */
export function listSceneCanvasIdlePaintIds(): readonly string[] {
  const snap = sceneCanvasIdlePaint;
  if (!snap?.canvasIds.length) return [];
  const hidden = snap.hiddenNodeId;
  if (!hidden) return snap.canvasIds;
  return snap.canvasIds.filter((id) => id !== hidden);
}

/**
 * World point → stage-local screen (for chrome / canvas overlays that share
 * CameraTransform with the renderer).
 */
export function scenePointToStageLocal(
  camera: RcbCamera,
  point: RcbVec,
  dpr = 1
): RcbVec {
  return worldToScreen(createCameraTransform(camera, dpr), point.x, point.y);
}

/** Default factory — live media / editors stay on svg; idle ink prefers canvas2d. */
export function createSceneRenderer(
  backend: SceneRendererBackend,
  deps: CanvasSceneRendererDeps | SceneRendererHitDeps
): SceneRenderer {
  if (backend === 'canvas2d') {
    const canvasDeps = deps as CanvasSceneRendererDeps;
    if (!canvasDeps.canvas) {
      throw new Error('createSceneRenderer(canvas2d) requires deps.canvas');
    }
    return createCanvasSceneRenderer(canvasDeps);
  }
  return createSvgSceneRenderer(deps);
}
