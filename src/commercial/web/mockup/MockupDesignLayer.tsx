import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  memo,
} from 'react';
import { useRcbCamera, rcbCameraCssZoom } from '@/components/rcb';
import type { MockupPlacement } from './mockupPlacement';
import { DEMO_CYLINDER_PRINT } from './mockupPlacement';

type SceneBox = { left: number; top: number; width: number; height: number };

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

function clampPlacement(p: MockupPlacement): MockupPlacement {
  const { templateW, templateH } = DEMO_CYLINDER_PRINT;
  const width = Math.max(24, Math.min(templateW, p.width));
  const height = Math.max(24, Math.min(templateH, p.height));
  const x = Math.max(0, Math.min(templateW - width, p.x));
  const y = Math.max(0, Math.min(templateH - height, p.y));
  return { ...p, x, y, width, height };
}

function MockupDesignLayer({
  imageBox,
  designSrc,
  placement,
  selected,
  onSelect,
  onPlacementChange,
  templateW = DEMO_CYLINDER_PRINT.templateW,
  templateH = DEMO_CYLINDER_PRINT.templateH,
  ghostHitOnly = false,
}: {
  imageBox: SceneBox;
  designSrc: string;
  placement: MockupPlacement;
  selected: boolean;
  onSelect: () => void;
  onPlacementChange: (next: MockupPlacement) => void;
  templateW?: number;
  templateH?: number;
  /** Invisible hit target only (warped preview visible underneath). */
  ghostHitOnly?: boolean;
}): ReactNode {
  const camera = useRcbCamera();
  const z = Math.max(0.05, rcbCameraCssZoom(camera));
  const shellRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: DragMode;
    pointerId: number;
    startPlacement: MockupPlacement;
    startLocalX: number;
    startLocalY: number;
  } | null>(null);

  const [livePlacement, setLivePlacement] = useState(placement);
  useEffect(() => {
    if (!dragRef.current) setLivePlacement(placement);
  }, [placement]);

  const stageW = Math.max(1, imageBox.width * z);
  const stageH = Math.max(1, imageBox.height * z);
  const sx = stageW / templateW;
  const sy = stageH / templateH;

  const localFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const rect = shellRef.current?.getBoundingClientRect();
      const left = rect?.left ?? 0;
      const top = rect?.top ?? 0;
      const w = rect?.width && rect.width > 0 ? rect.width : stageW;
      const h = rect?.height && rect.height > 0 ? rect.height : stageH;
      const lsx = w / templateW;
      const lsy = h / templateH;
      return {
        x: (clientX - left) / lsx,
        y: (clientY - top) / lsy,
      };
    },
    [stageW, stageH, templateW, templateH]
  );

  const applyDrag = useCallback(
    (mode: DragMode, start: MockupPlacement, dx: number, dy: number): MockupPlacement => {
      if (mode === 'move') {
        return clampPlacement({ ...start, x: start.x + dx, y: start.y + dy });
      }
      let { x, y, width, height } = start;
      if (mode === 'se') {
        width = start.width + dx;
        height = start.height + dy;
      } else if (mode === 'sw') {
        x = start.x + dx;
        width = start.width - dx;
        height = start.height + dy;
      } else if (mode === 'ne') {
        y = start.y + dy;
        width = start.width + dx;
        height = start.height - dy;
      } else if (mode === 'nw') {
        x = start.x + dx;
        y = start.y + dy;
        width = start.width - dx;
        height = start.height - dy;
      }
      return clampPlacement({ ...start, x, y, width, height });
    },
    []
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const p = localFromClient(e.clientX, e.clientY);
      const dx = p.x - drag.startLocalX;
      const dy = p.y - drag.startLocalY;
      const next = applyDrag(drag.mode, drag.startPlacement, dx, dy);
      setLivePlacement(next);
      onPlacementChange(next);
    };
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [applyDrag, localFromClient, onPlacementChange]);

  const p = livePlacement;
  const left = p.x * sx;
  const top = p.y * sy;
  const width = Math.max(8, p.width * sx);
  const height = Math.max(8, p.height * sy);

  const shellStyle: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    zIndex: 35,
    touchAction: 'none',
  };

  const startDrag = (e: ReactPointerEvent, mode: DragMode) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    const local = localFromClient(e.clientX, e.clientY);
    dragRef.current = {
      mode,
      pointerId: e.pointerId,
      startPlacement: { ...livePlacement },
      startLocalX: local.x,
      startLocalY: local.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handleCls =
    'absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-[var(--accent)] shadow';

  return (
    <div
      ref={shellRef}
      data-mockup-design-layer
      className="pointer-events-none absolute"
      style={shellStyle}
    >
      <div
        className="pointer-events-auto absolute overflow-hidden"
        style={{
          left,
          top,
          width,
          height,
          transform: `rotate(${p.angle}deg)`,
          transformOrigin: 'center center',
          outline: ghostHitOnly
            ? 'none'
            : selected
              ? '2px solid var(--accent)'
              : '1px dashed rgba(59,130,246,0.65)',
          boxShadow:
            ghostHitOnly || !selected ? undefined : '0 0 0 1px rgba(255,255,255,0.85)',
          cursor: 'move',
          opacity: ghostHitOnly ? 0 : 1,
        }}
        onPointerDown={(e) => startDrag(e, 'move')}
      >
        {!ghostHitOnly ? (
          <img src={designSrc} alt="" className="h-full w-full object-fill" draggable={false} />
        ) : null}
      </div>
      {selected && !ghostHitOnly ? (
        <>
          {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => {
            const cx = corner.includes('e') ? left + width : left;
            const cy = corner.includes('s') ? top + height : top;
            return (
              <span
                key={corner}
                className={handleCls}
                style={{ left: cx, top: cy }}
                onPointerDown={(e) => startDrag(e, corner)}
              />
            );
          })}
        </>
      ) : null}
    </div>
  );
}

export default memo(MockupDesignLayer);
