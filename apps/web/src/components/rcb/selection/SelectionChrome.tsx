import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  RcbOverlayPortal,
  useRcbCamera,
  useRcbDevicePixelRatio,
} from '../camera/context';
import { cameraZoom, createCameraTransform, worldToScreen } from '../camera/transform';
import { rcbCameraCssZoom } from '../core/math';
import {
  getSceneSelectionChromeMount,
  getShapeHost,
  getSharedNodeEls,
  subscribeShapeHosts,
} from '@/components/rcb/shapes/shapeHostRegistry';
import type { RcbCamera } from '../core/types';

export type SceneBox = { left: number; top: number; width: number; height: number };
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

type SelectionChromeProps = {
  box: SceneBox;
  angle?: number;
  showHandles?: boolean;
  /** Multi-select: only four corner knobs. */
  cornerHandlesOnly?: boolean;
  /**
   * `line`: shaft + two free endpoints (length + angle). No box / corners / rotate knob.
   * Used for straight line & arrow.
   */
  variant?: 'box' | 'line';
  showRotate?: boolean;
  metaLabel?: string;
  /**
   * When false, the blue border box does not capture pointers (handles still do).
   * Used for artboard frames so content inside remains clickable.
   */
  interactiveBox?: boolean;
  /** Override move-box data attribute (default data-sel-box). */
  boxDataAttr?: string;
  /** Override handle data attribute name (default data-sel-handle). */
  handleDataAttr?: string;
  /** Value for handleDataAttr (default "resize"). */
  handleDataValue?: string;
  /**
   * Edge handles: `all` (default), `horizontal` (text L/R wrap width only), or none.
   */
  edgeHandles?: 'all' | 'horizontal' | 'none' | 'se-only';
  /** When false, only handles / hit targets (no AABB stroke). */
  showBoxStroke?: boolean;
  /** Past outer stroke edge ??rotate sits beyond this (scene units). */
  strokeOuterScene?: number;
  /** Override selection box / handle stroke color. */
  strokeColor?: string;
  /** Transform origin as % of box (default 50/50). Lottie Anchor drives this. */
  anchorX?: number;
  anchorY?: number;
  /** AE-style skew (degrees) — must match scene ink or content leaves the box. */
  skewX?: number;
  skewAxis?: number;
};

/**
 * Selection chrome: AABB box + resize / rotate knobs. Paint portals into the
 * canonical scene SVG camera group; interaction remains geometry-first.
 */
export const CHROME_STROKE_PX = 1.5;
/** Painted mid-edge resize knob side length (screen px). */
export const CHROME_HANDLE_VIS_PX = 8;
/**
 * Mid-edge / corner resize knob hit diameter (screen px).
 * Rotate uses outside L-brackets ({@link CHROME_CORNER_L_ARM_PX}).
 */
export const CHROME_HANDLE_HIT_PX = 24;
/** Painted radius knob diameter (screen px). */
export const CHROME_RADIUS_VIS_PX = 10;
/** Corner-radius hit diameter (screen px) ??larger than paint so R-dots are easy to grab. */
export const CHROME_RADIUS_HIT_PX = 22;
/**
 * Air between resize control edge and radius control edge (screen px).
 * Keep generous ??at extreme zoom, hit circles must not swallow the R-dot
 * the way a tight 6px gap did in practice.
 */
export const CHROME_RADIUS_PARK_GAP_PX = 12;
/** Legacy rotate disc diameter (screen px) ??L-bracket is the primary rotate hit. */
export const CHROME_ROTATE_HIT_PX = 24;
/** Air between resize knob outer edge and rotate L inner edge (screen px). */
export const CHROME_ROTATE_GAP_PX = 8;
/** Line / arrow endpoint chrome (screen px). */
export const CHROME_LINE_ENDPOINT_VIS_PX = 8;
export const CHROME_LINE_ENDPOINT_HALO_PX = 22;
export const CHROME_LINE_ENDPOINT_HIT_PX = CHROME_HANDLE_HIT_PX;
export const CHROME_LINE_SHAFT_HIT_PX = 28;
/**
 * Rotate L-bracket arm length (screen px) ??outside the white corner knob.
 * White corner knobs stay for resize; this L is the rotate trigger only.
 */
export const CHROME_CORNER_L_ARM_PX = 28;
/** Rotate L-bracket bar thickness (screen px). */
export const CHROME_CORNER_L_THICK_PX = 10;
/** Screen gap between white corner knob edge and rotate L inner edge. */
export const CHROME_CORNER_L_CLEAR_PX = 2;
/**
 * Max extra screen px to push rotate L past stroke ink.
 * Scene stroke is constant; at 10000% uncapped outer clearance parks L
 * thousands of CSS px away from the white knobs (clickable blue flies off).
 */
export const CHROME_STROKE_L_CLEAR_MAX_SCREEN_PX = 40;

/**
 * Stroke band for chrome park (rotate L outer / radius inner) ? scene units,
 * capped in screen space so extreme zoom cannot fling controls off the box.
 */
export function strokeOuterForRotateLScene(strokeOuterScene: number, zoom: number): number {
  const outer = Math.max(0, Number(strokeOuterScene) || 0);
  if (!(outer > 0)) return 0;
  const z = Math.max(0.05, Number(zoom) || 1);
  const maxScene = CHROME_STROKE_L_CLEAR_MAX_SCREEN_PX / z;
  return Math.min(outer, maxScene);
}

/** @see strokeOuterForRotateLScene ? same screen cap for radius inward park. */
export function strokeInnerForRadiusParkScene(
  strokeInnerScene: number,
  zoom: number
): number {
  return strokeOuterForRotateLScene(strokeInnerScene, zoom);
}

/**
 * Local seat for a rotate-L HTML hit pad (outside the corner, center of the L).
 */
export function rotateLHitLocal(
  handle: ResizeHandle,
  boxW: number,
  boxH: number,
  clear: number,
  thick: number
): { lx: number; ly: number } | null {
  const c = Math.max(0, clear);
  const t = Math.max(1e-6, thick);
  const o = c + t / 2;
  const w = Math.max(1, boxW);
  const h = Math.max(1, boxH);
  if (handle === 'nw') return { lx: -o, ly: -o };
  if (handle === 'ne') return { lx: w + o, ly: -o };
  if (handle === 'se') return { lx: w + o, ly: h + o };
  if (handle === 'sw') return { lx: -o, ly: h + o };
  return null;
}

const SEL_BASELINE = '#3388ff';

/**
 * Scene distance from a corner knob center to the rotate hotzone center.
 * Axis-aligned into the outer quadrant ??diagonal push made the rotate AABB
 * overlap the resize hit and steal corner clicks after zoom.
 */
export function rotateHotzoneOutward(
  handleHit: number,
  rotateGap: number,
  rotateHit: number
): number {
  return handleHit / 2 + rotateGap + rotateHit / 2;
}

/**
 * Rotate center outward from the path corner (scene units), any zoom:
 * screen-constant hit clearance + stroke outer band (scene).
 * Without stroke, only the screen term applies (rotate outside the box).
 */
export function rotateOutwardScene(
  zoom: number,
  hitScale = 1,
  strokeOuterScene = 0
): number {
  const z = Math.max(0.05, Number(zoom) || 1);
  const inv = 1 / z;
  const hs = Math.max(0.35, hitScale);
  const handleHit = CHROME_HANDLE_HIT_PX * inv * hs;
  const rotateHit = CHROME_ROTATE_HIT_PX * inv * hs;
  const rotateGap = CHROME_ROTATE_GAP_PX * inv;
  return (
    rotateHotzoneOutward(handleHit, rotateGap, rotateHit) +
    strokeOuterForRotateLScene(strokeOuterScene, z)
  );
}

/**
 * Scene pad so resize + rotate hits outside the geom (and chromeOutset) still
 * receive pointer events when the chrome SVG is tight to the box.
 */
export function chromeOutsideHitPadScene(
  inv: number,
  chromeOutset = 0,
  strokePad = 0
): number {
  const outset = Math.max(0, chromeOutset);
  const handleHit = CHROME_HANDLE_HIT_PX * inv;
  const rotateHit = CHROME_ROTATE_HIT_PX * inv;
  const rotateGap = CHROME_ROTATE_GAP_PX * inv;
  const lOut =
    (CHROME_CORNER_L_ARM_PX + CHROME_CORNER_L_THICK_PX + CHROME_CORNER_L_CLEAR_PX) *
      inv +
    (CHROME_HANDLE_VIS_PX / 2) * inv;
  const rotateOuter =
    rotateHotzoneOutward(handleHit, rotateGap, rotateHit) +
    rotateHit / 2 +
    Math.max(0, strokePad);
  return Math.max(strokePad, outset + lOut, outset + rotateOuter);
}

/**
 * Rotate L that wraps each control-box corner from the outside
 * (????????, arms run along the box edges ??not pointing into the
 * outer diagonal.
 */
export function cornerLLocalBars(
  handle: ResizeHandle,
  boxW: number,
  boxH: number,
  arm: number,
  thick: number,
  clear = 0
): Array<{ x: number; y: number; w: number; h: number }> {
  const a = Math.max(1e-6, arm);
  const t = Math.max(1e-6, thick);
  const c = Math.max(0, clear);
  const w = Math.max(1, boxW);
  const h = Math.max(1, boxH);
  if (handle === 'nw') {
    // ?? top arm ??right, left arm ??down
    return [
      { x: -c - t, y: -c - t, w: a + t, h: t },
      { x: -c - t, y: -c, w: t, h: a },
    ];
  }
  if (handle === 'ne') {
    // ?? top arm ??left, right arm ??down
    return [
      { x: w + c - a, y: -c - t, w: a + t, h: t },
      { x: w + c, y: -c, w: t, h: a },
    ];
  }
  if (handle === 'se') {
    // ?? bottom arm ??left, right arm ??up
    return [
      { x: w + c - a, y: h + c, w: a + t, h: t },
      { x: w + c, y: h + c - a, w: t, h: a },
    ];
  }
  if (handle === 'sw') {
    // ?? bottom arm ??right, left arm ??up
    return [
      { x: -c - t, y: h + c, w: a + t, h: t },
      { x: -c - t, y: h + c - a, w: t, h: a },
    ];
  }
  return [];
}

/**
 * One SVG `d` for a rotate L (two rect subpaths in a single path element).
 */
export function cornerLLocalPath(
  handle: ResizeHandle,
  boxW: number,
  boxH: number,
  arm: number,
  thick: number,
  clear = 0
): string {
  return cornerLLocalBars(handle, boxW, boxH, arm, thick, clear)
    .map((b) => `M${b.x} ${b.y}h${b.w}v${b.h}h${-b.w}z`)
    .join('');
}

function pointInLocalAabb(
  lx: number,
  ly: number,
  r: { x: number; y: number; w: number; h: number }
): boolean {
  return lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h;
}

/**
 * True when local point sits on the outside rotate L.
 * Bars plus the concave notch the L frames (visual center of the corner
 * widget). Footprint is clipped to the outside quadrant so the white knob
 * stays on the box corner; core resize still wins when both match.
 */
export function pointInCornerLLocal(
  lx: number,
  ly: number,
  handle: ResizeHandle,
  boxW: number,
  boxH: number,
  arm: number,
  thick: number,
  clear = 0
): boolean {
  const bars = cornerLLocalBars(handle, boxW, boxH, arm, thick, clear);
  for (const bar of bars) {
    if (pointInLocalAabb(lx, ly, bar)) return true;
  }
  if (bars.length < 2) return false;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const bar of bars) {
    minX = Math.min(minX, bar.x);
    minY = Math.min(minY, bar.y);
    maxX = Math.max(maxX, bar.x + bar.w);
    maxY = Math.max(maxY, bar.y + bar.h);
  }
  if (!pointInLocalAabb(lx, ly, { x: minX, y: minY, w: maxX - minX, h: maxY - minY })) {
    return false;
  }
  // Stay outside the box corner (knob sits on 0/w ? 0/h).
  if (handle === 'nw') return lx <= 0 && ly <= 0;
  if (handle === 'ne') return lx >= boxW && ly <= 0;
  if (handle === 'se') return lx >= boxW && ly >= boxH;
  if (handle === 'sw') return lx <= 0 && ly >= boxH;
  return false;
}

/**
 * Screen px from corner (resize / control-box icon center) ??radius seat when R??.
 * Both hits are centered on their icons; axis park `(inset, inset)` clears
 * `halfResizeHit + halfRadiusHit + gap` along each axis ??same screen gap at
 * every zoom so high magnification cannot collapse R-dot onto the corner handle.
 */
export function radiusHandleParkScreenPx(): number {
  return CHROME_HANDLE_HIT_PX / 2 + CHROME_RADIUS_HIT_PX / 2 + CHROME_RADIUS_PARK_GAP_PX;
}

/**
 * Scene park for radius seats at any zoom.
 *
 * Control-box local model (same space as HostPathChrome resize/rotate):
 * - box corners at (0,0) / (w,0) / (w,h) / (0,h)
 * - radius seat at axis inset `(inset, inset)` from that corner
 * - rotate = corner ? `rotateOutwardScene(...)` (screen gap + stroke outer)
 *
 * Total inset = screen park (`parkPx / zoom`) + stroke inner clearance (scene).
 * Stroke width is scene-constant and grows on screen with zoom ??without the
 * stroke term, R-dots sit on the painted stroke at high magnification.
 * Clamped so seats cannot cross the box center.
 */
export function radiusParkSceneForBox(
  boxW: number,
  boxH: number,
  zoom: number,
  parkPx = radiusHandleParkScreenPx(),
  strokeInnerScene = 0
): number {
  const z = Math.max(0.05, Number(zoom) || 1);
  const half = Math.min(Math.max(1, boxW), Math.max(1, boxH)) / 2;
  const fromScreen = Math.max(0, parkPx) / z;
  const total = fromScreen + strokeInnerForRadiusParkScene(strokeInnerScene, z);
  return Math.min(total, half * 0.45);
}

/**
 * True when the box is large enough on screen for radius hits without covering move.
 */
export function radiusHandlesFitOnScreen(
  boxW: number,
  boxH: number,
  zoom: number,
  parkPx = radiusHandleParkScreenPx()
): boolean {
  const z = Math.max(0.05, Number(zoom) || 1);
  const minScreen = Math.min(Math.max(1, boxW), Math.max(1, boxH)) * z;
  return minScreen >= parkPx * 2 + CHROME_HANDLE_HIT_PX;
}

/**
 * Scale chrome hit pads down when the box is tiny on screen so move stays reachable.
 * Driven by on-screen size (any zoom), not a single zoom value.
 */
export function chromeHitScaleForBox(
  boxW: number,
  boxH: number,
  zoom: number,
  minScreenPx = 56
): number {
  const z = Math.max(0.05, Number(zoom) || 1);
  const minScreen = Math.min(Math.max(1, boxW), Math.max(1, boxH)) * z;
  if (minScreen >= minScreenPx) return 1;
  return Math.max(0.35, minScreen / minScreenPx);
}

/**
 * Paint origin for host chrome ? prefer live `transform="translate(L T)"`,
 * else `__sceneLeft/Top`.
 */
export function liveHostPaintOrigin(
  el: Element | null | undefined
): { left: number; top: number } | null {
  if (!el) return null;
  const tf =
    typeof (el as SVGElement).getAttribute === 'function'
      ? (el as SVGElement).getAttribute('transform') || ''
      : '';
  const m =
    /translate\(\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*[, ]\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(
      tf
    );
  if (m) {
    const left = Number(m[1]);
    const top = Number(m[2]);
    if (Number.isFinite(left) && Number.isFinite(top)) return { left, top };
  }
  const left = Number((el as { __sceneLeft?: number }).__sceneLeft);
  const top = Number((el as { __sceneTop?: number }).__sceneTop);
  if (Number.isFinite(left) && Number.isFinite(top)) return { left, top };
  return null;
}

/** Local chrome transform under the canonical scene camera group.
 * Order matches host ink (`reapplySceneTransform`): translate → pivot(R/Sk/Sa/flip).
 */
export function sceneChromeBodyTransform(
  box: { left: number; top: number; width: number; height: number },
  angleDeg: number,
  flipX = false,
  flipY = false,
  anchorX = 50,
  anchorY = 50,
  skewXDeg = 0,
  skewAxisDeg = 0
): string {
  const w = Math.max(1, Number(box.width) || 1);
  const h = Math.max(1, Number(box.height) || 1);
  const ax = Math.max(0, Math.min(100, Number(anchorX) || 0));
  const ay = Math.max(0, Math.min(100, Number(anchorY) || 0));
  const cx = (w * ax) / 100;
  const cy = (h * ay) / 100;
  const parts = [`translate(${box.left} ${box.top})`];
  const angle = Number(angleDeg) || 0;
  const skewX = Number(skewXDeg) || 0;
  const skewAxis = Number(skewAxisDeg) || 0;
  const needPivot =
    Math.abs(angle) > 0.01 ||
    flipX ||
    flipY ||
    Math.abs(skewX) > 1e-6 ||
    Math.abs(skewAxis) > 1e-6;
  if (needPivot) {
    parts.push(`translate(${cx} ${cy})`);
    if (Math.abs(angle) > 0.01) parts.push(`rotate(${angle})`);
    // AE-style: rotate(Sa) → skewX(Sk) → rotate(-Sa), same as scene ink.
    if (Math.abs(skewAxis) > 1e-6) parts.push(`rotate(${skewAxis})`);
    if (Math.abs(skewX) > 1e-6) parts.push(`skewX(${skewX})`);
    if (Math.abs(skewAxis) > 1e-6) parts.push(`rotate(${-skewAxis})`);
    if (flipX || flipY) {
      parts.push(`scale(${flipX ? -1 : 1} ${flipY ? -1 : 1})`);
    }
    parts.push(`translate(${-cx} ${-cy})`);
  }
  return parts.join(' ');
}

/**
 * Shape-knob SVG shell on the screen overlay (ADR 0027).
 * Paint only (`pe:none`) ? SelectionFeature hits via geometry / world pads.
 */
export function WorldSvgFrame({
  nodeId,
  left,
  top,
  width,
  height,
  angle = 0,
  pad: _pad = 0,
  zClass = 'z-[18]',
  pointerEvents = 'none',
  children,
  sceneChildren,
}: {
  nodeId?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  angle?: number;
  pad?: number;
  zClass?: string;
  pointerEvents?: 'none' | 'auto';
  children: ReactNode;
  sceneChildren?: ReactNode;
}) {
  const [hostEpoch, setHostEpoch] = useState(0);
  useEffect(() => {
    if (!nodeId) return undefined;
    return subscribeShapeHosts(() => setHostEpoch((n) => n + 1));
  }, [nodeId]);

  const box = { left, top, width, height };
  const el = nodeId
    ? ((getShapeHost(nodeId)?.el || getSharedNodeEls()?.get(nodeId)) as
        | SVGElement
        | null
        | undefined)
    : null;
  const localChrome = Boolean(nodeId);
  const hostAny = el as {
    __sceneAnchorX?: number;
    __sceneAnchorY?: number;
    __sceneSkewX?: number;
    __sceneSkewAxis?: number;
  } | null;
  const anchorX = Math.max(0, Math.min(100, Number(hostAny?.__sceneAnchorX ?? 50)));
  const anchorY = Math.max(0, Math.min(100, Number(hostAny?.__sceneAnchorY ?? 50)));
  const skewX = Number(hostAny?.__sceneSkewX) || 0;
  const skewAxis = Number(hostAny?.__sceneSkewAxis) || 0;

  const bodyTransform = localChrome
    ? sceneChromeBodyTransform(box, angle, false, false, anchorX, anchorY, skewX, skewAxis)
    : undefined;
  const mount = getSceneSelectionChromeMount();

  useLayoutEffect(() => {
    if (mount) return undefined;
    const raf = requestAnimationFrame(() => setHostEpoch((n) => n + 1));
    return () => cancelAnimationFrame(raf);
  }, [mount]);

  if (!mount) return null;

  return createPortal(
    <g
      key={localChrome ? hostEpoch : undefined}
      data-rcb-scene-svg-frame={nodeId || 'scene'}
      data-rcb-chrome-class={zClass}
      style={{ pointerEvents }}
      aria-hidden
    >
      {bodyTransform ? (
        <g transform={bodyTransform} style={{ pointerEvents: 'none' }}>
          {children}
        </g>
      ) : children}
      {sceneChildren}
    </g>,
    mount
  );
}

export function WorldScreenBadge({
  text,
  x,
  y,
  inv,
  anchor = 'above',
  fill = '#3388ff',
  clearance = 0,
}: {
  text: string;
  x: number;
  y: number;
  /** Scene units per screen px (= 1 / camera.zoom). */
  inv: number;
  anchor?: 'center' | 'below' | 'above' | 'right';
  fill?: string;
  clearance?: number;
}) {
  const fontSize = 11 * inv;
  const padX = 5.5 * inv;
  const padY = 2.25 * inv;
  const radius = 4 * inv;
  const gap = Math.max(6 * inv, clearance);
  const tw = Math.max(14 * inv, String(text).length * fontSize * 0.62);
  const th = fontSize * 1.2;
  const w = tw + padX * 2;
  const h = th + padY * 2;
  let cx = x;
  let cy = y;
  if (anchor === 'below') cy = y + gap + h / 2;
  else if (anchor === 'above') cy = y - gap - h / 2;
  else if (anchor === 'right') cx = x + gap + w / 2;
  return (
    <g pointerEvents="none">
      <rect
        x={cx - w / 2}
        y={cy - h / 2}
        width={w}
        height={h}
        rx={radius}
        ry={radius}
        fill={fill}
      />
      <text
        x={cx}
        y={cy}
        fill="#ffffff"
        fontSize={fontSize}
        fontWeight={600}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {text}
      </text>
    </g>
  );
}

const HANDLE_DIR_DEG: Record<ResizeHandle, number> = {
  e: 0,
  se: 45,
  s: 90,
  sw: 135,
  w: 180,
  nw: 225,
  n: 270,
  ne: 315,
};

export function cursorForResize(handle: ResizeHandle, angleDeg: number): string {
  const dirs = [
    'e-resize',
    'se-resize',
    's-resize',
    'sw-resize',
    'w-resize',
    'nw-resize',
    'n-resize',
    'ne-resize',
  ];
  const base = HANDLE_DIR_DEG[handle];
  const idx = Math.round(((((base + angleDeg) % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}

/** Cursors set on the stage hit layer while hovering selection chrome handles. */
export function isSelectionChromeCursor(cursor: string): boolean {
  const c = String(cursor || '').trim();
  if (!c) return false;
  if (c.startsWith('url(')) return true;
  if (c === 'default') return true;
  return /resize|grab|alias|crosshair|pointer/.test(c);
}

export function clearSelectionChromeCursor(el: HTMLElement | null | undefined): void {
  if (!el) return;
  if (isSelectionChromeCursor(el.style.cursor)) el.style.cursor = '';
}

/**
 * Hit range around a painted control center (scene units).
 * Screen radius = half the painted size ? hitScale ??pointer near the point, not a DOM pad.
 */
export function chromeHandleHitRadiusScene(
  zoom: number,
  sizePx: number = CHROME_HANDLE_HIT_PX,
  hitScale = 1
): number {
  const z = Math.max(0.05, Number(zoom) || 1);
  const screenR = (Math.max(1, sizePx) * Math.max(0.35, hitScale)) / 2;
  return screenR / z;
}

export type ChromeHandlePick =
  | { kind: 'resize'; handle: ResizeHandle; x: number; y: number }
  | { kind: 'endpoint'; handle: 'w' | 'e'; x: number; y: number }
  | { kind: 'rotate'; corner: 'nw' | 'ne' | 'se' | 'sw'; x: number; y: number };

export type PaintedHitZonePick =
  | { kind: 'resize'; handle: ResizeHandle; key: string }
  | { kind: 'rotate'; corner: 'nw' | 'ne' | 'se' | 'sw'; key: string }
  | { kind: 'radius'; key: string }
  | { kind: 'shape'; key: string }
  | { kind: 'pen-anchor'; key: string; sub: number; index: number }
  | { kind: 'pen-handle'; key: string; sub: number; index: number; side: 'in' | 'out' };

/** Options for {@link pickChromeHandleAtClient} / geometry pick. */
export type ChromeHandlePickOpts = {
  showRotate?: boolean;
  showHandles?: boolean;
  /** Control-box scene AABB ? same lattice as painted knobs / rotate L. */
  box?: SceneBox;
  angle?: number;
  zoom?: number;
  strokeOuterScene?: number;
  cornerHandlesOnly?: boolean;
  edgeHandles?: 'all' | 'horizontal' | 'none' | 'se-only';
  lineMode?: boolean;
  /** Scene point under the pointer (preferred over clientToScene). */
  scene?: { x: number; y: number };
  /** Client ? scene when `scene` is omitted. */
  clientToScene?: (clientX: number, clientY: number) => { x: number; y: number };
};

const RESIZE_HANDLE_DIRS = new Set<string>(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);

/**
 * Paint params for rotate L / knobs ? must match HostPathChrome + SelectionChrome ink.
 */
export function chromePaintMetrics(
  boxW: number,
  boxH: number,
  zoom: number,
  strokeOuterScene = 0
) {
  const z = Math.max(0.05, Number(zoom) || 1);
  const inv = 1 / z;
  const hitScale = chromeHitScaleForBox(boxW, boxH, z);
  const hs = Math.max(0.35, hitScale);
  const handleVis = CHROME_HANDLE_VIS_PX * inv;
  const halfVis = handleVis / 2;
  const lArm = CHROME_CORNER_L_ARM_PX * inv * hs;
  const lThick = CHROME_CORNER_L_THICK_PX * inv * hs;
  const lClear =
    halfVis +
    CHROME_CORNER_L_CLEAR_PX * inv * hs +
    strokeOuterForRotateLScene(strokeOuterScene, z);
  const hitR = chromeHandleHitRadiusScene(z, CHROME_HANDLE_HIT_PX, hs);
  return { z, inv, hitScale: hs, handleVis, halfVis, lArm, lThick, lClear, hitR };
}

/**
 * Scene-space chrome pick ? same numbers as SVG ink.
 * Prefer this under camera `scale(zoom)`: SVG GBR / pe drifts from paint;
 * geometry stays on the ink lattice.
 */
export function pickChromeHandleByGeometry(
  sceneX: number,
  sceneY: number,
  opts: {
    box: SceneBox;
    angle?: number;
    zoom: number;
    strokeOuterScene?: number;
    showRotate?: boolean;
    showHandles?: boolean;
    cornerHandlesOnly?: boolean;
    edgeHandles?: 'all' | 'horizontal' | 'none' | 'se-only';
    lineMode?: boolean;
  }
): ChromeHandlePick | null {
  if (opts.showHandles === false) return null;
  if (![sceneX, sceneY].every(Number.isFinite)) return null;
  const box = opts.box;
  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  const angle = Number(opts.angle) || 0;
  const m = chromePaintMetrics(w, h, opts.zoom, opts.strokeOuterScene);
  const local = sceneToLocal(sceneX, sceneY, box, angle);

  if (opts.lineMode) {
    const ends: Array<['w' | 'e', number, number]> = [
      ['w', 0, h / 2],
      ['e', w, h / 2],
    ];
    let best: { handle: 'w' | 'e'; d2: number } | null = null;
    for (const [handle, lx, ly] of ends) {
      const d2 = (local.x - lx) ** 2 + (local.y - ly) ** 2;
      if (d2 > m.hitR * m.hitR) continue;
      if (!best || d2 < best.d2) best = { handle, d2 };
    }
    if (best) {
      return { kind: 'endpoint', handle: best.handle, x: sceneX, y: sceneY };
    }
    return null;
  }

  const knobs = selectResizeKnobs({
    lineMode: false,
    cornerHandlesOnly: Boolean(opts.cornerHandlesOnly),
    edgeHandles: opts.edgeHandles || 'all',
    w,
    h,
  });
  // Corners last in the list ? when distances tie, prefer the later (corner) knob.
  let resize: { handle: ResizeHandle; d2: number } | null = null;
  for (const [handle, lx, ly] of knobs) {
    const d2 = (local.x - lx) ** 2 + (local.y - ly) ** 2;
    if (d2 > m.hitR * m.hitR) continue;
    if (!resize || d2 < resize.d2 - 1e-9 || (Math.abs(d2 - resize.d2) <= 1e-9 && isCornerHandle(handle))) {
      resize = { handle, d2 };
    }
  }
  if (resize) {
    return { kind: 'resize', handle: resize.handle, x: sceneX, y: sceneY };
  }

  if (opts.showRotate === false) return null;
  for (const corner of ['nw', 'ne', 'se', 'sw'] as const) {
    if (
      pointInCornerLLocal(local.x, local.y, corner, w, h, m.lArm, m.lThick, m.lClear)
    ) {
      return { kind: 'rotate', corner, x: sceneX, y: sceneY };
    }
  }
  return null;
}

export function chromeHandleFromEventTarget(
  target: EventTarget | null,
  opts?: { showRotate?: boolean; showHandles?: boolean }
): ChromeHandlePick | null {
  const el = target as Element | null;
  if (!el?.closest || opts?.showHandles === false) return null;

  const knob = el.closest('[data-rcb-sel-knob]');
  if (knob) {
    const dir = String(knob.getAttribute('data-rcb-sel-knob') || '');
    if (RESIZE_HANDLE_DIRS.has(dir)) {
      const rect = knob.getBoundingClientRect();
      return {
        kind: 'resize',
        handle: dir as ResizeHandle,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }
  }

  if (opts?.showRotate === false) return null;
  const leg = el.closest('[data-rcb-sel-rotate-l]');
  if (leg) {
    const corner = String(leg.getAttribute('data-rcb-sel-rotate-l') || '');
    if (corner === 'nw' || corner === 'ne' || corner === 'se' || corner === 'sw') {
      const rect = leg.getBoundingClientRect();
      return {
        kind: 'rotate',
        corner,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }
  }
  return null;
}

export function overlayHandleFromEventTarget(
  target: EventTarget | null
): PaintedHitZonePick | null {
  const el = target as Element | null;
  if (!el?.closest) return null;
  const radius = el.closest('[data-radius-handle]');
  if (radius) {
    return { kind: 'radius', key: `radius-${radius.getAttribute('data-radius-handle') || ''}` };
  }
  const star = el.closest('[data-star-handle]');
  if (star) {
    return { kind: 'shape', key: `star-${star.getAttribute('data-star-handle') || ''}` };
  }
  const poly = el.closest('[data-poly-handle]');
  if (poly) {
    return { kind: 'shape', key: `poly-${poly.getAttribute('data-poly-handle') || ''}` };
  }
  const circle = el.closest('[data-circle-handle]');
  if (circle) {
    return { kind: 'shape', key: `circle-${circle.getAttribute('data-circle-handle') || ''}` };
  }
  return null;
}

/** One painted control under the cursor: overlay dot or chrome knob / rotate-L. */
export type SelectionInkPick =
  | { layer: 'overlay'; pick: PaintedHitZonePick }
  | { layer: 'chrome'; pick: ChromeHandlePick };

/**
 * Overlay seats register here; SelectionFeature is the only pointerdown owner.
 * Overlays paint ink + publish start/dblclick/hover ? no parallel capture listeners.
 * Optional sceneX/Y/half feed {@link setChromeKnobHits} for geometry picks (ADR 0027).
 */
export type OverlayHandleSeat = {
  /** Matches {@link PaintedHitZonePick}.key (`radius-tr`, `circle-start`, ?). */
  pickKey: string;
  interactive?: boolean;
  start: (e: PointerEvent) => void;
  onDoubleClick?: (e: MouseEvent) => void;
  onEnter?: () => void;
  onLeave?: () => void;
  /** Scene center for geometry hit (preferred over DOM stack). */
  sceneX?: number;
  sceneY?: number;
  /** Scene half-extent of square AABB hit. */
  half?: number;
};

const overlayHandleSeatsByOwner = new Map<string, OverlayHandleSeat[]>();

function overlayKnobKindFromPickKey(pickKey: string): ChromeKnobKind | null {
  if (pickKey.startsWith('radius-')) return 'radius';
  if (
    pickKey.startsWith('star-') ||
    pickKey.startsWith('poly-') ||
    pickKey.startsWith('circle-')
  ) {
    return 'shape';
  }
  return null;
}

export function setOverlayHandleSeats(
  ownerId: string,
  seats: OverlayHandleSeat[] | null
): void {
  if (!seats?.length) {
    overlayHandleSeatsByOwner.delete(ownerId);
    clearChromeKnobHits(ownerId);
    return;
  }
  overlayHandleSeatsByOwner.set(ownerId, seats);
  const knobs: ChromeKnobHit[] = [];
  for (const seat of seats) {
    const kind = overlayKnobKindFromPickKey(seat.pickKey);
    const half = Number(seat.half);
    const x = Number(seat.sceneX);
    const y = Number(seat.sceneY);
    if (!kind || !(half > 0) || ![x, y].every(Number.isFinite)) continue;
    knobs.push({
      ownerId,
      kind,
      key: seat.pickKey,
      x,
      y,
      half,
    });
  }
  setChromeKnobHits(ownerId, knobs);
}

export function findOverlayHandleSeat(pickKey: string): OverlayHandleSeat | null {
  for (const seats of overlayHandleSeatsByOwner.values()) {
    for (let i = 0; i < seats.length; i += 1) {
      if (seats[i].pickKey === pickKey) return seats[i];
    }
  }
  return null;
}

export function tryStartOverlayHandleSeat(
  pick: PaintedHitZonePick,
  e: PointerEvent
): boolean {
  if (pick.kind !== 'radius' && pick.kind !== 'shape') return false;
  const seat = findOverlayHandleSeat(pick.key);
  if (!seat || seat.interactive === false) return false;
  seat.start(e);
  return true;
}

export function tryOverlayHandleDoubleClick(
  pick: PaintedHitZonePick,
  e: MouseEvent
): boolean {
  if (pick.kind !== 'radius' && pick.kind !== 'shape') return false;
  const seat = findOverlayHandleSeat(pick.key);
  if (!seat?.onDoubleClick) return false;
  seat.onDoubleClick(e);
  return true;
}

/** Circle start-angle hover (and any future seat enter/leave). */
export function syncOverlayHandleHoverAtClient(
  clientX: number,
  clientY: number,
  target?: EventTarget | null,
  scene?: { x: number; y: number } | null
): void {
  const painted = pickOverlayHandleAtClient(clientX, clientY, target ?? null, scene);
  for (const seats of overlayHandleSeatsByOwner.values()) {
    for (let i = 0; i < seats.length; i += 1) {
      const seat = seats[i];
      if (!seat.onEnter && !seat.onLeave) continue;
      if (painted && painted.key === seat.pickKey) seat.onEnter?.();
      else seat.onLeave?.();
    }
  }
}

export function selectionInkFromEventTarget(
  target: EventTarget | null,
  opts?: ChromeHandlePickOpts
): SelectionInkPick | null {
  const overlay = overlayHandleFromEventTarget(target);
  if (overlay) return { layer: 'overlay', pick: overlay };
  const chrome = chromeHandleFromEventTarget(target, opts);
  if (chrome) return { layer: 'chrome', pick: chrome };
  return null;
}

/**
 * Single hit path for resize / rotate / radius / shape ink (ADR 0027):
 * 1. Overlay seats (radius / poly / star / circle) via **scene geometry** registry
 * 2. Chrome resize / rotate ? **scene geometry** (CameraTransform lattice)
 * 3. Legacy DOM chrome / overlay attrs only when geometry opts are incomplete
 */
export function pickSelectionInkAtClient(
  clientX: number,
  clientY: number,
  target: EventTarget | null | undefined,
  opts?: ChromeHandlePickOpts
): SelectionInkPick | null {
  let scene = opts?.scene;
  if (
    (!scene || ![scene.x, scene.y].every(Number.isFinite)) &&
    opts?.clientToScene &&
    [clientX, clientY].every(Number.isFinite)
  ) {
    scene = opts.clientToScene(clientX, clientY);
  }

  // 1) Overlay knobs by scene AABB (same store as path-edit / setOverlayHandleSeats).
  if (scene && [scene.x, scene.y].every(Number.isFinite)) {
    const knob = pickChromeKnobHit(scene.x, scene.y);
    if (knob?.kind === 'radius' || knob?.kind === 'shape') {
      return { layer: 'overlay', pick: knob };
    }
  }

  // 1b) DOM stack fallback when registry has no scene seats (unit tests / incomplete publish).
  if (typeof document !== 'undefined' && [clientX, clientY].every(Number.isFinite)) {
    const stack = document.elementsFromPoint(clientX, clientY);
    for (let i = 0; i < stack.length; i += 1) {
      const overlay = overlayHandleFromEventTarget(stack[i]);
      if (overlay) return { layer: 'overlay', pick: overlay };
    }
  } else {
    const overlay = overlayHandleFromEventTarget(target ?? null);
    if (overlay) return { layer: 'overlay', pick: overlay };
  }

  // 2) Chrome by scene geometry ? not SVG pe / getBoundingClientRect.
  const box = opts?.box;
  const zoom = opts?.zoom;
  if (
    box &&
    zoom != null &&
    Number.isFinite(zoom) &&
    scene &&
    [scene.x, scene.y].every(Number.isFinite) &&
    opts?.showHandles !== false
  ) {
    const geo = pickChromeHandleByGeometry(scene.x, scene.y, {
      box,
      angle: opts.angle,
      zoom,
      strokeOuterScene: opts.strokeOuterScene,
      showRotate: opts.showRotate,
      showHandles: opts.showHandles,
      cornerHandlesOnly: opts.cornerHandlesOnly,
      edgeHandles: opts.edgeHandles,
      lineMode: opts.lineMode,
    });
    if (geo) return { layer: 'chrome', pick: geo };
  }

  // 3) Legacy DOM chrome when geometry cannot run (missing box / zoom / scene).
  if (typeof document !== 'undefined' && [clientX, clientY].every(Number.isFinite)) {
    const stack = document.elementsFromPoint(clientX, clientY);
    for (let i = 0; i < stack.length; i += 1) {
      const chrome = chromeHandleFromEventTarget(stack[i], opts);
      if (chrome) return { layer: 'chrome', pick: chrome };
    }
  }
  const chrome = chromeHandleFromEventTarget(target ?? null, opts);
  if (chrome) return { layer: 'chrome', pick: chrome };
  return null;
}

export function pickChromeHandleAtClient(
  clientX: number,
  clientY: number,
  target: EventTarget | null | undefined,
  opts?: ChromeHandlePickOpts
): ChromeHandlePick | null {
  const ink = pickSelectionInkAtClient(clientX, clientY, target, opts);
  if (ink?.layer === 'chrome') return ink.pick;
  return null;
}

export function pickOverlayHandleAtClient(
  clientX: number,
  clientY: number,
  target?: EventTarget | null,
  scene?: { x: number; y: number } | null
): PaintedHitZonePick | null {
  if (scene && [scene.x, scene.y].every(Number.isFinite)) {
    const knob = pickChromeKnobHit(scene.x, scene.y);
    if (knob?.kind === 'radius' || knob?.kind === 'shape') return knob;
  }
  if (typeof document !== 'undefined' && [clientX, clientY].every(Number.isFinite)) {
    const stack = document.elementsFromPoint(clientX, clientY);
    for (let i = 0; i < stack.length; i += 1) {
      const pick = overlayHandleFromEventTarget(stack[i]);
      if (pick) return pick;
    }
  }
  return overlayHandleFromEventTarget(target ?? null);
}

/** One HTML div hotzone per control (pick + debug paint). */
export const RCB_HIT_ZONE_ATTR = 'data-rcb-hit-zone';
/** Invisible SVG (or knob) center this div follows; prefer scene attrs. */
export const RCB_HIT_ANCHOR_ATTR = 'data-rcb-hit-anchor';
export const RCB_HIT_OWNER_ATTR = 'data-rcb-hit-owner';
export const RCB_HIT_PAD_ATTR = 'data-rcb-hit-pad';
export const RCB_HIT_SIZE_ATTR = 'data-rcb-hit-size';
/** Scene (board) X ??same space as world SVG / smart guides. */
export const RCB_HIT_SCENE_X_ATTR = 'data-rcb-hit-scene-x';
/** Scene (board) Y. */
export const RCB_HIT_SCENE_Y_ATTR = 'data-rcb-hit-scene-y';
/**
 * Imperative HostPathChrome / path-edit pads only. React {@link ChromeHitPad}
 * portals must never be removed by DOM code - that races React unmount
 * (`removeChild` crash).
 */
export const RCB_HIT_DOM_ATTR = 'data-rcb-hit-dom';
export const RCB_HIT_REACT_ATTR = 'data-rcb-hit-react';
/** HTML hit-pad layer under `[data-rcb-overlay]` (screen space, ADR 0027). */
export const RCB_HIT_LAYER_ATTR = 'data-rcb-hit-pad-layer';

/**
 * Hit pads live on the **unscaled** overlay (same surface as selection chrome).
 * Placement uses CameraTransform `worldToScreen`; size is screen px - no world
 * `scale(zoom)` and no `1/zoom` counter-size.
 */
export function chromeHitPadOverlayRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const overlay = document.querySelector(
    '[data-rcb-canvas] [data-rcb-overlay="1"]'
  ) as HTMLElement | null;
  if (!overlay) return null;
  let layer = overlay.querySelector(
    `:scope > [${RCB_HIT_LAYER_ATTR}]`
  ) as HTMLElement | null;
  if (!layer) {
    layer = document.createElement('div');
    layer.setAttribute(RCB_HIT_LAYER_ATTR, '1');
    // pe:none shell, pe:auto pads - sibling of sel-chrome-layer under overlay.
    layer.className = 'pointer-events-none absolute left-0 top-0 overflow-visible';
    layer.style.width = '0';
    layer.style.height = '0';
    layer.style.zIndex = '22';
    overlay.appendChild(layer);
  }
  layer.style.pointerEvents = 'none';
  return layer;
}

/** Alias of {@link chromeHitPadOverlayRoot}. */
export function chromeHitPadWorldRoot(): HTMLElement | null {
  return chromeHitPadOverlayRoot();
}

function paintHitPadLook(
  pad: HTMLElement,
  opts: { cursor: string; dashed?: boolean; visibleKnob?: boolean; color?: string }
) {
  pad.style.cursor = opts.cursor;
  pad.style.boxSizing = 'border-box';
  pad.style.pointerEvents = 'auto';
  pad.style.zIndex = '2';
  if (opts.visibleKnob) {
    // HTML ink + hit (same box). SVG pe/GBR under camera scale drifts from paint.
    const color = opts.color || '#3388ff';
    pad.style.borderRadius = '0';
    pad.style.background = '#ffffff';
    pad.style.border = `1.5px solid ${color}`;
    return;
  }
  pad.style.borderRadius = '50%';
  pad.style.background = 'transparent';
  pad.style.border = 'none';
}

/**
 * Place a hit div in screen space under the overlay.
 *
 * - left/top = CameraTransform worldToScreen(scene) (stage-local px)
 * - width/height = sizePx screen pixels (constant under zoom)
 * - Scene coords kept on data attrs for sync / registry alignment
 */
export function placeHitPadAtScene(
  pad: HTMLElement,
  sceneX: number,
  sceneY: number,
  sizePx: number,
  camera: RcbCamera,
  root?: HTMLElement | null,
  dpr?: number
): boolean {
  const layer =
    root ||
    (pad.parentElement as HTMLElement | null) ||
    chromeHitPadOverlayRoot();
  if (!layer) return false;
  if (![sceneX, sceneY].every(Number.isFinite)) return false;
  const cam = createCameraTransform(camera, dpr ?? 1);
  const screen = worldToScreen(cam, sceneX, sceneY);
  const screenSize = Math.max(1, sizePx);
  pad.style.position = 'absolute';
  pad.style.left = `${screen.x}px`;
  pad.style.top = `${screen.y}px`;
  pad.style.width = `${screenSize}px`;
  pad.style.height = `${screenSize}px`;
  pad.style.transform = 'translate(-50%, -50%)';
  pad.setAttribute(RCB_HIT_SIZE_ATTR, String(Math.max(1, sizePx)));
  pad.setAttribute(RCB_HIT_SCENE_X_ATTR, String(sceneX));
  pad.setAttribute(RCB_HIT_SCENE_Y_ATTR, String(sceneY));
  return true;
}

/**
 * Axis-aligned rect: scene to screen via CameraTransform (rotate-L bars).
 */
export function placeChromeRectAtScene(
  pad: HTMLElement,
  sceneX: number,
  sceneY: number,
  sceneW: number,
  sceneH: number,
  camera: RcbCamera = { x: 0, y: 0, zoom: 1 },
  dpr = 1
): boolean {
  if (![sceneX, sceneY, sceneW, sceneH].every(Number.isFinite)) return false;
  const cam = createCameraTransform(camera, dpr);
  const z = cameraZoom(cam);
  const tl = worldToScreen(cam, sceneX, sceneY);
  pad.style.position = 'absolute';
  pad.style.left = `${tl.x}px`;
  pad.style.top = `${tl.y}px`;
  pad.style.width = `${Math.max(1e-6, sceneW * z)}px`;
  pad.style.height = `${Math.max(1e-6, sceneH * z)}px`;
  pad.style.transform = 'none';
  pad.setAttribute(RCB_HIT_SCENE_X_ATTR, String(sceneX));
  pad.setAttribute(RCB_HIT_SCENE_Y_ATTR, String(sceneY));
  return true;
}

export function clearChromeHitPads(ownerId: string) {
  const layer = chromeHitPadOverlayRoot();
  if (!layer) return;
  layer
    .querySelectorAll(
      `[${RCB_HIT_DOM_ATTR}][${RCB_HIT_OWNER_ATTR}="${CSS.escape(ownerId)}"]`
    )
    .forEach((n) => {
      try {
        n.remove();
      } catch {
        /* ignore */
      }
    });
}

/**
 * Re-place each div from stored scene coords + current camera
 * (screen size stays sizePx; left/top via worldToScreen).
 */
export function syncChromeHitPads(
  camera: RcbCamera,
  opts?: { ownerId?: string; dpr?: number }
) {
  const layer = chromeHitPadOverlayRoot();
  if (!layer) return;
  const ownerId = opts?.ownerId;
  const pads = ownerId
    ? layer.querySelectorAll(
        `[${RCB_HIT_PAD_ATTR}][${RCB_HIT_OWNER_ATTR}="${CSS.escape(ownerId)}"]`
      )
    : layer.querySelectorAll(`[${RCB_HIT_PAD_ATTR}]`);
  for (let i = 0; i < pads.length; i += 1) {
    const pad = pads[i] as HTMLElement;
    const sx = Number(pad.getAttribute(RCB_HIT_SCENE_X_ATTR));
    const sy = Number(pad.getAttribute(RCB_HIT_SCENE_Y_ATTR));
    if (![sx, sy].every(Number.isFinite)) continue;
    const size =
      Number(pad.getAttribute(RCB_HIT_SIZE_ATTR)) || CHROME_HANDLE_HIT_PX;
    placeHitPadAtScene(pad, sx, sy, size, camera, layer, opts?.dpr);
  }
}

/**
 * Imperative: one overlay div for a control at board (scene) coords.
 * Call {@link syncChromeHitPads} after camera updates.
 */
export function mountChromeHitPad(opts: {
  ownerId: string;
  zoneKey: string;
  sizePx: number;
  cursor: string;
  dashed?: boolean;
  visibleKnob?: boolean;
  color?: string;
  ariaLabel?: string;
  sceneX: number;
  sceneY: number;
  camera: RcbCamera;
  dpr?: number;
  /** DOM attrs for SelectionFeature chromeHandleFromEventTarget. */
  knobDir?: string;
  rotateCorner?: string;
}): HTMLElement | null {
  const layer = chromeHitPadOverlayRoot();
  if (!layer) return null;

  // Only replace imperative pads ? never React portal nodes.
  layer
    .querySelectorAll(
      `[${RCB_HIT_DOM_ATTR}][${RCB_HIT_OWNER_ATTR}="${CSS.escape(opts.ownerId)}"][${RCB_HIT_ZONE_ATTR}="${CSS.escape(opts.zoneKey)}"]`
    )
    .forEach((n) => n.remove());

  const pad = document.createElement('div');
  pad.setAttribute(RCB_HIT_PAD_ATTR, '1');
  pad.setAttribute(RCB_HIT_DOM_ATTR, '1');
  pad.setAttribute(RCB_HIT_ZONE_ATTR, opts.zoneKey);
  pad.setAttribute(RCB_HIT_OWNER_ATTR, opts.ownerId);
  pad.setAttribute('role', 'button');
  if (opts.ariaLabel) pad.setAttribute('aria-label', opts.ariaLabel);
  if (opts.knobDir) pad.setAttribute('data-rcb-sel-knob', opts.knobDir);
  if (opts.rotateCorner) pad.setAttribute('data-rcb-sel-rotate-l', opts.rotateCorner);
  paintHitPadLook(pad, opts);
  layer.appendChild(pad);
  placeHitPadAtScene(
    pad,
    opts.sceneX,
    opts.sceneY,
    opts.sizePx,
    opts.camera,
    layer,
    opts.dpr
  );
  return pad;
}

/** Imperative rotate-L bar — screen-space HTML ink + hit. */
export function mountChromeRectPad(opts: {
  ownerId: string;
  zoneKey: string;
  cursor: string;
  color?: string;
  sceneX: number;
  sceneY: number;
  sceneW: number;
  sceneH: number;
  rotateCorner: string;
  camera: RcbCamera;
  dpr?: number;
}): HTMLElement | null {
  const layer = chromeHitPadOverlayRoot();
  if (!layer) return null;
  layer
    .querySelectorAll(
      `[${RCB_HIT_DOM_ATTR}][${RCB_HIT_OWNER_ATTR}="${CSS.escape(opts.ownerId)}"][${RCB_HIT_ZONE_ATTR}="${CSS.escape(opts.zoneKey)}"]`
    )
    .forEach((n) => n.remove());

  const pad = document.createElement('div');
  pad.setAttribute(RCB_HIT_PAD_ATTR, '1');
  pad.setAttribute(RCB_HIT_DOM_ATTR, '1');
  pad.setAttribute(RCB_HIT_ZONE_ATTR, opts.zoneKey);
  pad.setAttribute(RCB_HIT_OWNER_ATTR, opts.ownerId);
  pad.setAttribute('data-rcb-sel-rotate-l', opts.rotateCorner);
  pad.setAttribute('role', 'button');
  pad.setAttribute('aria-label', 'Rotate');
  pad.style.cursor = opts.cursor;
  pad.style.boxSizing = 'border-box';
  pad.style.pointerEvents = 'auto';
  pad.style.zIndex = '1';
  // Keep the hit pad transparent; rotation is picked by geometry.
  pad.style.background = 'transparent';
  pad.style.border = 'none';
  pad.style.borderRadius = '0';
  layer.appendChild(pad);
  placeChromeRectAtScene(
    pad,
    opts.sceneX,
    opts.sceneY,
    opts.sceneW,
    opts.sceneH,
    opts.camera,
    opts.dpr
  );
  return pad;
}

export function ChromeHitPad({
  sceneX,
  sceneY,
  sizePx,
  zoneKey,
  ownerId = '',
  cursor,
  dashed = false,
  onPointerDown,
  onDoubleClick,
  onPointerEnter,
  onPointerLeave,
}: {
  /** Board / world scene X (placed via worldToScreen). */
  sceneX: number;
  /** Board / world scene Y. */
  sceneY: number;
  /** Screen-px diameter (constant under zoom). */
  sizePx: number;
  zoneKey: string;
  ownerId?: string;
  cursor: string;
  dashed?: boolean;
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onDoubleClick?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerEnter?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerLeave?: (e: ReactPointerEvent<HTMLDivElement>) => void;
}): ReactNode {
  const camera = useRcbCamera();
  const dpr = useRcbDevicePixelRatio();
  const padRef = useRef<HTMLDivElement | null>(null);
  const layer = chromeHitPadOverlayRoot();

  useLayoutEffect(() => {
    const sync = () => {
      const p = padRef.current;
      const root = chromeHitPadOverlayRoot();
      if (!p || !root) return;
      placeHitPadAtScene(p, sceneX, sceneY, sizePx, camera, root, dpr);
    };
    sync();
    const raf = requestAnimationFrame(sync);
    const unsub = subscribeShapeHosts(sync);
    return () => {
      cancelAnimationFrame(raf);
      unsub();
    };
  }, [
    sizePx,
    zoneKey,
    ownerId,
    sceneX,
    sceneY,
    camera.x,
    camera.y,
    camera.zoom,
    dpr,
  ]);

  if (layer == null) return null;
  return createPortal(
    <div
      ref={padRef}
      {...{
        [RCB_HIT_PAD_ATTR]: '1',
        [RCB_HIT_REACT_ATTR]: '1',
        [RCB_HIT_ZONE_ATTR]: zoneKey,
        [RCB_HIT_OWNER_ATTR]: ownerId,
        [RCB_HIT_SIZE_ATTR]: String(Math.max(1, sizePx)),
        [RCB_HIT_SCENE_X_ATTR]: String(sceneX),
        [RCB_HIT_SCENE_Y_ATTR]: String(sceneY),
      }}
      role="button"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{
        position: 'absolute',
        boxSizing: 'border-box',
        borderRadius: '50%',
        pointerEvents: 'auto',
        zIndex: 2,
        cursor,
        background: 'transparent',
        border: 'none',
      }}
    />,
    layer
  );
}

/** Alias of ChromeHitPad. */
export const ChromeSvgHitPad = ChromeHitPad;

function parseHitZoneKey(key: string): PaintedHitZonePick | null {
  const k = String(key || '');
  if (!k) return null;
  const resizeHandles = new Set<ResizeHandle>(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);
  if (k.startsWith('resize-') || k.startsWith('ep-')) {
    const handle = k.slice(k.indexOf('-') + 1) as ResizeHandle;
    if (resizeHandles.has(handle)) {
      return { kind: 'resize', handle, key: k };
    }
  }
  if (k.startsWith('rot-')) {
    const corner = k.slice(4) as 'nw' | 'ne' | 'se' | 'sw';
    if (corner === 'nw' || corner === 'ne' || corner === 'se' || corner === 'sw') {
      return { kind: 'rotate', corner, key: k };
    }
  }
  if (k.startsWith('radius-')) return { kind: 'radius', key: k };
  if (k.startsWith('star-') || k.startsWith('poly-') || k.startsWith('circle-')) {
    return { kind: 'shape', key: k };
  }
  const penAnchor = /^pen-anchor-(\d+)-(\d+)$/.exec(k);
  if (penAnchor) {
    return {
      kind: 'pen-anchor',
      key: k,
      sub: Number(penAnchor[1]),
      index: Number(penAnchor[2]),
    };
  }
  const penHandle = /^pen-handle-(\d+)-(\d+)-(in|out)$/.exec(k);
  if (penHandle) {
    return {
      kind: 'pen-handle',
      key: k,
      sub: Number(penHandle[1]),
      index: Number(penHandle[2]),
      side: penHandle[3] as 'in' | 'out',
    };
  }
  return null;
}

function hitZonePriority(pick: PaintedHitZonePick): number {
  if (pick.kind === 'resize') return 0;
  if (pick.kind === 'rotate') return 1;
  if (pick.kind === 'radius' || pick.kind === 'shape') return 2;
  if (pick.kind === 'pen-handle') return 3;
  return 4;
}

/** Overlay / pen-edit knobs ??scene AABB registry (no HTML pads). */
export type ChromeKnobKind = 'radius' | 'shape' | 'pen-anchor' | 'pen-handle';
export type ChromeKnobHit = {
  ownerId: string;
  kind: ChromeKnobKind;
  key: string;
  x: number;
  y: number;
  /** Scene half-extent of the square hit AABB. */
  half: number;
};

/**
 * Knob registry must survive Vite HMR / duplicate module instances.
 * SelectionFeature and CornerRadiusHandlesOverlay otherwise write/read different
 * Maps ??painted R-dots with empty picks ??down falls through to move.
 */
type KnobHitStore = Map<string, ChromeKnobHit[]>;
function chromeKnobHitStore(): KnobHitStore {
  if (typeof window === 'undefined') {
    return new Map<string, ChromeKnobHit[]>();
  }
  const w = window as unknown as { __RCB_KNOB_HIT_STORE__?: KnobHitStore };
  if (!w.__RCB_KNOB_HIT_STORE__) w.__RCB_KNOB_HIT_STORE__ = new Map();
  return w.__RCB_KNOB_HIT_STORE__;
}

export function setChromeKnobHits(ownerId: string, hits: ChromeKnobHit[]): void {
  const id = String(ownerId || '');
  if (!id) return;
  const store = chromeKnobHitStore();
  if (!hits.length) {
    store.delete(id);
    return;
  }
  store.set(id, hits.slice());
}

export function clearChromeKnobHits(ownerId: string): void {
  const id = String(ownerId || '');
  if (!id) return;
  chromeKnobHitStore().delete(id);
}

/** Dev-only: dump registered overlay knobs for browser hit probes. */
export function debugChromeKnobHits(): ChromeKnobHit[] {
  const out: ChromeKnobHit[] = [];
  for (const hits of chromeKnobHitStore().values()) out.push(...hits);
  return out;
}

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as unknown as { __RCB_DEBUG_KNOBS__?: () => ChromeKnobHit[] }).__RCB_DEBUG_KNOBS__ =
    debugChromeKnobHits;
}

/**
 * Pick radius / shape / pen knobs by scene square AABB.
 * Lower {@link hitZonePriority} wins; radius/shape beat pen.
 */
export function pickChromeKnobHit(
  sceneX: number,
  sceneY: number
): PaintedHitZonePick | null {
  if (![sceneX, sceneY].every(Number.isFinite)) return null;
  let best: { pick: PaintedHitZonePick; d2: number; priority: number } | null = null;
  for (const hits of chromeKnobHitStore().values()) {
    for (const hit of hits) {
      const half = Math.max(0, Number(hit.half) || 0);
      if (!(half > 0)) continue;
      if (Math.abs(sceneX - hit.x) > half || Math.abs(sceneY - hit.y) > half) {
        continue;
      }
      const pick = parseHitZoneKey(hit.key);
      if (!pick) continue;
      const d2 = (sceneX - hit.x) ** 2 + (sceneY - hit.y) ** 2;
      const priority = hitZonePriority(pick);
      if (
        !best ||
        priority < best.priority ||
        (priority === best.priority && d2 < best.d2)
      ) {
        best = { pick, d2, priority };
      }
    }
  }
  return best?.pick ?? null;
}

/**
 * Drop leftover hit-pad layers that are not under the live screen overlay.
 */
export function disposeLegacyHitPadLayer(): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll(`[${RCB_HIT_LAYER_ATTR}]`).forEach((n) => {
    if (n.closest('[data-rcb-overlay="1"]')) return;
    try {
      n.remove();
    } catch {
      /* ignore */
    }
  });
}

export function hitZoneFromEventTarget(
  target: EventTarget | null
): PaintedHitZonePick | null {
  const el = (target as Element | null)?.closest?.(`[${RCB_HIT_ZONE_ATTR}]`);
  if (!el) return null;
  return parseHitZoneKey(el.getAttribute(RCB_HIT_ZONE_ATTR) || '');
}

/** SVG yellow disc -> client via getScreenCTM. */
function hitZoneCircleClient(
  el: Element
): { cx: number; cy: number; r: number } | null {
  const x = Number(el.getAttribute('cx'));
  const y = Number(el.getAttribute('cy'));
  const r = Number(el.getAttribute('r'));
  if (![x, y, r].every(Number.isFinite) || !(r > 0)) return null;
  if (typeof (el as SVGGraphicsElement).getScreenCTM !== 'function') return null;
  const ctm = (el as SVGGraphicsElement).getScreenCTM();
  if (!ctm) return null;
  const cx = ctm.a * x + ctm.c * y + ctm.e;
  const cy = ctm.b * x + ctm.d * y + ctm.f;
  const rimX = ctm.a * (x + r) + ctm.c * y + ctm.e;
  const rimY = ctm.b * (x + r) + ctm.d * y + ctm.f;
  const screenR = Math.hypot(rimX - cx, rimY - cy);
  if (!(screenR > 0)) return null;
  return { cx, cy, r: screenR };
}

/** Per-control HTML div ??client disc via getBoundingClientRect. */
function hitZoneHtmlClient(el: Element): { cx: number; cy: number; r: number } | null {
  if (!(el instanceof HTMLElement)) return null;
  const rect = el.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  return {
    cx: rect.left + rect.width / 2,
    cy: rect.top + rect.height / 2,
    r: Math.max(rect.width, rect.height) / 2,
  };
}

/**
 * Pick by painted hit zones ??each control's HTML div (GBR), else SVG.
 */
export function pickPaintedHitZone(
  clientX: number,
  clientY: number
): PaintedHitZonePick | null {
  if (typeof document === 'undefined') return null;
  const nodes = document.querySelectorAll(`[${RCB_HIT_ZONE_ATTR}]`);
  let best: { pick: PaintedHitZonePick; d2: number; priority: number } | null = null;
  for (let i = 0; i < nodes.length; i += 1) {
    const el = nodes[i];
    const key = el.getAttribute(RCB_HIT_ZONE_ATTR) || '';
    const parsed = parseHitZoneKey(key);
    if (!parsed) continue;
    const disc =
      el instanceof HTMLElement ? hitZoneHtmlClient(el) : hitZoneCircleClient(el);
    if (!disc) continue;
    const d2 = (clientX - disc.cx) ** 2 + (clientY - disc.cy) ** 2;
    if (d2 > disc.r * disc.r) continue;
    const priority = hitZonePriority(parsed);
    if (
      !best ||
      priority < best.priority ||
      (priority === best.priority && d2 < best.d2)
    ) {
      best = { pick: parsed, d2, priority };
    }
  }
  return best?.pick ?? null;
}

function rotateLocal(
  lx: number,
  ly: number,
  w: number,
  h: number,
  angleDeg: number,
  anchorX = 50,
  anchorY = 50
) {
  if (Math.abs(angleDeg) < 0.001) return { x: lx, y: ly };
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = (w * Math.max(0, Math.min(100, anchorX))) / 100;
  const cy = (h * Math.max(0, Math.min(100, anchorY))) / 100;
  const dx = lx - cx;
  const dy = ly - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

function localToScene(
  lx: number,
  ly: number,
  box: SceneBox,
  angleDeg: number
): { x: number; y: number } {
  const p = rotateLocal(lx, ly, box.width, box.height, angleDeg);
  return { x: box.left + p.x, y: box.top + p.y };
}

function sceneToLocal(
  sceneX: number,
  sceneY: number,
  box: SceneBox,
  angleDeg: number,
  anchorX = 50,
  anchorY = 50
): { x: number; y: number } {
  const dx = sceneX - box.left;
  const dy = sceneY - box.top;
  if (Math.abs(angleDeg) < 0.001) return { x: dx, y: dy };
  const rad = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const w = box.width;
  const h = box.height;
  const cx = (w * Math.max(0, Math.min(100, anchorX))) / 100;
  const cy = (h * Math.max(0, Math.min(100, anchorY))) / 100;
  const rx = dx - cx;
  const ry = dy - cy;
  return { x: cx + rx * cos - ry * sin, y: cy + rx * sin + ry * cos };
}

type Knob = [ResizeHandle, number, number];

function isCornerHandle(dir: ResizeHandle) {
  return dir === 'nw' || dir === 'ne' || dir === 'se' || dir === 'sw';
}

function isEdgeHandle(dir: ResizeHandle) {
  return dir === 'n' || dir === 's' || dir === 'e' || dir === 'w';
}

function buildAllKnobs(w: number, h: number): Knob[] {
  return [
    ['nw', 0, 0],
    ['n', w / 2, 0],
    ['ne', w, 0],
    ['e', w, h / 2],
    ['se', w, h],
    ['s', w / 2, h],
    ['sw', 0, h],
    ['w', 0, h / 2],
  ];
}

function selectResizeKnobs(opts: {
  lineMode: boolean;
  cornerHandlesOnly: boolean;
  edgeHandles: 'all' | 'horizontal' | 'none' | 'se-only';
  w: number;
  h: number;
}): Knob[] {
  const { lineMode, cornerHandlesOnly, edgeHandles, w, h } = opts;
  if (lineMode) return [['w', 0, h / 2], ['e', w, h / 2]];
  const all = buildAllKnobs(w, h);
  let picked: Knob[];
  if (cornerHandlesOnly) picked = all.filter(([dir]) => isCornerHandle(dir));
  else if (edgeHandles === 'se-only') picked = all.filter(([dir]) => dir === 'se');
  else if (edgeHandles === 'horizontal') {
    picked = all.filter(([dir]) => isCornerHandle(dir) || dir === 'e' || dir === 'w');
  } else {
    picked = all;
  }
  // Edges first, corners last ??corner hits must win when AABBs overlap on tiny boxes.
  return [
    ...picked.filter(([dir]) => isEdgeHandle(dir)),
    ...picked.filter(([dir]) => isCornerHandle(dir)),
  ];
}

function selectVisualKnobs(
  knobs: Knob[],
  opts: { lineMode: boolean; cornerHandlesOnly: boolean; edgeHandles: 'all' | 'horizontal' | 'none' | 'se-only' }
): Knob[] {
  if (opts.lineMode) return [];
  const showEdges = !opts.cornerHandlesOnly && opts.edgeHandles === 'all';
  return knobs.filter(([dir]) => (isEdgeHandle(dir) ? showEdges : true));
}

const ROTATE_CORNERS: Array<{
  corner: 'nw' | 'ne' | 'se' | 'sw';
  localX: number;
  localY: number;
  iconDeg: number;
  label: string;
}> = [
  { corner: 'nw', localX: 0, localY: 0, iconDeg: 0, label: 'Rotate' },
  { corner: 'ne', localX: 1, localY: 0, iconDeg: 90, label: 'Rotate' },
  { corner: 'se', localX: 1, localY: 1, iconDeg: 180, label: 'Rotate' },
  { corner: 'sw', localX: 0, localY: 1, iconDeg: 270, label: 'Rotate' },
];

/** World AABB chrome must paint above HostPathChrome silhouettes (boolean / path ink). */
function keepSelectionChromeOnTop(mount: SVGGElement | null) {
  if (!mount) return;
  const chrome = mount.querySelector(':scope > g[data-rcb-sel-chrome="1"]');
  if (chrome && mount.lastElementChild !== chrome) {
    mount.appendChild(chrome);
  }
}

function SelectionChrome({
  box,
  angle = 0,
  showHandles = true,
  cornerHandlesOnly = false,
  variant = 'box',
  showRotate = true,
  metaLabel,
  interactiveBox = true,
  boxDataAttr = 'data-sel-box',
  handleDataAttr = 'data-sel-handle',
  handleDataValue = 'resize',
  edgeHandles = 'all',
  showBoxStroke = true,
  strokeOuterScene = 0,
  strokeColor,
  anchorX = 50,
  anchorY = 50,
  skewX = 0,
  skewAxis = 0,
}: SelectionChromeProps) {
  const camera = useRcbCamera();
  const z = Math.max(0.05, rcbCameraCssZoom(camera));
  const inv = 1 / z;
  const chromeColor = strokeColor || SEL_BASELINE;
  const [mountEpoch, setMountEpoch] = useState(0);
  const mount = getSceneSelectionChromeMount();

  useLayoutEffect(() => {
    if (mount) return undefined;
    const raf = requestAnimationFrame(() => setMountEpoch((n) => n + 1));
    return () => cancelAnimationFrame(raf);
  }, [mount, mountEpoch]);

  // Paint in scene units under the same camera group as element ink.
  const left = box.left;
  const top = box.top;
  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  const lineMode = variant === 'line';

  const stroke = CHROME_STROKE_PX * inv;
  const handleVis = CHROME_HANDLE_VIS_PX * inv;
  const lineEpVis = CHROME_LINE_ENDPOINT_VIS_PX * inv;
  const lineShaftHit = CHROME_LINE_SHAFT_HIT_PX * inv;
  const metaOffset = 16 * inv;
  const metaFont = 10 * inv;
  const halfVis = handleVis / 2;
  const hitScale = chromeHitScaleForBox(w, h, z);
  const hs = Math.max(0.35, hitScale);
  const lArm = CHROME_CORNER_L_ARM_PX * inv * hs;
  const lThick = CHROME_CORNER_L_THICK_PX * inv * hs;
  const strokeOuter = Math.min(
    CHROME_STROKE_L_CLEAR_MAX_SCREEN_PX * inv,
    Math.max(0, strokeOuterScene)
  );
  const lClear = halfVis + CHROME_CORNER_L_CLEAR_PX * inv * hs + strokeOuter;
  const handleAttrProps = { [handleDataAttr]: handleDataValue };

  const svgBoxTransform = sceneChromeBodyTransform(
    box,
    angle,
    false,
    false,
    anchorX,
    anchorY,
    skewX,
    skewAxis
  );

  const knobs = selectResizeKnobs({
    lineMode,
    cornerHandlesOnly,
    edgeHandles,
    w,
    h,
  });
  const visualKnobs = selectVisualKnobs(knobs, {
    lineMode,
    cornerHandlesOnly,
    edgeHandles,
  });

  useLayoutEffect(() => {
    keepSelectionChromeOnTop(mount);
  }, [
    mount,
    left,
    top,
    w,
    h,
    angle,
    showHandles,
    showBoxStroke,
    showRotate,
    lineMode,
    cornerHandlesOnly,
    edgeHandles,
  ]);

  const toScenePoint = (lx: number, ly: number) => {
    const p = rotateLocal(lx, ly, w, h, angle, anchorX, anchorY);
    return { x: left + p.x, y: top + p.y };
  };

  const lineStart = toScenePoint(0, h / 2);
  const lineEnd = toScenePoint(w, h / 2);
  const lineLen = Math.hypot(lineEnd.x - lineStart.x, lineEnd.y - lineStart.y) || 1;
  const lineAngleDeg =
    (Math.atan2(lineEnd.y - lineStart.y, lineEnd.x - lineStart.x) * 180) / Math.PI;

  if (!mount) return null;

  return createPortal(
      <g data-rcb-sel-chrome="1" style={{ pointerEvents: 'none' }} aria-hidden>
        {metaLabel ? (
          <text
            x={left + w / 2}
            y={top - metaOffset}
            fill={chromeColor}
            fontSize={metaFont}
            fontWeight={500}
            textAnchor="middle"
            dominantBaseline="auto"
            style={{ pointerEvents: 'none' }}
          >
            {metaLabel}
          </text>
        ) : null}

        {lineMode ? (
          <g transform={`translate(${lineStart.x} ${lineStart.y}) rotate(${lineAngleDeg})`}>
            {interactiveBox ? (
              <rect
                {...{ [boxDataAttr]: true }}
                x={0}
                y={-lineShaftHit / 2}
                width={lineLen}
                height={lineShaftHit}
                fill="transparent"
                style={{ pointerEvents: 'none' }}
              />
            ) : null}
          </g>
        ) : (
          <g transform={svgBoxTransform}>
            {interactiveBox ? (
              <rect
                {...{ [boxDataAttr]: true }}
                x={0}
                y={0}
                width={w}
                height={h}
                fill="transparent"
                style={{ pointerEvents: 'none' }}
              />
            ) : null}
            {showBoxStroke ? (
              <rect
                x={0}
                y={0}
                width={w}
                height={h}
                fill="none"
                stroke={chromeColor}
                strokeWidth={stroke}
                style={{ pointerEvents: 'none' }}
              />
            ) : null}
            {showHandles && showRotate
              ? (['nw', 'ne', 'se', 'sw'] as const).map((dir) => {
                  const d = cornerLLocalPath(dir, w, h, lArm, lThick, lClear);
                  if (!d) return null;
                  return (
                    <path
                      key={`rot-l-${dir}`}
                      data-rcb-sel-rotate-l={dir}
                      d={d}
                      // Rotation is geometry-hit-tested; keep the outer L invisible.
                      fill="none"
                      stroke="none"
                      style={{ pointerEvents: 'none' }}
                    />
                  );
                })
              : null}
            {showHandles
              ? visualKnobs.map(([dir, lx, ly]) => (
                  <g key={`knob-${dir}`} transform={`translate(${lx} ${ly})`}>
                    <rect
                      data-rcb-sel-knob={dir}
                      {...handleAttrProps}
                      x={-halfVis}
                      y={-halfVis}
                      width={handleVis}
                      height={handleVis}
                      fill="#ffffff"
                      stroke={chromeColor}
                      strokeWidth={stroke}
                      style={{ pointerEvents: 'none' }}
                    />
                  </g>
                ))
              : null}
          </g>
        )}

        {showHandles && lineMode
          ? knobs.map(([dir, lx, ly]) => {
              const p = toScenePoint(lx, ly);
              return (
                <g
                  key={`ep-${dir}`}
                  transform={`translate(${p.x} ${p.y})`}
                  style={{ pointerEvents: 'none' }}
                >
                  <circle
                    data-rcb-sel-knob={dir}
                    {...handleAttrProps}
                    r={Math.max(0.01, lineEpVis / 2 - stroke / 2)}
                    fill="#fff"
                    stroke={chromeColor}
                    strokeWidth={stroke}
                    style={{ pointerEvents: 'none' }}
                  />
                </g>
              );
            })
          : null}
      </g>,
      mount
  );
}



export default memo(SelectionChrome);
