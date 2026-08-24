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
  getSceneShapesMount,
  getSceneSelectionChromeMount,
  getSceneWorldEpoch,
  getSceneWorldRoot,
  registerShapeHost,
  subscribeShapeHosts,
  syncSharedMountPaintOrder,
  unregisterShapeHost,
  updateShapeHostElement,
} from '@/components/rcb/shapes/shapeHostRegistry';
import NodeTitleLabel from '../selection/chrome/NodeTitleLabel';
import type { ArtboardFrame } from '@/components/rcb/frames/types';
import {
  FRAME_HIGHLIGHT_STROKE,
  FRAME_PLATE_STROKE,
  framePlateStrokeSceneWidth,
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
 * Drag-time frame paint follows the same immediate SVG path as scene nodes.
 * React receives the final document position on pointer-up; repainting through
 * Redux during the drag puts frame paint one animation frame behind its nodes.
 */
export function previewArtboardFrameGeometry(frame: ArtboardFrameGeometry): boolean {
  const el = getShapeHost(String(frame.id))?.el as SVGGElement | null | undefined;
  if (!el) return false;
  const x = Number(frame.x) || 0;
  const y = Number(frame.y) || 0;
  const width = Math.max(1, Number(frame.width) || 1);
  const height = Math.max(1, Number(frame.height) || 1);
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
  let bg = '#FFFFFF';
  if (generating) bg = '#e4ecf4';
  else if (frame.backgroundColor && frame.backgroundColor !== 'transparent') {
    bg = frame.backgroundColor;
  }
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
    // Full chrome owns the blue box — no plate stroke.
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
  const inv = 1 / z;
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

    const worldRoot = getSceneWorldRoot();
    const shapesMount = getSceneShapesMount();
    if (!worldRoot || !shapesMount) return undefined;
    const { root, layer: sceneLayer, shared } = createSvgBoard(host, 1, 1, {
      infinite: true,
      sharedRoot: worldRoot,
      sharedMount: shapesMount,
    });
    layerRef.current = sceneLayer;
    // createSvgBoard tags shared layers as shape; frames must not share that attr
    // or shape-only reorder / hit paths treat the plate as a node layer.
    sceneLayer.removeAttribute('data-rcb-shape-layer');
    sceneLayer.setAttribute('data-rcb-frame-layer', frame.id);
    sceneLayer.setAttribute('data-z', String(zIndex));
    const el = paintFramePlate(sceneLayer, frame, selected, highlighted, generating, z);
    registerShapeHost({ nodeId: frame.id, root, layer: sceneLayer, el, kind: 'svg' });
    updateShapeHostElement(frame.id, el);

    if (shared && shapesMount && sceneLayer.parentNode === shapesMount) {
      syncSharedMountPaintOrder(shapesMount);
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
    const el = paintFramePlate(sceneLayer, frame, selected, highlighted, generating, z);
    updateShapeHostElement(frame.id, el);
  }, [layer, selected, highlighted, generating, z, frame]);

  // Same as RcbShapeHost: update data-z + reorder without remounting the plate.
  useLayoutEffect(() => {
    if (layer !== 'body') return;
    const sceneLayer = layerRef.current;
    const shapesMount = getSceneShapesMount();
    if (!sceneLayer || !shapesMount || sceneLayer.parentNode !== shapesMount) return;
    sceneLayer.setAttribute('data-z', String(zIndex));
    syncSharedMountPaintOrder(shapesMount);
  }, [layer, zIndex]);
  if (layer === 'label') {
    return (
      <>
        <NodeTitleLabel
          box={{
            left: frame.x,
            top: frame.y,
            width: frame.width,
            height: frame.height,
          }}
          name={frame.name || 'Frame'}
          sizeWidth={frame.width}
          sizeHeight={frame.height}
          dataAttr="frame-label"
          icon="frame"
          dataProps={{ 'data-frame-id': frame.id }}
          hidden={hideTitle}
          onSelect={onSelect}
          onRename={onRename}
          onMove={onMove}
          onMoveStart={onMoveStart}
          onMoveEnd={onMoveEnd}
          originX={frame.x}
          originY={frame.y}
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
    const pillBottomPad = 14;
    const maxPillWidth = Math.max(32, frame.width * z - 16);
    return createPortal(
      <g data-artboard-process-layer={frame.id} pointerEvents="none">
        <foreignObject
          x={frame.x}
          y={frame.y}
          width={frame.width}
          height={frame.height}
          pointerEvents="none"
          style={{ overflow: 'hidden' }}
        >
          <div className="relative h-full w-full overflow-hidden">
            <div
              data-artboard-process-shimmer
              data-frame-id={frame.id}
              className="rcb-artboard-process-shimmer absolute inset-0"
              aria-hidden
            />
            <div
              data-artboard-process-label
              data-frame-id={frame.id}
              className="absolute left-1/2 z-[1] inline-flex h-7 w-max items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-[rgba(55,55,55,0.72)] px-2.5 text-[11px] font-medium leading-none text-white shadow-[0_2px_8px_rgba(15,23,42,0.18)]"
              style={{
                bottom: pillBottomPad * inv,
                transform: `translateX(-50%) scale(${inv})`,
                transformOrigin: 'center bottom',
                maxWidth: maxPillWidth,
              }}
            >
              {processLabel}
            </div>
          </div>
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
