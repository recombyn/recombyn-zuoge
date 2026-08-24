import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  memo,
} from 'react';
import { cn } from '@/utils/classnames';
import {
  RcbCameraContext,
  RcbCameraMotionContext,
  RcbDevicePixelRatioContext,
  RcbOverlayRootContext,
  RcbViewportElContext,
} from '../camera/context';
import { readDevicePixelRatio, subscribeDevicePixelRatio } from '../core/dpr';
import {
  rcbCameraCssZoom,
  rcbCameraScreenOffset,
  rcbClientToStageLocal,
  rcbFitCamera,
  rcbStepZoom,
  rcbZoomAtPoint,
} from '../core/math';
import { SceneSpatialRuntime, getSharedSceneSpatialRuntime } from '../core/spatialIndex';
import { RCB_DEFAULT_CAMERA, type RcbCamera } from '../core/types';
import { cameraSvgTransform, createCameraTransform } from '../camera/transform';
import {
  createCanvasSceneRenderer,
  getSceneCanvasIdlePaint,
  listSceneCanvasIdlePaintIds,
  subscribeSceneCanvasIdlePaint,
  type SceneRenderer,
} from '../render/sceneRenderer';
import { subscribeTransformPreview } from '../core/transformPreview';
import type { SceneDocument } from '../sceneNode';
import { setInfiniteSvgPaintCamera } from '../scene/paint/sceneToSvg';
import { notifyShapeHostGeometry, setSceneWorldRoot } from '../shapes/shapeHostRegistry';
import { DEFAULT_GRID_SIZE, shouldShowPixelGrid } from '../selection/alignGuides';
import { wheelShouldStayLocal } from './wheelScrollOwners';

const EMPTY_SCENE_DOC: SceneDocument = {
  deltaSetLike: {
    ROOT: {
      id: 'ROOT',
      key: 'group',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      attrs: {},
      children: [],
    },
  },
};

export type { RcbCamera };
export { RCB_DEFAULT_CAMERA };

/**
 * Scene-space pixel-grid path (integer multiples of `g`).
 * Kept for tests / export helpers — live editor paints the grid on the
 * Canvas2D underlay (`createCanvasSceneRenderer`), not as SVG path ink.
 */
export function buildPixelGridPathD(
  left: number,
  top: number,
  width: number,
  height: number,
  gridSize: number
): string {
  const g = gridSize > 0 ? gridSize : 1;
  const right = left + Math.max(0, width);
  const bottom = top + Math.max(0, height);
  const x0 = Math.floor(left / g) * g;
  const y0 = Math.floor(top / g) * g;
  const parts: string[] = [];
  for (let x = x0; x <= right + 1e-9; x += g) {
    parts.push(`M ${x} ${y0} V ${bottom}`);
  }
  for (let y = y0; y <= bottom + 1e-9; y += g) {
    parts.push(`M ${x0} ${y} H ${right}`);
  }
  return parts.join(' ');
}

/** Zoom about a stage-local point — convenience for host zoom controls. */
export function zoomAtPoint(
  camera: RcbCamera,
  nextZoom: number,
  localX: number,
  localY: number,
  dpr?: number
): RcbCamera {
  return rcbZoomAtPoint(camera, nextZoom, localX, localY, dpr);
}

export type RcbCanvasProps = {
  /**
   * Scene bounds used for one-shot autofit when `fitKey` changes.
   * Pass `{ width: 0, height: 0 }` to skip fit (empty document).
   */
  artboard: { x?: number; y?: number; width: number; height: number };
  camera: RcbCamera;
  onCameraChange: (next: RcbCamera) => void;
  /** Hand / space-pan mode. */
  panMode?: boolean;
  /** Select tool: left-drag on empty canvas starts pan after a short threshold. */
  emptyDragPans?: boolean;
  shouldBlockEmptyPan?: (e: PointerEvent) => boolean;
  /**
   * CSS selectors that block empty-canvas pan (selection chrome, etc.).
   * Host app supplies product-specific targets.
   */
  panBlockSelector?: string;
  className?: string;
  /** World-layer scene content (scaled with camera). */
  children: ReactNode;
  /** Optional SVG defs / ambient nodes inside the viewport (not scaled). */
  defs?: ReactNode;
  /**
   * Pixel-grid pitch in scene units (default 1). Auto-shows around ≥800% zoom.
   * Painted on the stage Canvas2D underlay (camera baked into ctx — not under
   * world CSS `scale`).
   */
  gridSize?: number;
  stageRef?: RefObject<HTMLDivElement | null>;
  /**
   * Fires whenever the live viewport node mounts/unmounts.
   * Hosts must use this (not a one-shot effect) so stageEl stays connected
   * after resize / mobile breakpoint remounts.
   */
  onViewportEl?: (el: HTMLElement | null) => void;
  cursor?: string;
  background?: string;
  /** Stable id for one-time autofit (e.g. document id). */
  fitKey?: string;
};

/**
 * RCB infinite canvas shell.
 *
 * Layers:
 *   1. Viewport — wheel / pan, overflow hidden
 *   2. Grid Canvas underlay — pixel/scene grid (under SVG plates)
 *   3. Shared SVG camera group — hosts, plates, previews, guides, chrome
 *   4. Idle Canvas overlay — Canvas2D demoted ink above plates (frame-clipped)
 *   5. Overlay — unscaled HTML UI
 *
 * Pixel grid uses CameraTransform on the underlay (same pan/zoom as ink), not
 * an SVG path under world `scale`.
 *
 * Camera never mutates scene coordinate origin. Shapes SVG grows with content
 * bounds (no fixed ±N plane) — unbounded page space.
 */
function RcbCanvas({
  artboard,
  camera,
  onCameraChange,
  panMode = false,
  emptyDragPans = false,
  shouldBlockEmptyPan,
  panBlockSelector = '',
  className,
  children,
  defs = null,
  gridSize = DEFAULT_GRID_SIZE,
  stageRef: stageRefProp,
  onViewportEl,
  cursor,
  background,
  fitKey,
}: RcbCanvasProps) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const stageRef = stageRefProp || localRef;
  const onViewportElRef = useRef(onViewportEl);
  onViewportElRef.current = onViewportEl;
  const cameraRef = useRef(camera);
  const panRef = useRef<{ x: number; y: number; scaleX: number; scaleY: number } | null>(null);
  const pendingPanRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const spaceDown = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cameraMoving, setCameraMoving] = useState(false);
  const emptyDragPansRef = useRef(emptyDragPans);
  const shouldBlockEmptyPanRef = useRef(shouldBlockEmptyPan);
  const panBlockSelectorRef = useRef(panBlockSelector);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const fittedKey = useRef('');
  const [overlayEl, setOverlayEl] = useState<HTMLDivElement | null>(null);
  const [viewportEl, setViewportEl] = useState<HTMLElement | null>(null);
  const [devicePixelRatio, setDevicePixelRatio] = useState(() => readDevicePixelRatio());
  const devicePixelRatioRef = useRef(devicePixelRatio);
  const paintCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintRendererRef = useRef<SceneRenderer | null>(null);
  const inkRendererRef = useRef<SceneRenderer | null>(null);
  const gridSizeRef = useRef(gridSize);
  const [canvasIdlePaintEpoch, setCanvasIdlePaintEpoch] = useState(0);

  cameraRef.current = camera;
  gridSizeRef.current = gridSize;
  devicePixelRatioRef.current = devicePixelRatio;

  const markCameraMoving = useCallback(() => {
    setCameraMoving(true);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      setCameraMoving(false);
    }, 140);
  }, []);

  useEffect(() => {
    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
  }, []);

  const cameraMotion = useMemo(
    () => ({
      moving: cameraMoving,
      efficientZoom: cameraMoving ? rcbStepZoom(camera.zoom) : camera.zoom,
    }),
    [cameraMoving, camera.zoom]
  );

  // Browser zoom / HiDPI — keep DPR in sync (camera pan snaps to this).
  useEffect(() => subscribeDevicePixelRatio(setDevicePixelRatio), []);

  emptyDragPansRef.current = emptyDragPans;
  shouldBlockEmptyPanRef.current = shouldBlockEmptyPan;
  panBlockSelectorRef.current = panBlockSelector;
  const emptyWorld = !(artboard.width > 0 && artboard.height > 0);

  // Must be stable: a new ref callback every render makes React detach (null) +
  // reattach (node), which re-enters setState and hits max update depth (e.g. tour
  // opening Agent and re-layouting the stage).
  const setStageNode = useCallback((node: HTMLDivElement | null) => {
    if (stageRefProp) {
      (stageRefProp as { current: HTMLDivElement | null }).current = node;
    } else {
      localRef.current = node;
    }
    setViewportEl((prev) => (prev === node ? prev : node));
    onViewportElRef.current?.(node);
  }, [stageRefProp]);

  useEffect(() => {
    const key = fitKey || 'default';
    if (emptyWorld) {
      // Remember we opened empty so the first real artboard can still autofit.
      if (fittedKey.current !== key) fittedKey.current = `${key}:empty`;
      return;
    }
    // Already fitted for this key — skip. Do NOT treat `:empty` as fitted:
    // empty → first frame must run rcbFitCamera so content centers in the viewport.
    if (fittedKey.current === key) return;
    const el = stageRef.current || viewportEl;
    if (!el) return;
    let cancelled = false;
    let tries = 0;
    const applyFit = () => {
      if (cancelled) return;
      const stage = stageRef.current || viewportEl;
      if (!stage) return;
      const vw = stage.clientWidth;
      const vh = stage.clientHeight;
      if (vw < 40 || vh < 40) {
        // Stage not laid out yet — retry a few frames.
        if (tries++ < 30) requestAnimationFrame(applyFit);
        return;
      }
      fittedKey.current = key;
      // clientWidth/Height match camera.x/y layout space (not visual getBoundingClientRect).
      onCameraChange(rcbFitCamera({ width: vw, height: vh }, artboard));
    };
    applyFit();
    return () => {
      cancelled = true;
    };
  }, [fitKey, emptyWorld, artboard.x, artboard.y, artboard.width, artboard.height, onCameraChange, stageRef, viewportEl, artboard]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const t = e.target as HTMLElement | null;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t?.isContentEditable
      ) {
        return;
      }
      if (e.repeat) return;
      spaceDown.current = true;
      setSpaceHeld(true);
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      spaceDown.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
    };
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;

    const isPanTool = () => panMode || spaceDown.current;

    const beginPan = (e: PointerEvent) => {
      pendingPanRef.current = null;
      e.preventDefault();
      e.stopPropagation();
      const local = rcbClientToStageLocal(el, e.clientX, e.clientY);
      panRef.current = { x: local.x, y: local.y, scaleX: local.scaleX, scaleY: local.scaleY };
      el.setPointerCapture?.(e.pointerId);
    };

    const onWheel = (e: WheelEvent) => {
      const target = e.target as Element | null;
      // Scrollable panels/menus own wheel — do not pan/zoom or preventDefault.
      // Do not blanket-block `[data-rcb-overlay]`; mockup, variants, selection chrome must zoom.
      if (wheelShouldStayLocal(target, e)) return;
      e.preventDefault();
      const local = rcbClientToStageLocal(el, e.clientX, e.clientY);
      const cam = cameraRef.current;
      markCameraMoving();

      let deltaX = e.deltaX;
      let deltaY = e.deltaY;
      // Normalize line/page deltas so trackpads don't pan/zoom by huge jumps.
      if (e.deltaMode === 1) {
        deltaX *= 16;
        deltaY *= 16;
      } else if (e.deltaMode === 2) {
        deltaX *= el.clientWidth;
        deltaY *= el.clientHeight;
      }

      if (e.ctrlKey || e.metaKey) {
        onCameraChange(
          rcbZoomAtPoint(
            cam,
            cam.zoom * (deltaY > 0 ? 0.92 : 1.08),
            local.x,
            local.y,
            devicePixelRatioRef.current
          )
        );
        return;
      }
      const sx = local.scaleX > 0 ? local.scaleX : 1;
      const sy = local.scaleY > 0 ? local.scaleY : 1;
      onCameraChange({
        ...cam,
        x: cam.x - deltaX / sx,
        y: cam.y - deltaY / sy,
      });
    };

    const onDown = (e: PointerEvent) => {
      if (e.button === 1 || isPanTool()) {
        beginPan(e);
        return;
      }
      if (e.button !== 0 || !emptyDragPansRef.current) return;
      const target = e.target as Element | null;
      const block = panBlockSelectorRef.current;
      if (block && target?.closest?.(block)) return;
      if (shouldBlockEmptyPanRef.current?.(e)) return;
      pendingPanRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    };
    const onMove = (e: PointerEvent) => {
      if (panRef.current) {
        const local = rcbClientToStageLocal(el, e.clientX, e.clientY);
        const dx = local.x - panRef.current.x;
        const dy = local.y - panRef.current.y;
        panRef.current = {
          x: local.x,
          y: local.y,
          scaleX: local.scaleX,
          scaleY: local.scaleY,
        };
        const cam = cameraRef.current;
        markCameraMoving();
        onCameraChange({ ...cam, x: cam.x + dx, y: cam.y + dy });
        return;
      }
      const pending = pendingPanRef.current;
      if (!pending || pending.pointerId !== e.pointerId) return;
      if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < 4) return;
      beginPan(e);
    };
    const onUp = (e: PointerEvent) => {
      pendingPanRef.current = null;
      if (!panRef.current) return;
      panRef.current = null;
      try {
        el.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown, { capture: true } as EventListenerOptions);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [panMode, onCameraChange, stageRef, markCameraMoving]);

  const panning = panMode || spaceHeld;

  // Re-assert after child tool effects (pen cleanup used to wipe style.cursor).
  useEffect(() => {
    const el = stageRef.current;
    if (!el || panning) return;
    el.style.cursor = cursor || '';
  }, [cursor, panning, stageRef]);

  // Snap pan to the device-pixel grid. Shape hosts share one camera world
  // viewport; the pixel lattice paints on the stage Canvas underlay.
  const { x: camX, y: camY } = rcbCameraScreenOffset(camera, devicePixelRatio);
  const camZ = rcbCameraCssZoom(camera);
  const stageW = viewportEl?.clientWidth || 0;
  const stageH = viewportEl?.clientHeight || 0;
  setInfiniteSvgPaintCamera(camera, devicePixelRatio, { width: stageW, height: stageH });
  const g = gridSize > 0 ? gridSize : DEFAULT_GRID_SIZE;
  const showPixelGrid = shouldShowPixelGrid(camZ);
  const sceneLeft = -camX / camZ;
  const sceneTop = -camY / camZ;

  // Keep every host on the shared world viewport; bump chrome to re-mirror.
  // useLayoutEffect: same frame as world CSS camera — useEffect left one paint of desync.
  useLayoutEffect(() => {
    setInfiniteSvgPaintCamera(camera, devicePixelRatio, {
      width: viewportEl?.clientWidth || 0,
      height: viewportEl?.clientHeight || 0,
    });
    notifyShapeHostGeometry();
  }, [camera, devicePixelRatio, viewportEl?.clientWidth, viewportEl?.clientHeight]);

  // One scene SVG for shape layers (grid lives on the Canvas underlay).
  const setSceneRootNode = useCallback((node: SVGSVGElement | null) => {
    const cameraRoot = node
      ? (node.querySelector(':scope > g[data-rcb-scene-camera]') as SVGGElement | null)
      : null;
    const mount = cameraRoot
      ? (cameraRoot.querySelector(':scope > g[data-rcb-shapes-mount]') as SVGGElement | null)
      : null;
    const processMount = cameraRoot
      ? (cameraRoot.querySelector(':scope > g[data-rcb-process-mount]') as SVGGElement | null)
      : null;
    const previewMount = cameraRoot
      ? (cameraRoot.querySelector(':scope > g[data-rcb-draw-preview-mount]') as SVGGElement | null)
      : null;
    const guidesMount = cameraRoot
      ? (cameraRoot.querySelector(':scope > g[data-rcb-smart-guides-mount]') as SVGGElement | null)
      : null;
    const selectionChromeMount = cameraRoot
      ? (cameraRoot.querySelector(':scope > g[data-rcb-selection-chrome-mount]') as SVGGElement | null)
      : null;
    setSceneWorldRoot(
      node,
      mount,
      previewMount,
      guidesMount,
      selectionChromeMount,
      processMount
    );
  }, []);
  useEffect(() => {
    return () => setSceneWorldRoot(null, null, null, null, null, null);
  }, []);

  // Stage Canvas2D: grid under SVG; idle ink above SVG plates (ADR 0027).
  // Prefer the product SceneSpatialRuntime when SvgCanvas has published it.
  useEffect(() => {
    const gridCanvas = paintCanvasRef.current;
    const inkCanvas = inkCanvasRef.current;
    if (!gridCanvas || !inkCanvas) return;
    const fallbackSpatial = new SceneSpatialRuntime(64);
    const sharedDeps = {
      getDocument: () => getSceneCanvasIdlePaint()?.document ?? EMPTY_SCENE_DOC,
      getSpatial: () => getSharedSceneSpatialRuntime() ?? fallbackSpatial,
      getZoom: () => rcbCameraCssZoom(cameraRef.current),
      listNodeIds: () => listSceneCanvasIdlePaintIds(),
      getNodeBox: (id: string) => getSceneCanvasIdlePaint()?.getNodeBox(id) ?? null,
      drawNodeProxies: false,
      drawBasicShapes: false,
      getGridSize: () => {
        const n = gridSizeRef.current;
        return n > 0 ? n : DEFAULT_GRID_SIZE;
      },
      shouldShowGrid: shouldShowPixelGrid,
    };
    const gridRenderer = createCanvasSceneRenderer({
      ...sharedDeps,
      canvas: gridCanvas,
      paintGrid: true,
      drawCanvasIdle: false,
    });
    const inkRenderer = createCanvasSceneRenderer({
      ...sharedDeps,
      canvas: inkCanvas,
      paintGrid: false,
      drawCanvasIdle: true,
    });
    paintRendererRef.current = gridRenderer;
    inkRendererRef.current = inkRenderer;
    return () => {
      gridRenderer.dispose();
      inkRenderer.dispose();
      paintRendererRef.current = null;
      inkRendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    return subscribeSceneCanvasIdlePaint(() => {
      setCanvasIdlePaintEpoch((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    return subscribeTransformPreview(() => {
      setCanvasIdlePaintEpoch((n) => n + 1);
    });
  }, []);

  useLayoutEffect(() => {
    if (stageW <= 0 || stageH <= 0) return;
    const idleDoc = getSceneCanvasIdlePaint()?.document ?? EMPTY_SCENE_DOC;
    const req = {
      document: idleDoc,
      camera,
      dirty: { kind: 'full' as const },
      stage: { width: stageW, height: stageH },
      dpr: devicePixelRatio,
    };
    paintRendererRef.current?.render(req);
    inkRendererRef.current?.render(req);
  }, [camera, devicePixelRatio, stageW, stageH, g, showPixelGrid, canvasIdlePaintEpoch]);

  const sceneCameraTransform = cameraSvgTransform(
    createCameraTransform(camera, devicePixelRatio)
  );

  return (
    <RcbCameraContext.Provider value={camera}>
      <RcbCameraMotionContext.Provider value={cameraMotion}>
      <RcbDevicePixelRatioContext.Provider value={devicePixelRatio}>
        <RcbViewportElContext.Provider value={viewportEl}>
          <RcbOverlayRootContext.Provider value={overlayEl}>
            <div
              ref={setStageNode}
              data-rcb-canvas="1"
              data-canvas-stage="1"
              data-rcb-dpr={String(devicePixelRatio)}
              className={cn(
                // Own pan/zoom/draw — block browser scroll/pinch so it cannot
                // fire pointercancel mid-gesture (common on tablet / DevTools device).
                'relative h-full w-full touch-none overflow-hidden select-none',
                !background && 'bg-[var(--canvas)]',
                panning && 'cursor-grab active:cursor-grabbing',
                // Tool cursors (eraser / pencil / …) inherit onto shapes — but
                // selection resize/rotate hits must keep their own cursors.
                !panning && cursor && '[&_*:not([data-sel-handle]):not([data-radius-handle]):not([data-star-handle]):not([data-poly-handle]):not([data-circle-handle])]:!cursor-inherit',
                !panning && !cursor && 'cursor-default',
                className
              )}
              style={{
                ...(background ? { background } : null),
                // Always set so leaving a tool clears any previous inline cursor.
                cursor: !panning && cursor ? cursor : '',
              }}
            >
              <style>{`
                /* HTML <video> paints; SVG poster is hit/export underlay only.
                   Hide on the live canvas so move cannot show a second layer.
                   Export builds its own SVG (no this rule). */
                [data-rcb-canvas] [data-rcb-video-svg-underlay="1"] { opacity: 0; }
              `}</style>
              {defs}
              {/* Grid under SVG plates; idle ink above plates (frame-clipped). */}
              <canvas
                ref={paintCanvasRef}
                aria-hidden
                data-rcb-scene-canvas="1"
                data-rcb-pixel-grid={showPixelGrid ? '1' : undefined}
                data-rcb-grid-size={String(g)}
                data-rcb-grid-left={String(Math.floor(sceneLeft / g) * g)}
                data-rcb-grid-top={String(Math.floor(sceneTop / g) * g)}
                className="pointer-events-none absolute inset-0 z-0"
              />
              {/* SVG paint uses the exact same direct CameraTransform as screen chrome. */}
              {stageW > 0 && stageH > 0 ? (
                <svg
                  ref={setSceneRootNode}
                  aria-hidden
                  data-rcb-scene-root="1"
                  data-rcb-screen-surface="1"
                  data-rcb-infinite="1"
                  data-rcb-shared-scene-surface="1"
                  data-rcb-scene-surface="1"
                  data-rcb-grid-size={String(g)}
                  className="pointer-events-none absolute inset-0 z-[1] overflow-visible"
                  width={stageW}
                  height={stageH}
                  viewBox={`0 0 ${stageW} ${stageH}`}
                  preserveAspectRatio="none"
                  style={{
                    width: stageW,
                    height: stageH,
                    display: 'block',
                    overflow: 'visible',
                    shapeRendering: 'geometricPrecision',
                    pointerEvents: 'none',
                    // Keep mix-blend-mode layers compositing in SVG paint order
                    // (above artboard plates) instead of against the page backdrop.
                    isolation: 'isolate',
                  }}
                >
                  <g data-rcb-scene-camera="1" transform={sceneCameraTransform}>
                    <g data-rcb-shapes-mount="1" />
                    <g data-rcb-process-mount="1" />
                    <g data-rcb-draw-preview-mount="1" />
                    <g data-rcb-smart-guides-mount="1" />
                    <g data-rcb-selection-chrome-mount="1" pointerEvents="none" />
                  </g>
                </svg>
              ) : null}
              <canvas
                ref={inkCanvasRef}
                aria-hidden
                data-rcb-idle-ink-canvas="1"
                data-rcb-canvas-idle-count={String(listSceneCanvasIdlePaintIds().length)}
                className="pointer-events-none absolute inset-0 z-[2]"
              />
              {children}
              <div
                ref={setOverlayEl}
                data-rcb-overlay="1"
                className="pointer-events-none absolute inset-0 z-[20] overflow-visible"
              />
            </div>
          </RcbOverlayRootContext.Provider>
        </RcbViewportElContext.Provider>
      </RcbDevicePixelRatioContext.Provider>
      </RcbCameraMotionContext.Provider>
    </RcbCameraContext.Provider>
  );
}

export default memo(RcbCanvas);
