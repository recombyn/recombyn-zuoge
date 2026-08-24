import type { SceneDocument, SceneNode, SceneNodeInput } from '@/components/rcb/sceneNode';
/**
 * Scene pick / hit-test domain — shared by SvgCanvas and bridge consumers
 * (e.g. FrameMoveFeature via setSceneHitTestBridge).
 *
 * Spatial candidate order stays in SceneSpatialRuntime; this module owns
 * per-node ink tests (Path2D / AABB; optional SVG DOM behind allowSvgDomHit).
 */

import { getShapeBaselineD } from '@/components/rcb/core/geometry';
import {
  deflateSelectionBox,
  inflateBoxByVisualOutset,
  resolveStroke,
  resolveStrokeAlign,
} from '@/components/rcb/scene/document/sceneEffects';
import { isNodeHidden, supportsFill } from '@/components/rcb/scene/document/nodeCapabilities';
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

/** Test/diag: last hit inputs when `__RCB_HIT_DEBUG__` is set. */
export let lastHitDebug: {
  x: number;
  y: number;
  orderLen: number;
  orderHead: string[];
  boxes: Array<{ id: string; box: SceneHitBox | null; hit: boolean }>;
} | null = null;

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
  } = opts;
  const pad = sceneHitSlop(Math.max(0.05, zoom || 1));
  const boxes: Array<{ id: string; box: SceneHitBox | null; hit: boolean }> = [];
  for (const id of order) {
    const node = doc?.deltaSetLike?.[id];
    if (!node || isNodeHidden(node)) {
      boxes.push({ id, box: null, hit: false });
      continue;
    }
    if (!isNodePickableAtPoint(doc, node, x, y)) {
      boxes.push({ id, box: null, hit: false });
      continue;
    }
    const box = getNodeBox(id);
    if (!box) {
      boxes.push({ id, box: null, hit: false });
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
    boxes.push({ id, box, hit });
    if (hit) {
      lastHitDebug = { x, y, orderLen: order.length, orderHead: order.slice(0, 8), boxes };
      return id;
    }
  }
  lastHitDebug = { x, y, orderLen: order.length, orderHead: [...order].slice(0, 8), boxes };
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
    if (!frame || frame.locked || frame.hidden) continue;
    const fx = Number(frame.x) || 0;
    const fy = Number(frame.y) || 0;
    const fw = Math.max(1, Number(frame.width) || 1);
    const fh = Math.max(1, Number(frame.height) || 1);
    if (x >= fx && x <= fx + fw && y >= fy && y <= fy + fh) {
      return String(frame.id);
    }
  }
  return null;
}

/**
 * Bound nodes (`attrs.frameId`) only pick inside their owning artboard —
 * prevents adjacent frames from stealing clicks through overflow geometry.
 */
export function isNodePickableAtPoint(
  doc: SceneDocument,
  node: SceneNode,
  x: number,
  y: number
): boolean {
  const ownerId = String(node.attrs?.frameId || '').trim();
  if (ownerId) {
    return frameIdAtPoint(doc, x, y) === ownerId;
  }
  return isPointVisibleForFrameClip(doc, node, x, y);
}

/** Artboards clip intersecting content by default; hidden overflow must not be pickable. */
function isPointVisibleForFrameClip(doc: SceneDocument, node: SceneNode, x: number, y: number) {
  const frames = Array.isArray(doc?.frames) ? doc.frames : [];
  const left = Number(node.x) || 0;
  const top = Number(node.y) || 0;
  const right = left + Math.max(1, Number(node.width) || 1);
  const bottom = top + Math.max(1, Number(node.height) || 1);
  const clippingFrames = frames.filter((frame) => {
    if (frame?.clipContent === false) return false;
    const frameLeft = Number(frame.x) || 0;
    const frameTop = Number(frame.y) || 0;
    const frameRight = frameLeft + Math.max(1, Number(frame.width) || 1);
    const frameBottom = frameTop + Math.max(1, Number(frame.height) || 1);
    return left < frameRight && right > frameLeft && top < frameBottom && bottom > frameTop;
  });
  if (!clippingFrames.length) return true;
  return clippingFrames.some((frame) => {
    const frameLeft = Number(frame.x) || 0;
    const frameTop = Number(frame.y) || 0;
    const frameRight = frameLeft + Math.max(1, Number(frame.width) || 1);
    const frameBottom = frameTop + Math.max(1, Number(frame.height) || 1);
    return x >= frameLeft && x <= frameRight && y >= frameTop && y <= frameBottom;
  });
}

export function bridgeSceneHitTest(
  x: number,
  y: number,
  screen?: { clientX: number; clientY: number }
): string | null {
  return hitFn?.(x, y, screen) ?? null;
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
