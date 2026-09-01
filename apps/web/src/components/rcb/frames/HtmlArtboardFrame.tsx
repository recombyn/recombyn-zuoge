/** Artboard: SVG plate + world-layer title / process chrome. */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  memo,
} from 'react';
import { createPortal } from 'react-dom';
import { useRcbCamera } from '../camera/context';
import { rcbCameraCssZoom } from '../core/math';
import { createSvgBoard } from '@/components/rcb/scene/paint/sceneToSvg';
import { append, setAttrs, setFill, setStroke, svgEl } from '@/components/rcb/scene/paint/svgDom';
import {
  getShapeHost,
  getSceneFramesMount,
  getSceneFramesRoot,
  getSceneSelectionChromeMount,
  getSceneWorldEpoch,
  registerShapeHost,
  subscribeShapeHosts,
  syncFrameMountPaintOrder,
  unregisterShapeHost,
  updateShapeHostElement,
} from '@/components/rcb/shapes/shapeHostRegistry';
import NodeTitleLabel from '../selection/chrome/NodeTitleLabel';
import { ProcessGlowShell } from '@/components/rcb/process/ProcessGlowShell';
import { processGlowForeignObjectBounds } from '@/components/rcb/process/processGlow';
import { appendProcessPlatePaths, syncProcessPlateGeometry } from '@/components/rcb/process/processPlateSvg';
import { roundedRectPath } from '@/components/rcb/scene/document/sceneRadii';
import type { ArtboardFrame } from '@/components/rcb/frames/types';
import {
  FRAME_HIGHLIGHT_STROKE,
  FRAME_PLATE_STROKE,
  framePlateStrokeSceneWidth,
  isAnimationArtboardKind,
} from '@/components/rcb/frames/types';

type HtmlArtboardFrameProps = {
  frame: ArtboardFrame;
  /** Full chrome selected — plate stroke off (SelectionChrome owns the box). */
  selected?: boolean;
  /** Soft context focus — blue edge only (interior click / working inside). */
  highlighted?: boolean;
  onSelect?: () => void;
  onRename?: (name: string) => void;
  /** Drag the label to move the artboard. */
  onMove?: (x: number, y: number, opts?: { skipGrid?: boolean }) => void;
  onMoveStart?: () => void;
  /** Label drag ended (clear guides, etc.). */
  onMoveEnd?: () => void;
  /** Hide title while the frame is being moved. */
  hideTitle?: boolean;
  /** body under shapes; process above shapes (cover until run ends); label clickable */
  layer?: 'body' | 'process' | 'label';
  /** Unified stack z-index (interleaves with shapes). */
  zIndex?: number;
  /** PR9 ephemeral overlay — not read from SceneDocument. */
  aiGenerating?: boolean;
  aiProcessLabel?: string;
};

export type ArtboardFrameGeometry = Pick<ArtboardFrame, 'id' | 'x' | 'y' | 'width' | 'height'>;

/**
 * Gesture-time plate geometry (ADR 0027). Selection chrome updates every move;
 * React still holds the pre-gesture editor store frame — without this map, a layout
 * effect would rebuild the plate from stale width/height and desync the white
 * plate from the blue selection box (and leave clipContent one frame behind).
 */
const liveArtboardGeomById = new Map<string, ArtboardFrameGeometry>();
const liveArtboardListeners = new Set<() => void>();

function notifyLiveArtboardFrameGeometry() {
  for (const fn of liveArtboardListeners) fn();
}

export function getLiveArtboardFrameGeometry(id: string): ArtboardFrameGeometry | null {
  const key = String(id || '').trim();
  if (!key) return null;
  return liveArtboardGeomById.get(key) ?? null;
}

/** Drop live overrides after commit / cancelled transform. */
export function clearLiveArtboardFrameGeometry(ids?: readonly string[]): void {
  if (!ids || !ids.length) {
    liveArtboardGeomById.clear();
  } else {
    for (const id of ids) liveArtboardGeomById.delete(String(id || '').trim());
  }
  notifyLiveArtboardFrameGeometry();
}

/** True while any artboard plate is at gesture-time geometry. */
export function hasLiveArtboardFrameGeometry(): boolean {
  return liveArtboardGeomById.size > 0;
}

/** SoA / host ink must re-read `nodeLeftTop` when the live plate moves. */
export function subscribeLiveArtboardFrameGeometry(listener: () => void): () => void {
  liveArtboardListeners.add(listener);
  return () => {
    liveArtboardListeners.delete(listener);
  };
}

function resolvePaintFrameGeometry(frame: ArtboardFrameGeometry): ArtboardFrameGeometry {
  const live = getLiveArtboardFrameGeometry(frame.id);
  if (!live) return frame;
  return {
    id: frame.id,
    x: live.x,
    y: live.y,
    width: live.width,
    height: live.height,
  };
}

/**
 * Drag-time frame paint follows the same immediate SVG path as scene nodes.
 * React receives the final document position on pointer-up; repainting through
 * editor store during the drag puts frame paint one animation frame behind its nodes.
 */
export function previewArtboardFrameGeometry(
  frame: ArtboardFrameGeometry,
  opts?: { recordLive?: boolean }
): boolean {
  const id = String(frame.id || '').trim();
  if (!id) return false;
  const x = Number(frame.x) || 0;
  const y = Number(frame.y) || 0;
  const width = Math.max(1, Number(frame.width) || 1);
  const height = Math.max(1, Number(frame.height) || 1);
  if (opts?.recordLive !== false) {
    const prev = liveArtboardGeomById.get(id);
    const same =
      prev &&
      prev.x === x &&
      prev.y === y &&
      prev.width === width &&
      prev.height === height;
    liveArtboardGeomById.set(id, { id, x, y, width, height });
    // Skip notify when the plate did not move — pointermove can repeat snaps.
    if (!same) notifyLiveArtboardFrameGeometry();
  }
  const el = getShapeHost(id)?.el as SVGGElement | null | undefined;
  if (!el) return false;
  setAttrs(el, { transform: `translate(${x} ${y})` });
  const host = el as typeof el & {
    __sceneLeft?: number;
    __sceneTop?: number;
    sceneWidth?: number;
    sceneHeight?: number;
  };
  host.__sceneLeft = x;
  host.__sceneTop = y;
  host.sceneWidth = width;
  host.sceneHeight = height;
  if (el.getAttribute('data-rcb-process-plate') === '1') {
    syncProcessPlateGeometry(
      el,
      roundedRectPath(width, height, { tl: 0, tr: 0, br: 0, bl: 0 })
    );
    return true;
  }
  const plate = el.querySelector<SVGRectElement>('rect[data-baseline="1"]');
  if (plate) setAttrs(plate, { width, height });
  return true;
}

function paintFramePlate(
  layer: SVGGElement,
  frame: ArtboardFrame,
  selected: boolean,
  highlighted: boolean,
  generating: boolean,
  zoom: number
): SVGGElement {
  while (layer.firstChild) layer.removeChild(layer.firstChild);

  const x = Number(frame.x) || 0;
  const y = Number(frame.y) || 0;
  const w = Math.max(1, Number(frame.width) || 1);
  const h = Math.max(1, Number(frame.height) || 1);
  const backgroundOpacity = generating
    ? 1
    : Math.max(0, Math.min(100, Number(frame.backgroundOpacity ?? 100))) / 100;

  const g = svgEl('g');
  append(layer, g);
  setAttrs(g, {
    transform: `translate(${x} ${y})`,
    'data-frame-id': frame.id,
    'data-scene-node-id': frame.id,
    'data-rcb-frame-plate': '1',
  });
  if (generating) setAttrs(g, { 'data-rcb-process-plate': '1' });
  const anyG = g as unknown as {
    __sceneLeft?: number;
    __sceneTop?: number;
    sceneWidth?: number;
    sceneHeight?: number;
  };
  anyG.__sceneLeft = x;
  anyG.__sceneTop = y;
  anyG.sceneWidth = w;
  anyG.sceneHeight = h;

  const root = layer.ownerSVGElement;
  const clipD = roundedRectPath(w, h, { tl: 0, tr: 0, br: 0, bl: 0 });
  const stroke = selected
    ? undefined
    : {
        color: highlighted ? FRAME_HIGHLIGHT_STROKE : FRAME_PLATE_STROKE,
        width: framePlateStrokeSceneWidth(zoom),
      };

  if (generating && root) {
    appendProcessPlatePaths(g, root, frame.id, clipD, w, h, stroke || undefined);
  } else {
    let bg = '#FFFFFF';
    if (frame.backgroundColor && frame.backgroundColor !== 'transparent') {
      bg = frame.backgroundColor;
    }
    const plate = svgEl('rect', {
      x: 0,
      y: 0,
      width: w,
      height: h,
      'data-baseline': '1',
      'data-radius-body': '1',
    });
    append(g, plate);
    setFill(plate, bg);
    setAttrs(plate, { 'fill-opacity': backgroundOpacity });
    plate.removeAttribute('vector-effect');
    if (selected) {
      setStroke(plate, 'none');
      plate.removeAttribute('shape-rendering');
    } else if (highlighted) {
      setStroke(plate, {
        color: FRAME_HIGHLIGHT_STROKE,
        width: framePlateStrokeSceneWidth(zoom),
      });
      setAttrs(plate, { 'shape-rendering': 'crispEdges' });
    } else {
      setStroke(plate, {
        color: FRAME_PLATE_STROKE,
        width: framePlateStrokeSceneWidth(zoom),
      });
      setAttrs(plate, { 'shape-rendering': 'crispEdges' });
    }
  }
  return g;
}

function HtmlArtboardFrame({
  frame,
  selected = false,
  highlighted = false,
  onSelect,
  onRename,
  onMove,
  onMoveStart,
  onMoveEnd,
  hideTitle = false,
  layer = 'body',
  zIndex = 0,
  aiGenerating = false,
  aiProcessLabel,
}: HtmlArtboardFrameProps): ReactNode {
  const camera = useRcbCamera();
  const z = rcbCameraCssZoom(camera);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<SVGGElement | null>(null);
  const generating =
    Boolean(aiGenerating) || String(frame.processStatus || '') === 'running';
  const processLabel = String(
    aiProcessLabel || frame.processLabel || 'Preparing…'
  );
  // Remount into shared world SVG when it appears (same as RcbShapeHost).
  // Private fallback SVGs stack via HTML z-index and cover shared shape paint.
  const [worldEpoch, setWorldEpoch] = useState(() => getSceneWorldEpoch());
  useEffect(
    () =>
      subscribeShapeHosts(() => {
        setWorldEpoch((prev) => {
          const next = getSceneWorldEpoch();
          return prev === next ? prev : next;
        });
      }),
    []
  );

  useLayoutEffect(() => {
    if (layer !== 'body') return undefined;
    const host = hostRef.current;
    if (!host) return undefined;

    const worldRoot = getSceneFramesRoot();
    const framesMount = getSceneFramesMount();
    if (!worldRoot || !framesMount) return undefined;
    const { root, layer: sceneLayer, shared } = createSvgBoard(host, 1, 1, {
      infinite: true,
      sharedRoot: worldRoot,
      sharedMount: framesMount,
    });
    layerRef.current = sceneLayer;
    // createSvgBoard tags shared layers as shape; frames must not share that attr
    // or shape-only reorder / hit paths treat the plate as a node layer.
    sceneLayer.removeAttribute('data-rcb-shape-layer');
    sceneLayer.setAttribute('data-rcb-frame-layer', frame.id);
    sceneLayer.setAttribute('data-z', String(zIndex));
    const paintFrame = { ...frame, ...resolvePaintFrameGeometry(frame) };
    const el = paintFramePlate(sceneLayer, paintFrame, selected, highlighted, generating, z);
    registerShapeHost({ nodeId: frame.id, root, layer: sceneLayer, el, kind: 'svg' });
    updateShapeHostElement(frame.id, el);

    if (shared && framesMount && sceneLayer.parentNode === framesMount) {
      syncFrameMountPaintOrder(framesMount);
    }

    return () => {
      unregisterShapeHost(frame.id);
      try {
        sceneLayer.remove();
      } catch {
        /* ignore */
      }
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, frame.id, worldEpoch]);

  // Selection / zoom hairline: repaint plate in place (do not remount the layer g).
  useLayoutEffect(() => {
    if (layer !== 'body') return;
    const sceneLayer = layerRef.current;
    if (!sceneLayer) return;
    // During frame drag, previewArtboardFrameGeometry owns translate/size.
    // A full paintFramePlate rebuild here races children TransformPreview and
    // makes bound content look like it is sliding inside the plate.
    const live = getLiveArtboardFrameGeometry(frame.id);
    if (live) {
      const host = getShapeHost(frame.id)?.el as SVGElement | null | undefined;
      if (!host) return;
      const plate = host.querySelector<SVGRectElement>('rect[data-baseline="1"]');
      if (!plate) return;
      if (selected) {
        setStroke(plate, 'none');
        plate.removeAttribute('shape-rendering');
      } else if (highlighted) {
        setStroke(plate, {
          color: FRAME_HIGHLIGHT_STROKE,
          width: framePlateStrokeSceneWidth(z),
        });
        setAttrs(plate, { 'shape-rendering': 'crispEdges' });
      } else {
        setStroke(plate, {
          color: FRAME_PLATE_STROKE,
          width: framePlateStrokeSceneWidth(z),
        });
        setAttrs(plate, { 'shape-rendering': 'crispEdges' });
      }
      return;
    }
    const paintFrame = { ...frame, ...resolvePaintFrameGeometry(frame) };
    const el = paintFramePlate(sceneLayer, paintFrame, selected, highlighted, generating, z);
    // Avoid bumpHostEpoch on every parent render when only the frame object
    // identity changed (SelectionFeature hostEpoch would thrash).
    const prev = getShapeHost(frame.id)?.el;
    if (prev !== el) updateShapeHostElement(frame.id, el);
  }, [
    layer,
    selected,
    highlighted,
    generating,
    z,
    frame.id,
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    frame.backgroundColor,
    frame.clipContent,
  ]);

  // Same as RcbShapeHost: update data-z + reorder without remounting the plate.
  useLayoutEffect(() => {
    if (layer !== 'body') return;
    const sceneLayer = layerRef.current;
    const framesMount = getSceneFramesMount();
    if (!sceneLayer || !framesMount || sceneLayer.parentNode !== framesMount) return;
    sceneLayer.setAttribute('data-z', String(zIndex));
    syncFrameMountPaintOrder(framesMount);
  }, [layer, zIndex]);
  if (layer === 'label') {
    const live = resolvePaintFrameGeometry(frame);
    return (
      <>
        <NodeTitleLabel
          box={{
            left: live.x,
            top: live.y,
            width: live.width,
            height: live.height,
          }}
          name={frame.name || 'Frame'}
          sizeWidth={live.width}
          sizeHeight={live.height}
          dataAttr="frame-label"
          icon={isAnimationArtboardKind(frame.kind) ? 'lottie' : 'frame'}
          dataProps={{ 'data-frame-id': frame.id }}
          hidden={hideTitle}
          onSelect={onSelect}
          onRename={onRename}
          onMove={onMove}
          onMoveStart={onMoveStart}
          onMoveEnd={onMoveEnd}
          originX={live.x}
          originY={live.y}
          renameAriaLabel="Frame name"
          nodeId={frame.id}
        />
      </>
    );
  }

  // Above SvgCanvas so paint/review/retry stays covered until the AI overlay clears.
  if (layer === 'process') {
    if (!generating) return null;
    const mount = getSceneSelectionChromeMount();
    if (!mount) return null;
    const foBox = processGlowForeignObjectBounds(frame.width, frame.height);
    return createPortal(
      <g data-artboard-process-layer={frame.id} pointerEvents="none">
        <foreignObject
          x={frame.x + foBox.x}
          y={frame.y + foBox.y}
          width={foBox.width}
          height={foBox.height}
          pointerEvents="none"
          style={{ overflow: 'hidden' }}
        >
          <ProcessGlowShell
            seed={frame.id}
            label={processLabel}
            width={frame.width}
            zoom={z}
            labelDataAttr="data-artboard-process-label"
          />
        </foreignObject>
      </g>,
      mount
    );
  }

  return (
    <>
      <div
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        // Plate paints in the shared world SVG via data-z. Do not mirror stack z on
        // this HTML anchor — a private-SVG fallback with high CSS z covers shapes
        // while still letting clicks through (world SVG is pointer-events: none).
        style={{ zIndex: 0 }}
        data-rcb-frame={frame.id}
        data-frame-id={frame.id}
      >
        <div
          ref={hostRef}
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
          data-rcb-shape-host={frame.id}
          style={{ width: 0, height: 0, overflow: 'visible' }}
        />
      </div>
    </>
  );
}

export default memo(HtmlArtboardFrame);
