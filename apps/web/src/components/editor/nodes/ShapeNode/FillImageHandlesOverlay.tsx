import {
  useEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  memo,
} from 'react';
import { RcbOverlayPortal, useRcbCamera, rcbSceneToScreen } from '@/components/rcb';
import type { FillPanelValue } from '@/components/editor/panels/FillPanel';
import { clientToBoxLocal } from '@/components/rcb/scene/overlay/sceneOverlayCoords';

type SceneBox = { left: number; top: number; width: number; height: number };

type Props = {
  box: SceneBox;
  angle?: number;
  value: FillPanelValue;
  onChange: (next: FillPanelValue) => void;
};

type DragKind = { kind: 'pan' } | { kind: 'rotate' };

const HANDLE = 14;
const RING = 'rgba(15,23,42,0.55)';
const ROTATE_OFFSET = 28;
const PAD_TOP = ROTATE_OFFSET + HANDLE;

/** On-canvas pan / rotate for image fills (world-space overlay). */
function FillImageHandlesOverlay({ box, angle = 0, value, onChange }: Props): ReactNode {
  const camera = useRcbCamera();
  const z = Math.max(0.05, camera.zoom || 1);
  const dragRef = useRef<DragKind | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const startRef = useRef({
    offsetX: 0,
    offsetY: 0,
    rotate: 0,
    panX: 0,
    panY: 0,
    startAngle: 0,
  });

  valueRef.current = value;
  onChangeRef.current = onChange;

  const origin = rcbSceneToScreen(camera, box.left, box.top);
  const stageW = box.width * z;
  const stageH = box.height * z;
  const padTop = PAD_TOP * z;
  const w = box.width;
  const h = box.height;

  const toLocal = (clientX: number, clientY: number, el: HTMLElement) =>
    clientToBoxLocal(clientX, clientY, el.getBoundingClientRect(), w, h, angle);

  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const root = document.querySelector('[data-fill-image-inner]') as HTMLElement | null;
      if (!root) return;
      const local = toLocal(ev.clientX, ev.clientY, root);
      const v = valueRef.current;

      if (drag.kind === 'pan') {
        const dx = local.x - startRef.current.panX;
        const dy = local.y - startRef.current.panY;
        onChangeRef.current({
          ...v,
          fillImageOffsetX: startRef.current.offsetX + (dx / Math.max(1, w)) * 100,
          fillImageOffsetY: startRef.current.offsetY + (dy / Math.max(1, h)) * 100,
        });
        return;
      }

      const ang = (Math.atan2(local.y - h / 2, local.x - w / 2) * 180) / Math.PI;
      onChangeRef.current({
        ...v,
        fillImageRotate: Math.round((startRef.current.rotate + ang - startRef.current.startAngle) * 10) / 10,
      });
    };

    const onUp = () => {
      dragRef.current = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [angle, h, w]);

  const startDrag =
    (kind: DragKind) =>
    (e: ReactPointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const root = e.currentTarget.closest('[data-fill-image-inner]') as HTMLElement | null;
      if (!root) return;
      const local = toLocal(e.clientX, e.clientY, root);
      startRef.current = {
        offsetX: value.fillImageOffsetX ?? 0,
        offsetY: value.fillImageOffsetY ?? 0,
        rotate: value.fillImageRotate ?? 0,
        panX: local.x,
        panY: local.y,
        startAngle: (Math.atan2(local.y - h / 2, local.x - w / 2) * 180) / Math.PI,
      };
      dragRef.current = kind;
    };

  const handleStyle = (extra?: CSSProperties): CSSProperties => ({
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    marginLeft: -HANDLE / 2,
    marginTop: -HANDLE / 2,
    borderRadius: '9999px',
    border: `2px solid ${RING}`,
    background: 'rgba(255,255,255,0.95)',
    boxShadow: '0 1px 4px rgba(15,23,42,0.18)',
    cursor: 'grab',
    touchAction: 'none',
    pointerEvents: 'auto',
    ...extra,
  });

  return (
    <RcbOverlayPortal>
      <div
        data-fill-image-handles
        className="pointer-events-none absolute z-[35]"
        style={{
          position: 'fixed',
          left: origin.x,
          top: origin.y - padTop,
          width: stageW,
          height: stageH + padTop,
          paddingTop: padTop,
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          data-fill-image-inner
          className="relative"
          style={{
            width: stageW,
            height: stageH,
            transform: angle ? `rotate(${angle}deg)` : undefined,
            transformOrigin: 'center center',
          }}
        >
          <div
            className="absolute inset-0 cursor-grab"
            style={{ pointerEvents: 'auto' }}
            onPointerDown={startDrag({ kind: 'pan' })}
          >
            <div className="pointer-events-none absolute inset-0 rounded-sm border border-dashed border-[#3388ff]/70" />
            <div
              aria-hidden
              className="pointer-events-none absolute text-[10px] text-[#3388ff]"
              style={{ left: 6, top: 6 }}
            >
              拖动平移 · 拖圆点旋转
            </div>
          </div>
          <button
            type="button"
            aria-label="旋转图片填充"
            onPointerDown={startDrag({ kind: 'rotate' })}
            style={handleStyle({
              left: (w / 2) * z,
              top: -ROTATE_OFFSET * z,
              cursor: 'alias',
            })}
          />
        </div>
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(FillImageHandlesOverlay);
