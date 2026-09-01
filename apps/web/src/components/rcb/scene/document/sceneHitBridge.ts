import type { SceneDocument, SceneNode, SceneNodeInput } from '@/components/rcb/sceneNode';
/**
 * Scene pick / hit-test domain — shared by SvgCanvas and bridge consumers
 * (e.g. FrameMoveFeature via setSceneHitTestBridge).
 *
 * Spatial candidate order stays in SceneSpatialRuntime (SoaQuadtree broad-phase);
 * this module owns per-node ink tests (Path2D / AABB; optional SVG DOM behind allowSvgDomHit).
 */

import { getShapeBaselineD } from '@/components/rcb/core/geometry';
import {
  deflateSelectionBox,
  inflateBoxByVisualOutset,
  resolveStroke,
  resolveStrokeAlign,
} from '@/components/rcb/scene/document/sceneEffects';
import {
  isAnimationFrameHostNode,
  isArtboardVisibleInDocument,
  isNodeHiddenInDocument,
  isNodePickableInDocument,
  supportsFill,
} from '@/components/rcb/scene/document/nodeCapabilities';
import { isAnimationArtboardKind } from '@/components/rcb/frames/types';
import { getLiveArtboardFrameGeometry } from '@/components/rcb/frames/HtmlArtboardFrame';
import {
  HEAVY_PATH_D_CHARS,
  distPointToPathD,
  distPointToSegment,
  hitTestPath2DLocal,
  hitTestSvgNodeAtClient,
  pathDContainsPoint,
  rememberNodePath2D,
  sceneHitSlop,
  strokeEndpointsFromBox,
} from '@/components/rcb/scene/document/sceneShapes';
import {
  hitTestSoaSlot,
  SOA_FLAG_CANVAS_IDLE,
  SOA_KIND_LINE,
  SOA_KIND_PATH,
  SOA_KIND_POLY,
  type SceneRenderBuffer,
} from '@/components/rcb/render/sceneRenderBuffer';

export type SceneHitFn = (
  x: number,
  y: number,
  screen?: { clientX: number; clientY: number }
) => string | null;

export type ViewportToolPointerHandlers = {
  onDown?: (e: PointerEvent) => void;
  onMove?: (e: PointerEvent) => void;
  onUp?: (e: PointerEvent) => void;
  onLeave?: (e: PointerEvent) => void;
  onDblClick?: (e: PointerEvent) => void;
};

/**
 * Shared tool pointer binder (ADR 0027 appendix A).
 * Stage capture is the authority. Window capture is a **outside-stage relay**
 * only (skips events already handled on `hitEl`) so pe:auto layers above the
 * stage cannot starve tip/drag — do not add per-feature window listeners.
 */
export function attachViewportToolPointers(
  hitEl: HTMLElement,
  handlers: ViewportToolPointerHandlers
): () => void {
  const { onDown, onMove, onUp, onLeave, onDblClick } = handlers;

  function targetOutsideHit(e: Event): boolean {
    const t = e.target;
    if (!(t instanceof Node)) return true;
    return !hitEl.contains(t);
  }

  function onWindowMove(e: PointerEvent) {
    if (!onMove || !targetOutsideHit(e)) return;
    onMove(e);
  }

  function onWindowUp(e: PointerEvent) {
    if (!onUp) return;
    // pointercancel may target hitEl while capture is held — still finish.
    if (e.type !== 'pointercancel' && !targetOutsideHit(e)) return;
    onUp(e);
  }

  if (onDown) hitEl.addEventListener('pointerdown', onDown, true);
  if (onMove) {
    hitEl.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointermove', onWindowMove, true);
  }
  if (onUp) {
    hitEl.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointerup', onWindowUp, true);
    window.addEventListener('pointercancel', onWindowUp, true);
  }
  if (onLeave) hitEl.addEventListener('pointerleave', onLeave);
  if (onDblClick) hitEl.addEventListener('dblclick', onDblClick, true);
  return () => {
    if (onDown) hitEl.removeEventListener('pointerdown', onDown, true);
    if (onMove) {
      hitEl.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointermove', onWindowMove, true);
    }
    if (onUp) {
      hitEl.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointerup', onWindowUp, true);
      window.removeEventListener('pointercancel', onWindowUp, true);
    }
    if (onLeave) hitEl.removeEventListener('pointerleave', onLeave);
    if (onDblClick) hitEl.removeEventListener('dblclick', onDblClick, true);
  };
}

export type SceneHitBox = { left: number; top: number; width: number; height: number };

export type HitTestSceneAtPointOpts = {
  document: SceneDocument;
  /** Top→bottom candidate ids (from SceneSpatialRuntime.hitCandidateIds). */
  order: readonly string[];
  x: number;
  y: number;
  zoom: number;
  screen?: { clientX: number; clientY: number };
  getNodeBox: (nodeId: string) => SceneHitBox | null;
  /**
   * Live SVG hosts for DOM isPointInFill/Stroke.
   * Only used when {@link allowSvgDomHit} is true (default off — ADR 0027).
   */
  nodeEls?: Map<string, Element> | null;
  /**
   * When true, path-like hits may fall back to SVG DOM under the cursor.
   * Default false: Path2D / AABB only (no live DOM lattice).
   */
  allowSvgDomHit?: boolean;
  /** When set, canvas-idle slots are tested in z-order alongside SVG/scene hits. */
  soaBuf?: SceneRenderBuffer | null;
};

let hitFn: SceneHitFn | null = null;

export function setSceneHitTestBridge(fn: SceneHitFn | null) {
  if (!fn) {
    hitFn = null;
    if (typeof window !== 'undefined') {
      (window as unknown as { __rcbBridgeHitTest?: SceneHitFn | null }).__rcbBridgeHitTest = null;
    }
    return;
  }
  hitFn = (x, y, screen) => {
    const result = fn(x, y, screen);
    if (typeof window !== 'undefined' && import.meta.env.DEV) {
      (window as unknown as { __rcbBridgeWrap?: unknown }).__rcbBridgeWrap = {
        x,
        y,
        result,
        hasTrace: Boolean(
          (window as unknown as { __rcbHitTrace?: unknown }).__rcbHitTrace
        ),
        t: Date.now(),
      };
    }
    return result;
  };
  if (typeof window !== 'undefined') {
    (window as unknown as { __rcbBridgeHitTest?: SceneHitFn | null }).__rcbBridgeHitTest = hitFn;
  }
}

export function hitTestSceneAtPoint(opts: HitTestSceneAtPointOpts): string | null {
  const {
    document: doc,
    order,
    x,
    y,
    zoom,
    screen,
    getNodeBox,
    nodeEls,
    allowSvgDomHit = false,
    soaBuf = null,
  } = opts;
  const pad = sceneHitSlop(Math.max(0.05, zoom || 1));
  for (const id of order) {
    const node = doc?.deltaSetLike?.[id];
    if (!node || isNodeHiddenInDocument(doc, node)) {
      continue;
    }
    // 动画工作台 invisible host is plate chrome — never steal picks from nested
    // Lottie / shape children underneath the full-bleed plate.
    if (isAnimationFrameHostNode(node, doc)) {
      continue;
    }
    // Hidden / preview-only / playhead trim — not pickable.
    if (!isNodePickableInDocument(doc, node)) {
      continue;
    }
    if (!isNodePickableAtPoint(doc, node, x, y)) {
      continue;
    }
    const soaIndex = soaBuf?.indexById.get(id);
    const isSoaIdle =
      soaIndex != null &&
      soaIndex >= 0 &&
      (soaBuf!.flags[soaIndex] & SOA_FLAG_CANVAS_IDLE) !== 0;
    if (isSoaIdle && hitTestSoaSlot(soaBuf!, soaIndex, x, y)) {
      return id;
    }
    if (isSoaIdle) {
      // Stroke ink: SoA polylines undersample curves / can go stale vs paint.
      // Fall through to Path2D / segment hit (same path line/arrow hosts use).
      const kind = soaBuf!.kinds[soaIndex];
      const strokeInk =
        kind === SOA_KIND_PATH || kind === SOA_KIND_LINE || kind === SOA_KIND_POLY;
      if (!strokeInk) {
        continue;
      }
    }
    const box = getNodeBox(id);
    if (!box) {
      continue;
    }
    const hit = hitTestSceneNodeAt({
      id,
      node,
      box,
      x,
      y,
      zoom,
      pad,
      screen,
      svgEl: allowSvgDomHit ? (nodeEls?.get(id) ?? null) : null,
      allowSvgDomHit,
    });
    if (hit) {
      return id;
    }
  }
  return null;
}

/** Topmost artboard under a scene point (matches canvasSession.hitTestFrameInDoc). */
export function frameIdAtPoint(
  doc: SceneDocument | null | undefined,
  x: number,
  y: number
): string | null {
  const frames = Array.isArray(doc?.frames) ? doc.frames : [];
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const frame = frames[i];
    if (!frame || frame.locked || !isArtboardVisibleInDocument(frame)) continue;
    const live = getLiveArtboardFrameGeometry(String(frame.id || ''));
    const fx = Number(live?.x ?? frame.x) || 0;
    const fy = Number(live?.y ?? frame.y) || 0;
    const fw = Math.max(1, Number(live?.width ?? frame.width) || 1);
    const fh = Math.max(1, Number(live?.height ?? frame.height) || 1);
    if (x >= fx && x <= fx + fw && y >= fy && y <= fy + fh) {
      return String(frame.id);
    }
  }
  return null;
}

/**
 * Bound nodes only pick inside their owning artboard.
 * Unowned filled ink over a clipContent artboard is pickable only inside that
 * plate (AABB overhang is treated as clipped for pick).
 * Open strokes (pen / pencil / path / line / arrow) skip that gate — their AABB
 * often grazes a nearby plate while the ink sits in world space (marquee worked,
 * point pick did not).
 */
export function isNodePickableAtPoint(
  doc: SceneDocument,
  node: SceneNode,
  x: number,
  y: number
): boolean {
  const ownerId = String(node.attrs?.frameId || '').trim();
  if (ownerId) return frameIdAtPoint(doc, x, y) === ownerId;
  return isPointVisibleForFrameClip(doc, node, x, y);
}

function isOpenStrokeShape(node: SceneNodeInput | null | undefined): boolean {
  const t = String(node?.attrs?.shapeType || node?.key || '').toLowerCase();
  return t === 'pen' || t === 'pencil' || t === 'path' || t === 'line' || t === 'arrow';
}

function frameRect(frame: { x?: unknown; y?: unknown; width?: unknown; height?: unknown }) {
  const left = Number(frame.x) || 0;
  const top = Number(frame.y) || 0;
  const width = Math.max(1, Number(frame.width) || 1);
  const height = Math.max(1, Number(frame.height) || 1);
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function rectsOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number }
) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function pointInRect(
  x: number,
  y: number,
  r: { left: number; top: number; right: number; bottom: number }
) {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function isPointVisibleForFrameClip(doc: SceneDocument, node: SceneNode, x: number, y: number) {
  // Only called for unbound nodes (owned nodes use frameIdAtPoint above) —
  // their x/y are already world, including under frameLocal.
  const nodeRect = frameRect(node);
  // Freehand / open strokes: don't require the click to land inside a plate the
  // stroke AABB merely grazes (line/arrow already rarely hit this; pens do).
  if (isOpenStrokeShape(node)) return true;
  const clipping = (doc.frames || []).filter((frame) => {
    if (frame?.clipContent === false || isAnimationArtboardKind(frame.kind)) return false;
    return rectsOverlap(nodeRect, frameRect(frame));
  });
  if (!clipping.length) return true;
  return clipping.some((frame) => pointInRect(x, y, frameRect(frame)));
}

function toNodeLocal(
  x: number,
  y: number,
  originLeft: number,
  originTop: number,
  width: number,
  height: number,
  angle: number
): { lx: number; ly: number } {
  let lx = x - originLeft;
  let ly = y - originTop;
  if (Math.abs(angle) > 0.5) {
    const cx = width / 2;
    const cy = height / 2;
    const rad = (-angle * Math.PI) / 180;
    const dx = lx - cx;
    const dy = ly - cy;
    lx = dx * Math.cos(rad) - dy * Math.sin(rad) + cx;
    ly = dx * Math.sin(rad) + dy * Math.cos(rad) + cy;
  }
  return { lx, ly };
}

function hitsRotatedAabb(
  x: number,
  y: number,
  box: SceneHitBox,
  angle: number,
  pad: number
): boolean {
  if (Math.abs(angle) > 0.5) {
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const rad = (-angle * Math.PI) / 180;
    const dx = x - cx;
    const dy = y - cy;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    return Math.abs(lx) <= box.width / 2 + pad && Math.abs(ly) <= box.height / 2 + pad;
  }
  return (
    x >= box.left - pad &&
    x <= box.left + box.width + pad &&
    y >= box.top - pad &&
    y <= box.top + box.height + pad
  );
}

function isGeoShapeNode(node: SceneNodeInput, shapeType: string): boolean {
  const key = String(node.key || '');
  return (
    key === 'shape' ||
    key === 'rect' ||
    key === 'ellipse' ||
    shapeType === 'rect' ||
    shapeType === 'roundRect' ||
    shapeType === 'circle' ||
    shapeType === 'triangle' ||
    shapeType === 'star' ||
    shapeType === 'polygon'
  );
}

function hitTestLineOrArrow(opts: {
  id: string;
  node: SceneNodeInput;
  box: SceneHitBox;
  x: number;
  y: number;
  pad: number;
}): boolean {
  const { id, node, box, x, y, pad } = opts;
  const angle = Number(node.attrs?.angle) || 0;
  const geom = deflateSelectionBox(box, node);
  const d = getShapeBaselineD(node, {
    width: Math.max(1, geom.width),
    height: Math.max(1, geom.height),
  });
  if (d) {
    const { lx, ly } = toNodeLocal(x, y, geom.left, geom.top, geom.width, geom.height, angle);
    const { strokeWidth: sw } = resolveStroke(node, '#333333');
    const hitW = Math.max(sw > 0 ? sw : 2, 0) + pad * 2;
    rememberNodePath2D(id, d);
    if (
      hitTestPath2DLocal(d, lx, ly, {
        strokeWidth: hitW,
        lineCap: 'round',
        lineJoin: 'round',
      })
    ) {
      return true;
    }
  }
  const ep = strokeEndpointsFromBox(box, angle);
  return distPointToSegment(x, y, ep.x0, ep.y0, ep.x1, ep.y1) <= pad;
}

function hitTestPathLike(opts: {
  id: string;
  node: SceneNodeInput;
  shapeType: string;
  box: SceneHitBox;
  x: number;
  y: number;
  zoom: number;
  screen?: { clientX: number; clientY: number };
  svgEl?: Element | null;
  allowSvgDomHit?: boolean;
}): boolean {
  const { id, node, shapeType, box, x, y, zoom, screen, svgEl, allowSvgDomHit } = opts;
  const sw = Math.max(
    1,
    Number(node.attrs?.['border-width'] ?? 2) || 2
  );
  const pathPad = sw / 2 + sceneHitSlop(zoom, 10);
  const fillHit = supportsFill(node);
  const inLooseBox =
    x >= box.left - pathPad &&
    x <= box.left + box.width + pathPad &&
    y >= box.top - pathPad &&
    y <= box.top + box.height + pathPad;
  if (!inLooseBox) return false;

  const d = String(node.attrs?.path || '');
  const heavyPath = d.length >= HEAVY_PATH_D_CHARS;
  const angle = Number(node.attrs?.angle) || 0;
  const { lx, ly } = toNodeLocal(x, y, box.left, box.top, box.width, box.height, angle);

  if (!heavyPath && d) {
    rememberNodePath2D(id, d);
    const hitW = sw + pathPad * 2;
    if (
      hitTestPath2DLocal(d, lx, ly, {
        fill: fillHit,
        strokeWidth: hitW,
        fillRule:
          String(node.attrs?.['fill-rule'] || 'nonzero') === 'evenodd' ? 'evenodd' : 'nonzero',
        lineCap: 'round',
        lineJoin: 'round',
      })
    ) {
      return true;
    }
  }

  // Optional SVG DOM lattice — off by default (ADR 0027 independent hit).
  if (allowSvgDomHit && svgEl && screen) {
    const mode = shapeType === 'pencil' || fillHit ? 'auto' : 'stroke';
    const hitW = sw + pathPad * 2;
    if (
      hitTestSvgNodeAtClient(svgEl, screen.clientX, screen.clientY, {
        mode,
        strokeHitWidth: hitW,
      })
    ) {
      return true;
    }
    if (heavyPath) return false;
  }

  if (heavyPath) {
    return Boolean(fillHit && lx >= 0 && ly >= 0 && lx <= box.width && ly <= box.height);
  }
  if (fillHit) {
    const rule = String(node.attrs?.['fill-rule'] || 'nonzero');
    if (pathDContainsPoint(lx, ly, d, rule)) return true;
  }
  return distPointToPathD(lx, ly, d) <= pathPad;
}

function hitTestGeoShape(opts: {
  id: string;
  node: SceneNodeInput;
  box: SceneHitBox;
  x: number;
  y: number;
  pad: number;
}): boolean {
  const { id, node, box, x, y, pad } = opts;
  const geom = deflateSelectionBox(box, node);
  const gw = Math.max(1, geom.width);
  const gh = Math.max(1, geom.height);
  const d = getShapeBaselineD(node, { width: gw, height: gh });
  const angle = Number(node.attrs?.angle) || 0;
  if (d) {
    const { lx, ly } = toNodeLocal(x, y, geom.left, geom.top, gw, gh, angle);
    const { stroke, strokeWidth: sw } = resolveStroke(node, '#333333');
    const align = resolveStrokeAlign(node.attrs);
    const strokeHit =
      stroke && stroke !== 'transparent' && sw > 0
        ? (align === 'outside' ? sw * 2 : sw) + pad * 2
        : 0;
    rememberNodePath2D(id, d);
    if (
      hitTestPath2DLocal(d, lx, ly, {
        fill: supportsFill(node),
        strokeWidth: strokeHit,
        lineCap: 'butt',
        lineJoin: 'miter',
      })
    ) {
      return true;
    }
  }
  const hitBox = inflateBoxByVisualOutset(geom, node);
  return hitsRotatedAabb(x, y, hitBox, angle, pad);
}

function hitTestVisualAabb(opts: {
  node: SceneNodeInput;
  box: SceneHitBox;
  x: number;
  y: number;
  pad: number;
}): boolean {
  const { node, box, x, y, pad } = opts;
  const geom = deflateSelectionBox(box, node);
  const hitBox = inflateBoxByVisualOutset(geom, node);
  const angle = Number(node.attrs?.angle) || 0;
  return hitsRotatedAabb(x, y, hitBox, angle, pad);
}

/** True when scene point hits this node’s ink / visual AABB. */
export function hitTestSceneNodeAt(opts: {
  id: string;
  node: SceneNodeInput;
  box: SceneHitBox;
  x: number;
  y: number;
  zoom: number;
  pad: number;
  screen?: { clientX: number; clientY: number };
  svgEl?: Element | null;
  allowSvgDomHit?: boolean;
}): boolean {
  const { id, node, box, x, y, zoom, pad, screen, svgEl, allowSvgDomHit } = opts;
  const shapeType = String(node.attrs?.shapeType || '');
  if (shapeType === 'line' || shapeType === 'arrow') {
    return hitTestLineOrArrow({ id, node, box, x, y, pad });
  }
  if (shapeType === 'pen' || shapeType === 'pencil' || shapeType === 'path') {
    return hitTestPathLike({
      id,
      node,
      shapeType,
      box,
      x,
      y,
      zoom,
      screen,
      svgEl,
      allowSvgDomHit,
    });
  }
  if (isGeoShapeNode(node, shapeType)) {
    return hitTestGeoShape({ id, node, box, x, y, pad });
  }
  return hitTestVisualAabb({ node, box, x, y, pad });
}
