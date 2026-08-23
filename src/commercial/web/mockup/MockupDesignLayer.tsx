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
import { useRcbCamera, rcbSceneToScreen } from '@/components/rcb';
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
}: {
  imageBox: SceneBox;
  designSrc: string;
  placement: MockupPlacement;
  selected: boolean;
  onSelect: () => void;
  onPlacementChange: (next: MockupPlacement) => void;
  templateW?: number;
  templateH?: number;
}): ReactNode {
  const camera = useRcbCamera();
  const z = Math.max(0.05, camera.zoom || 1);
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

  const origin = rcbSceneToScreen(camera, imageBox.left, imageBox.top);
  const stageW = Math.max(1, imageBox.width * z);
  const stageH = Math.max(1, imageBox.height * z);
  const sx = stageW / templateW;
  const sy = stageH / templateH;

  const localFromClient = useCallback(
    (clientX: number, clientY: number) => ({
      x: (clientX - origin.x) / sx,
      y: (clientY - origin.y) / sy,
    }),
    [origin.x, origin.y, sx, sy]
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
    left: origin.x,
    top: origin.y,
    width: stageW,
    height: stageH,
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
      data-mockup-design-layer
      className="pointer-events-auto absolute"
      style={shellStyle}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          e.stopPropagation();
          onSelect();
        }
      }}
    >
      <div
        className="absolute overflow-hidden"
        style={{
          left,
          top,
          width,
          height,
          transform: `rotate(${p.angle}deg)`,
          transformOrigin: 'center center',
          outline: selected ? '2px solid var(--accent)' : '1px dashed rgba(59,130,246,0.65)',
          boxShadow: selected ? '0 0 0 1px rgba(255,255,255,0.85)' : undefined,
          cursor: 'move',
        }}
        onPointerDown={(e) => startDrag(e, 'move')}
      >
        <img src={designSrc} alt="" className="h-full w-full object-fill" draggable={false} />
      </div>
      {selected ? (
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
