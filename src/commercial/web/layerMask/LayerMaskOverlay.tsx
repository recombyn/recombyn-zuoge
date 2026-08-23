import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  memo,
} from 'react';
import { RcbOverlayPortal, useRcbCamera, rcbSceneToScreen } from '@/components/rcb';
import {
  DEFAULT_LAYER_MASK_BRUSH,
  maskBrushRadiusScene,
  paintMaskStroke,
  type LayerMaskBrushSettings,
  type MaskPaintColor,
} from './layerMaskBrush';
import {
  drawMaskSrcToCanvas,
  exportGrayscaleMaskDataUrl,
  fillWhiteMaskCanvas,
} from './layerMaskComposite';

const MASK_TINT = 'rgba(0, 160, 255, 0.35)';
const MAX_MASK_EDGE = 8192;

export type LayerMaskOverlayHandle = {
  clear: () => void;
  hasStrokes: () => boolean;
  exportMask: () => Promise<string | undefined>;
  setPaintColor: (color: MaskPaintColor) => void;
  getPaintColor: () => MaskPaintColor;
  invertMask: () => void;
  fillMask: (color: MaskPaintColor) => void;
};

type Props = {
  imageBox: { left: number; top: number; width: number; height: number };
  brush: LayerMaskBrushSettings;
  maskSrc?: string;
  maskKey?: string | null;
  /** When true, show mask grayscale instead of blue tint. */
  maskPreviewOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
};

const LayerMaskOverlay = forwardRef<LayerMaskOverlayHandle, Props>(function LayerMaskOverlay(
  {
    imageBox,
    brush,
    maskSrc,
    maskKey,
    maskPreviewOnly = false,
    onDirtyChange,
  },
  ref
): ReactNode {
  const camera = useRcbCamera();
  const z = Math.max(0.05, camera.zoom || 1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  const paintingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const dirtyRef = useRef(false);
  const paintColorRef = useRef<MaskPaintColor>('black');
  const brushRef = useRef(brush);
  brushRef.current = brush;
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);

  const origin = rcbSceneToScreen(camera, imageBox.left, imageBox.top);
  const stageW = Math.max(1, imageBox.width * z);
  const stageH = Math.max(1, imageBox.height * z);
  const tipDiameter = Math.max(6, brush.size * z);

  const markDirty = () => {
    if (dirtyRef.current) return;
    dirtyRef.current = true;
    onDirtyRef.current?.(true);
  };

  const nw = Math.max(1, Math.round(imageBox.width));
  const nh = Math.max(1, Math.round(imageBox.height));

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const source = document.createElement('canvas');
      try {
        if (maskSrc) {
          await drawMaskSrcToCanvas(source, maskSrc, nw, nh, maskKey);
        } else {
          fillWhiteMaskCanvas(source, nw, nh);
        }
      } catch {
        fillWhiteMaskCanvas(source, nw, nh);
      }
      if (cancelled) return;
      sourceRef.current = source;
      dirtyRef.current = false;
      onDirtyRef.current?.(false);
      setReady(true);
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [maskKey, maskSrc, nw, nh]);

  const syncDisplayFromSource = () => {
    const canvas = canvasRef.current;
    const source = sourceRef.current;
    if (!canvas || !source) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (maskPreviewOnly) {
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      return;
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = MASK_TINT;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ready) return;
    const w = Math.max(1, Math.round(stageW));
    const h = Math.max(1, Math.round(stageH));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    syncDisplayFromSource();
  }, [ready, stageW, stageH, maskPreviewOnly]);

  useImperativeHandle(
    ref,
    () => ({
      clear: () => {
        const source = sourceRef.current;
        if (!source) return;
        fillWhiteMaskCanvas(source, nw, nh);
        dirtyRef.current = true;
        onDirtyRef.current?.(true);
        syncDisplayFromSource();
      },
      hasStrokes: () => dirtyRef.current,
      exportMask: async () => {
        const source = sourceRef.current;
        if (!source) return undefined;
        return exportGrayscaleMaskDataUrl(source, nw, nh);
      },
      setPaintColor: (color) => {
        paintColorRef.current = color;
      },
      getPaintColor: () => paintColorRef.current,
      invertMask: () => {
        const source = sourceRef.current;
        const ctx = source?.getContext('2d');
        if (!source || !ctx) return;
        const data = ctx.getImageData(0, 0, source.width, source.height);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
          px[i] = 255 - px[i]!;
          px[i + 1] = px[i]!;
          px[i + 2] = px[i]!;
        }
        ctx.putImageData(data, 0, 0);
        markDirty();
        syncDisplayFromSource();
      },
      fillMask: (color) => {
        const source = sourceRef.current;
        const ctx = source?.getContext('2d');
        if (!source || !ctx) return;
        const g = color === 'white' ? 255 : 0;
        ctx.fillStyle = `rgb(${g},${g},${g})`;
        ctx.fillRect(0, 0, source.width, source.height);
        markDirty();
        syncDisplayFromSource();
      },
    }),
    [nw, nh]
  );

  const localFromClient = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
      stageX: clientX - rect.left,
      stageY: clientY - rect.top,
      inside:
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom,
    };
  };

  const paintAt = (
    x: number,
    y: number,
    from: { x: number; y: number } | null,
    pressure: number
  ) => {
    const source = sourceRef.current;
    const canvas = canvasRef.current;
    if (!source || !canvas) return;
    const sctx = source.getContext('2d');
    if (!sctx) return;
    const sx = (x / canvas.width) * source.width;
    const sy = (y / canvas.height) * source.height;
    const sFrom = from
      ? {
          x: (from.x / canvas.width) * source.width,
          y: (from.y / canvas.height) * source.height,
        }
      : null;
    paintMaskStroke(
      sctx,
      sFrom,
      { x: sx, y: sy },
      paintColorRef.current,
      brushRef.current,
      z,
      pressure
    );
    markDirty();
    syncDisplayFromSource();
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = localFromClient(e.clientX, e.clientY);
      if (!p) {
        setTip(null);
        return;
      }
      if (p.inside || paintingRef.current) setTip({ x: p.stageX, y: p.stageY });
      else setTip(null);
      if (!paintingRef.current) return;
      const pressure = e.pressure > 0 ? e.pressure : 1;
      paintAt(p.x, p.y, lastRef.current, pressure);
      lastRef.current = { x: p.x, y: p.y };
    };
    const onUp = () => {
      paintingRef.current = false;
      lastRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [z, ready]);

  if (!ready) return null;

  const style: CSSProperties = {
    position: 'absolute',
    left: origin.x,
    top: origin.y,
    width: stageW,
    height: stageH,
    zIndex: 34,
    cursor: 'none',
    touchAction: 'none',
  };

  const tipStyle: CSSProperties | undefined = tip
    ? {
        position: 'absolute',
        left: origin.x + tip.x,
        top: origin.y + tip.y,
        width: tipDiameter,
        height: tipDiameter,
        marginLeft: -tipDiameter / 2,
        marginTop: -tipDiameter / 2,
        zIndex: 35,
        borderRadius: '50%',
        border: '1.5px solid rgba(15,23,42,0.65)',
        boxSizing: 'border-box',
        pointerEvents: 'none',
        background:
          paintColorRef.current === 'white'
            ? 'rgba(255,255,255,0.45)'
            : 'rgba(0,0,0,0.35)',
      }
    : undefined;

  return (
    <RcbOverlayPortal>
      <canvas
        ref={canvasRef}
        data-layer-mask-overlay
        data-image-tool-panel
        className="pointer-events-auto absolute"
        style={style}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation?.();
          const p = localFromClient(e.clientX, e.clientY);
          if (!p) return;
          setTip({ x: p.stageX, y: p.stageY });
          paintingRef.current = true;
          lastRef.current = { x: p.x, y: p.y };
          paintAt(p.x, p.y, null, e.pressure > 0 ? e.pressure : 1);
          (e.target as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerLeave={() => {
          if (!paintingRef.current) setTip(null);
        }}
      />
      {tip && tipStyle ? <div aria-hidden data-image-tool-panel style={tipStyle} /> : null}
    </RcbOverlayPortal>
  );
});

export default memo(LayerMaskOverlay);

export { DEFAULT_LAYER_MASK_BRUSH, maskBrushRadiusScene };
