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

const INCLUDE_FILL = '#22C55E';
const EXCLUDE_FILL = '#EF4444';
const PREVIEW_OPACITY = 0.38;
const MAX_MASK_EDGE = 8192;

export type MattingBrushMode = 'include' | 'exclude';

export type MattingHintOverlayHandle = {
  clear: () => void;
  hasStrokes: () => boolean;
  /** Grayscale PNG data URLs aligned to source image pixels. */
  exportMasks: () => Promise<{ includeMask?: string; excludeMask?: string }>;
};

type Props = {
  imageBox: { left: number; top: number; width: number; height: number };
  brushSize: number;
  brushMode: MattingBrushMode;
  onDirtyChange?: (dirty: boolean) => void;
};

function brushFill(mode: MattingBrushMode): string {
  return mode === 'include' ? INCLUDE_FILL : EXCLUDE_FILL;
}

function canvasToHardMaskDataUrl(canvas: HTMLCanvasElement, nw: number, nh: number): string | undefined {
  const hard = document.createElement('canvas');
  hard.width = nw;
  hard.height = nh;
  const hctx = hard.getContext('2d');
  if (!hctx) return undefined;
  hctx.drawImage(canvas, 0, 0, nw, nh);
  const data = hctx.getImageData(0, 0, nw, nh);
  const px = data.data;
  let any = false;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] > 8) {
      px[i] = 255;
      px[i + 1] = 255;
      px[i + 2] = 255;
      px[i + 3] = 255;
      any = true;
    } else {
      px[i] = 0;
      px[i + 1] = 0;
      px[i + 2] = 0;
      px[i + 3] = 0;
    }
  }
  if (!any) return undefined;
  hctx.putImageData(data, 0, 0);
  return hard.toDataURL('image/png');
}

/**
 * Dual-brush overlay: green = keep (保留), red = exclude (排除).
 */
const MattingHintOverlay = forwardRef<MattingHintOverlayHandle, Props>(
  function MattingHintOverlay({ imageBox, brushSize, brushMode, onDirtyChange }, ref): ReactNode {
    const camera = useRcbCamera();
    const z = Math.max(0.05, camera.zoom || 1);
    const includeRef = useRef<HTMLCanvasElement>(null);
    const excludeRef = useRef<HTMLCanvasElement>(null);
    const paintingRef = useRef(false);
    const lastRef = useRef<{ x: number; y: number } | null>(null);
    const dirtyRef = useRef(false);
    const onDirtyRef = useRef(onDirtyChange);
    onDirtyRef.current = onDirtyChange;
    const brushRef = useRef(brushSize);
    brushRef.current = brushSize;
    const modeRef = useRef(brushMode);
    modeRef.current = brushMode;
    const [tip, setTip] = useState<{ x: number; y: number } | null>(null);

    const origin = rcbSceneToScreen(camera, imageBox.left, imageBox.top);
    const stageW = Math.max(1, imageBox.width * z);
    const stageH = Math.max(1, imageBox.height * z);
    const tipDiameter = Math.max(6, brushSize * z);

    const activeCanvas = () => (modeRef.current === 'include' ? includeRef.current : excludeRef.current);

    const markDirty = () => {
      if (dirtyRef.current) return;
      dirtyRef.current = true;
      onDirtyRef.current?.(true);
    };

    const clear = () => {
      for (const canvas of [includeRef.current, excludeRef.current]) {
        if (!canvas) continue;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      dirtyRef.current = false;
      onDirtyRef.current?.(false);
    };

    useImperativeHandle(
      ref,
      () => ({
        clear,
        hasStrokes: () => dirtyRef.current,
        exportMasks: async () => {
          const incEl = includeRef.current;
          const excEl = excludeRef.current;
          if (!incEl && !excEl) return {};
          const nw = Math.max(1, Math.round(imageBox.width));
          const nh = Math.max(1, Math.round(imageBox.height));
          if (nw > MAX_MASK_EDGE || nh > MAX_MASK_EDGE) {
            throw new Error(`图片过大（>${MAX_MASK_EDGE}px），请先缩小后再抠图`);
          }
          const includeMask = incEl ? canvasToHardMaskDataUrl(incEl, nw, nh) : undefined;
          const excludeMask = excEl ? canvasToHardMaskDataUrl(excEl, nw, nh) : undefined;
          return { includeMask, excludeMask };
        },
      }),
      [imageBox.height, imageBox.width]
    );

    useEffect(() => {
      const resize = (canvas: HTMLCanvasElement | null) => {
        if (!canvas) return;
        const w = Math.max(1, Math.round(stageW));
        const h = Math.max(1, Math.round(stageH));
        if (canvas.width === w && canvas.height === h) return;
        const prev = document.createElement('canvas');
        prev.width = canvas.width || 1;
        prev.height = canvas.height || 1;
        const pctx = prev.getContext('2d');
        if (pctx && canvas.width && canvas.height) {
          pctx.drawImage(canvas, 0, 0);
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx && prev.width > 1 && prev.height > 1) {
          ctx.drawImage(prev, 0, 0, w, h);
        }
      };
      resize(includeRef.current);
      resize(excludeRef.current);
    }, [stageW, stageH]);

    const localFromClient = (clientX: number, clientY: number) => {
      const canvas = activeCanvas();
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

    const strokeTo = (x: number, y: number, from: { x: number; y: number } | null) => {
      const canvas = activeCanvas();
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const fill = brushFill(modeRef.current);
      const r = Math.max(1, (brushRef.current * z) / 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = fill;
      ctx.fillStyle = fill;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = r * 2;
      if (!from) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      markDirty();
    };

    useEffect(() => {
      const onMove = (e: PointerEvent) => {
        const p = localFromClient(e.clientX, e.clientY);
        if (!p?.inside) {
          setTip(null);
          return;
        }
        setTip({ x: p.stageX, y: p.stageY });
        if (!paintingRef.current) return;
        strokeTo(p.x, p.y, lastRef.current);
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
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stageW, stageH, brushMode]);

    const overlayStyle: CSSProperties = {
      position: 'absolute',
      left: origin.x,
      top: origin.y,
      width: stageW,
      height: stageH,
      zIndex: 35,
      touchAction: 'none',
      cursor: 'crosshair',
    };

    const canvasStyle: CSSProperties = {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      opacity: PREVIEW_OPACITY,
      pointerEvents: 'none',
    };

    const paintLayerStyle: CSSProperties = {
      ...canvasStyle,
      pointerEvents: brushMode === 'include' ? 'auto' : 'none',
      opacity: PREVIEW_OPACITY,
    };

    const excludeLayerStyle: CSSProperties = {
      ...canvasStyle,
      pointerEvents: brushMode === 'exclude' ? 'auto' : 'none',
      opacity: PREVIEW_OPACITY,
    };

    return (
      <RcbOverlayPortal>
        <div
          style={overlayStyle}
          data-matting-hint-overlay
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const p = localFromClient(e.clientX, e.clientY);
            if (!p?.inside) return;
            paintingRef.current = true;
            lastRef.current = null;
            strokeTo(p.x, p.y, null);
            lastRef.current = { x: p.x, y: p.y };
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          }}
        >
          <canvas ref={includeRef} style={paintLayerStyle} />
          <canvas ref={excludeRef} style={excludeLayerStyle} />
          {tip ? (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                left: tip.x - tipDiameter / 2,
                top: tip.y - tipDiameter / 2,
                width: tipDiameter,
                height: tipDiameter,
                borderRadius: '50%',
                border: `2px solid ${brushFill(brushMode)}`,
                pointerEvents: 'none',
                boxSizing: 'border-box',
              }}
            />
          ) : null}
        </div>
      </RcbOverlayPortal>
    );
  }
);

export default memo(MattingHintOverlay);
