import { useEffect, useRef, useState, memo } from 'react';
import { NodeProcessGlow } from '@/components/editor/nodes/ImageNode/ImageProcessOverlay';
import { useRcbCamera } from '@/components/rcb/camera/context';
import { rcbCameraCssZoom } from '@/components/rcb/core/math';
import {
  applyFrameContentClip,
  clearFrameContentClip,
} from '@/components/rcb/frames/frameContentClip';
import {
  createSvgBoard,
  nodeToSvgElement,
} from '@/components/rcb/scene/paint/sceneToSvg';
import {
  blendModeToCss,
  parseBlendMode,
  parseLayerOpacity,
} from '@/components/rcb/selection/chrome/BlendModeControl';
import {
  getSceneShapesMount,
  getSceneWorldEpoch,
  getSceneWorldRoot,
  getSharedNodeEls,
  registerShapeHost,
  subscribeShapeHosts,
  syncSharedMountPaintOrder,
  unregisterShapeHost,
  updateShapeHostElement,
} from '@/components/rcb/shapes/shapeHostRegistry';
import type { SceneDocument } from '@/components/rcb/sceneNode';

type Props = {
  nodeId: string;
  document: SceneDocument;
  /** Paint order among siblings (ROOT.children index). */
  zIndex: number;
  /** Bumps force a full remount / redraw of this host. */
  reloadToken?: number | string;
  /** Changes when frame geometry or clipping settings change. */
  frameClipToken?: string;
  /** Keep SVG paint invisible (inline text editor owns the glyphs). */
  forceHidden?: boolean;
  /** Selected nodes show their full paint while crossing an artboard edge. */
  revealOverflow?: boolean;
};

function sameProcessingPaintNode(prev: unknown, next: unknown): boolean {
  if (!prev || !next || typeof prev !== 'object' || typeof next !== 'object') return false;
  const a = prev as { key?: string; attrs?: { processStatus?: string } };
  const b = next as { key?: string; attrs?: { processStatus?: string } };
  if (a.attrs !== b.attrs) return false;
  if (String(a.attrs?.processStatus || '') !== 'running') return false;
  return a.key === b.key;
}

/**
 * A geometry commit creates a new document shell, while every untouched node
 * keeps its object identity. Comparing the whole document here made every
 * mounted brush host render on each drag commit, which is costly enough for
 * dense pencil strokes to visibly shake. A host only needs its own node.
 */
export function shapeHostPropsEqual(previous: Props, next: Props): boolean {
  const prevNode = previous.document?.deltaSetLike?.[previous.nodeId];
  const nextNode = next.document?.deltaSetLike?.[next.nodeId];
  const sameNode =
    prevNode === nextNode ||
    (prevNode && nextNode && sameProcessingPaintNode(prevNode, nextNode));
  return (
    previous.nodeId === next.nodeId &&
    previous.zIndex === next.zIndex &&
    previous.reloadToken === next.reloadToken &&
    previous.frameClipToken === next.frameClipToken &&
    previous.forceHidden === next.forceHidden &&
    previous.revealOverflow === next.revealOverflow &&
    sameNode &&
    // clearImageProcessAttrs replaces attrs on the same node record — compare attrs
    // so upload/AI shimmer unmounts even when geometry commits skip sceneReloadToken.
    prevNode?.attrs === nextNode?.attrs
  );
}

function setHostPaintOpacity(el: Element | null | undefined, hidden: boolean) {
  if (!el) return;
  const v = hidden ? '0' : '1';
  if (el instanceof HTMLElement || el instanceof SVGElement) {
    el.style.opacity = v;
  }
  el.setAttribute('opacity', v);
  const anyEl = el as any;
  if (typeof anyEl.opacity === 'function') anyEl.opacity(hidden ? 0 : 1);
}

function resolveHostPaintEl(
  nodeId: string,
  layer?: SVGGElement | null
): SVGElement | null {
  return (
    getSharedNodeEls()?.get(nodeId) ||
    (layer?.querySelector?.(
      `[data-scene-node-id="${CSS.escape(nodeId)}"]`
    ) as SVGElement | null) ||
    null
  );
}

/** Blend on the paint node only — never on the stack layer (under-plate bug). */
function applyHostBlend(el: SVGElement | null | undefined, blendCss: string) {
  if (!el) return;
  if (blendCss) el.style.mixBlendMode = blendCss;
  else el.style.removeProperty('mix-blend-mode');
}

/**
 * One paint host per scene node under the camera world layer.
 * Paints only in the shared scene SVG. A missing mount means this render waits
 * for the registry epoch instead of creating a second camera/viewBox pipeline.
 */
function RcbShapeHost({
  nodeId,
  document,
  zIndex,
  reloadToken = 0,
  frameClipToken = '',
  forceHidden = false,
  revealOverflow = false,
}: Props) {
  const camera = useRcbCamera();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<SVGGElement | null>(null);
  const bootRef = useRef(0);
  const forceHiddenRef = useRef(forceHidden);
  forceHiddenRef.current = forceHidden;
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
  const node = document?.deltaSetLike?.[nodeId];
  const clipGeometryToken = [node?.x, node?.y, node?.width, node?.height].join('|');
  const blendMode = parseBlendMode(node?.attrs?.blendMode, { allowPassThrough: false });
  const layerOpacity = parseLayerOpacity(node?.attrs?.opacity, 1);
  // Selected: drop mix-blend so paint can sit above artboard plates.
  const activeBlendCss = revealOverflow ? '' : blendModeToCss(blendMode);
  const paintZIndex = revealOverflow ? 2_000_000_000 + zIndex : zIndex;
  // Remount when stroke/fill paint attrs change — not on every geometry nudge.
  const paintToken = [
    node?.attrs?.hidden,
    node?.attrs?.locked,
    node?.attrs?.strokeAlign,
    node?.attrs?.['border-width'],
    node?.attrs?.['border-color'],
    node?.attrs?.['stroke-opacity'],
    node?.attrs?.strokeStyle,
    node?.attrs?.strokeLinecap,
    node?.attrs?.strokeLinejoin,
    node?.attrs?.['stroke-enabled'],
    node?.attrs?.['stroke-visible'],
    node?.attrs?.['fill-color'],
    node?.attrs?.['fill-type'],
    node?.attrs?.['fill-opacity'],
    node?.attrs?.['fill-enabled'],
    node?.attrs?.['fill-visible'],
    node?.attrs?.['fill-gradient'],
    node?.attrs?.['fill-image-src'],
    node?.attrs?.['fill-image-fit'],
    node?.attrs?.['fill-image-rotate'],
    node?.attrs?.['fill-image-scale'],
    node?.attrs?.['fill-image-offset-x'],
    node?.attrs?.['fill-image-offset-y'],
    node?.attrs?.['fill-image-adjust'],
    node?.attrs?.opacity,
    node?.attrs?.blendMode,
    node?.attrs?.markdown ?? node?.attrs?.DATA,
    node?.attrs?.fontSize,
    node?.attrs?.fontFamily,
    node?.attrs?.autoSize,
    node?.attrs?.path,
    node?.attrs?.shapeType,
    // Remount when rotation commits — chrome knobs mirror host transform; without
    // this, translate-only lag after angle commit leaves radius dots "跑路".
    node?.attrs?.angle,
    node?.attrs?.brushStyle,
    node?.attrs?.pathPressure,
    // All effects share the SVG paint path. Include their complete input so a
    // path/line/pen gets the same immediate repaint as an image or rect.
    node?.attrs?.['shadow-enabled'],
    node?.attrs?.['shadow-visible'],
    node?.attrs?.['shadow-color'],
    node?.attrs?.['shadow-x'],
    node?.attrs?.['shadow-y'],
    node?.attrs?.['shadow-blur'],
    node?.attrs?.['inner-shadow-enabled'],
    node?.attrs?.['inner-shadow-visible'],
    node?.attrs?.['inner-shadow-color'],
    node?.attrs?.['inner-shadow-x'],
    node?.attrs?.['inner-shadow-y'],
    node?.attrs?.['inner-shadow-blur'],
    node?.attrs?.['backdrop-blur-enabled'],
    node?.attrs?.['backdrop-blur-amount'],
    node?.attrs?.['backdrop-blur-brightness'],
    node?.attrs?.['blur-enabled'],
    node?.attrs?.['blur-amount'],
    // Empty generator / process hairlines are screen-constant (css/zoom) — remount on zoom.
    String(node?.attrs?.processStatus || '') === 'running' ||
    node?.attrs?.imageGenerator ||
    node?.attrs?.videoGenerator ||
    node?.attrs?.lottieGenerator ||
    node?.attrs?.audioGenerator
      ? rcbCameraCssZoom(camera).toFixed(3)
      : '',
    // Process SoftGlow lives on this host — remount when status/label flips so
    // finishImageProcess drops the glow with the plate (no orphan overlay).
    String(node?.attrs?.processStatus || ''),
    String(node?.attrs?.processLabel || ''),
  ].join('|');

  const processing = String(node?.attrs?.processStatus || '') === 'running';
  const [paintEl, setPaintEl] = useState<SVGElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !document) return undefined;

    const seq = ++bootRef.current;
    const n = document.deltaSetLike?.[nodeId];
    let cancelled = false;
    const sharedRoot = getSceneWorldRoot();
    const sharedMount = getSceneShapesMount();
    if (!sharedRoot || !sharedMount) return undefined;

    const { root, layer } = createSvgBoard(host, 1, 1, {
      infinite: true,
      sharedRoot,
      sharedMount,
    });
    layerRef.current = layer;
    layer.setAttribute('data-rcb-shape-id', nodeId);
    layer.setAttribute('data-z', String(paintZIndex));
    layer.style.opacity = forceHiddenRef.current ? '0' : String(layerOpacity);
    layer.style.removeProperty('mix-blend-mode');

    const nodeEls = getSharedNodeEls() || new Map();
    registerShapeHost({ nodeId, root, layer, el: null, kind: 'svg' });
    setPaintEl(null);

    async function mountShape() {
      try {
        const el = await nodeToSvgElement(root, layer, document, n, nodeId);
        if (cancelled || bootRef.current !== seq) {
          try {
            el?.remove();
          } catch {
            /* ignore */
          }
          return;
        }
        if (el) {
          applyHostBlend(el, activeBlendCss);
          el.style.opacity = '1';
          el.setAttribute('opacity', '1');
          if (forceHiddenRef.current) setHostPaintOpacity(el, true);
          if (revealOverflow) clearFrameContentClip(el);
          else applyFrameContentClip(root, el, document, n, { zoom: camera.zoom });
          const sharedMap = getSharedNodeEls();
          if (sharedMap) sharedMap.set(nodeId, el);
          else nodeEls.set(nodeId, el);
          updateShapeHostElement(nodeId, el);
          setPaintEl(el);
        }
      } catch (err) {
        console.error('RcbShapeHost mount failed', nodeId, err);
      }
    }
    mountShape();

    return () => {
      cancelled = true;
      setPaintEl(null);
      unregisterShapeHost(nodeId);
      try {
        layer.remove();
      } catch {
        /* ignore */
      }
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, reloadToken, paintToken, worldEpoch]);

  useEffect(() => {
    const el = resolveHostPaintEl(nodeId, layerRef.current);
    const root = getSceneWorldRoot();
    if (!el || !root) return;
    if (revealOverflow) clearFrameContentClip(el);
    else applyFrameContentClip(root, el, document, node, { zoom: camera.zoom });
  }, [camera.zoom, clipGeometryToken, document, frameClipToken, node, nodeId, revealOverflow, worldEpoch]);

  useEffect(() => {
    const el = resolveHostPaintEl(nodeId, layerRef.current);
    setHostPaintOpacity(el, forceHidden);
    const layer = layerRef.current;
    if (layer) layer.style.opacity = forceHidden ? '0' : String(layerOpacity);
  }, [forceHidden, nodeId, paintToken, reloadToken, layerOpacity]);

  useEffect(() => {
    const layer = layerRef.current;
    if (layer) layer.style.removeProperty('mix-blend-mode');
    applyHostBlend(resolveHostPaintEl(nodeId, layer), activeBlendCss);
  }, [activeBlendCss, paintToken, nodeId]);

  useEffect(() => {
    const layer = layerRef.current;
    const mount = getSceneShapesMount();
    if (!layer) return;
    layer.setAttribute('data-z', String(paintZIndex));
    if (!mount || layer.parentNode !== mount) return;
    syncSharedMountPaintOrder(mount);
  }, [paintZIndex, paintToken, worldEpoch]);

  return (
    <div
      ref={wrapRef}
      data-rcb-shape={nodeId}
      className="pointer-events-none absolute left-0 top-0 overflow-visible"
      style={{
        zIndex,
        // Shared-world paint lives in the scene SVG; wrap is a React anchor only.
        opacity: 1,
      }}
    >
      <div
        ref={hostRef}
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        data-rcb-shape-host={nodeId}
        style={{ width: 0, height: 0, overflow: 'visible' }}
      />
      {processing && paintEl && node ? (
        <NodeProcessGlow nodeId={nodeId} node={node} paintHost={paintEl} />
      ) : null}
    </div>
  );
}

export default memo(RcbShapeHost, shapeHostPropsEqual);
