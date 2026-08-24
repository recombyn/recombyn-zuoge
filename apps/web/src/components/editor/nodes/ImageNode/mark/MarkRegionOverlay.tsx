import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  memo,
} from 'react';
import { markRegionChrome } from './markRegionChrome';
import {
  RcbOverlayPortal,
  useRcbCamera,
  rcbSceneToScreen,
} from '@/components/rcb';

/** Mark rect in image-local coords (origin = image top-left). */
export type MarkRect = { x: number; y: number; w: number; h: number };

export type MarkRegion = MarkRect & {
  id: string;
  /** 1-based display index. */
  index: number;
  label?: string;
  kind?: 'image' | 'text' | 'manual' | string;
  selected?: boolean;
  committed?: boolean;
};

/** Min size to *commit* a region (scene px). Preview uses a softer floor. */
const MIN_MARK = 12;
/** Live rubber-band can show as soon as the drag leaves a 1×1 cell. */
const MIN_PREVIEW = 1;
/** Scene px — below this, pointer-up on a hit region counts as click-select. */
const CLICK_SLOP = 4;

function clampDragBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cw: number,
  ch: number
): MarkRect {
  const left = Math.max(0, Math.min(x0, x1));
  const top = Math.max(0, Math.min(y0, y1));
  const right = Math.min(cw, Math.max(x0, x1));
  const bottom = Math.min(ch, Math.max(y0, y1));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Rubber-band while dragging — keep tiny boxes so the preview never blinks out. */
export function previewDragBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cw: number,
  ch: number
): MarkRect | null {
  const box = clampDragBox(x0, y0, x1, y1, cw, ch);
  if (box.w < MIN_PREVIEW && box.h < MIN_PREVIEW) return null;
  return {
    x: box.x,
    y: box.y,
    w: Math.max(MIN_PREVIEW, box.w),
    h: Math.max(MIN_PREVIEW, box.h),
  };
}

/** Commit gate — reject clicks / sub-threshold drags. */
export function normalizeDragBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cw: number,
  ch: number
): MarkRect | null {
  const box = clampDragBox(x0, y0, x1, y1, cw, ch);
  if (box.w < MIN_MARK || box.h < MIN_MARK) return null;
  return box;
}

function pointInRect(px: number, py: number, r: MarkRect): boolean {
  return px >= r.x && py >= r.y && px <= r.x + r.w && py <= r.y + r.h;
}

type Props = {
  imageBox: { left: number; top: number; width: number; height: number };
  regions: MarkRegion[];
  draft: MarkRect | null;
  activeRegionId: string | null;
  /** Block drag-to-box while image is still processing. */
  blocked?: { message: string } | null;
  onDraftChange: (rect: MarkRect | null) => void;
  onCommitDraft: (rect: MarkRect) => void;
  onSelectRegion: (id: string, additive: boolean) => void;
  /** Soft click on empty image area — dismiss mark session (canvas blank uses selection). */
  onSoftBlankClick?: () => void;
};

/**
 * On-image mark overlay: crosshair cursor, drag-to-box, dashed region badges.
 */
function MarkRegionOverlay({
  imageBox,
  regions,
  draft,
  activeRegionId,
  blocked = null,
  onDraftChange,
  onCommitDraft,
  onSelectRegion,
  onSoftBlankClick,
}: Props): ReactNode {
  const interactionLocked = Boolean(blocked);
  const camera = useRcbCamera();
  const z = Math.max(0.05, camera.zoom || 1);
  const dragRef = useRef<{
    x0: number;
    y0: number;
    pointerId: number;
    hitId: string | null;
    additive: boolean;
    moved: boolean;
  } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const onDraftChangeRef = useRef(onDraftChange);
  const onCommitDraftRef = useRef(onCommitDraft);
  const onSelectRegionRef = useRef(onSelectRegion);
  const onSoftBlankClickRef = useRef(onSoftBlankClick);
  onDraftChangeRef.current = onDraftChange;
  onCommitDraftRef.current = onCommitDraft;
  onSelectRegionRef.current = onSelectRegion;
  onSoftBlankClickRef.current = onSoftBlankClick;

  const origin = rcbSceneToScreen(camera, imageBox.left, imageBox.top);
  const stageW = Math.max(1, imageBox.width * z);
  const stageH = Math.max(1, imageBox.height * z);
  const cw = imageBox.width;
  const ch = imageBox.height;

  const localFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const lx = (clientX - origin.x) / z;
      const ly = (clientY - origin.y) / z;
      return {
        x: Math.max(0, Math.min(cw, lx)),
        y: Math.max(0, Math.min(ch, ly)),
        inside: lx >= 0 && ly >= 0 && lx <= cw && ly <= ch,
      };
    },
    [origin.x, origin.y, z, cw, ch]
  );

  const finishActiveDrag = useCallback(
    (clientX: number, clientY: number, pointerId?: number) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (pointerId != null && drag.pointerId !== pointerId) return;
      dragRef.current = null;
      const p = localFromClient(clientX, clientY);
      if (drag.hitId) {
        onDraftChangeRef.current(null);
        onSelectRegionRef.current(drag.hitId, drag.additive);
        return;
      }
      const box = normalizeDragBox(drag.x0, drag.y0, p.x, p.y, cw, ch);
      onDraftChangeRef.current(null);
      if (box) {
        onCommitDraftRef.current(box);
        return;
      }
      if (!drag.moved) {
        onSoftBlankClickRef.current?.();
      }
    },
    [localFromClient, cw, ch]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const p = localFromClient(e.clientX, e.clientY);
      const dist = Math.hypot(p.x - drag.x0, p.y - drag.y0);
      if (dist >= CLICK_SLOP) drag.moved = true;
      // Started on an existing region → click-select only, never start a new box.
      if (drag.hitId) return;
      // Soft preview (1px+) while dragging; commit still uses MIN_MARK on pointer-up.
      onDraftChangeRef.current(previewDragBox(drag.x0, drag.y0, p.x, p.y, cw, ch));
    };
    const onUp = (e: PointerEvent | MouseEvent) => {
      const pointerId = 'pointerId' in e ? e.pointerId : undefined;
      finishActiveDrag(e.clientX, e.clientY, pointerId);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [localFromClient, cw, ch, finishActiveDrag]);

  const shellStyle: CSSProperties = {
    position: 'absolute',
    left: origin.x,
    top: origin.y,
    width: stageW,
    height: stageH,
    zIndex: 34,
    cursor: interactionLocked ? 'not-allowed' : 'crosshair',
    touchAction: 'none',
    overflow: interactionLocked ? 'hidden' : undefined,
  };

  const renderBox = (
    r: MarkRect,
    opts: {
      id?: string;
      index?: number;
      label?: string;
      selected?: boolean;
      draft?: boolean;
      badgeOnly?: boolean;
    }
  ) => {
    const selected = Boolean(opts.selected);
    const isDraft = Boolean(opts.draft);
    const hovered = opts.id != null && hoverId === opts.id;
    const badgeOnly = Boolean(opts.badgeOnly);
    const left = r.x * z;
    const top = r.y * z;
    const width = Math.max(1, r.w * z);
    const height = Math.max(1, r.h * z);
    const chrome = markRegionChrome({
      draft: isDraft,
      selected,
      hovered,
      badgeOnly,
    });

    return (
      <div
        key={opts.id || 'draft'}
        data-mark-region={opts.id || 'draft'}
        data-mark-draft={isDraft ? '1' : undefined}
        className="pointer-events-none absolute"
        style={{
          left,
          top,
          width,
          height,
          border: chrome.border,
          boxShadow: chrome.boxShadow,
          boxSizing: 'border-box',
        }}
      >
        {opts.index != null ? (
          <span
            className="pointer-events-none absolute right-0 top-1/2 flex h-5 min-w-5 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-md px-1 text-[11px] font-semibold text-white shadow-sm"
            style={{ background: chrome.badgeBg }}
          >
            {opts.index}
          </span>
        ) : null}
        {opts.label && !badgeOnly ? (
          <span
            className="pointer-events-none absolute -bottom-6 right-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium text-[#1e3a8a] shadow-sm"
            style={{ background: 'rgba(191,219,254,0.95)' }}
          >
            {opts.label}
          </span>
        ) : null}
        {isDraft ? (
          <span
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm"
            style={{ background: 'rgba(37,99,235,0.92)' }}
          >
            {Math.round(r.w)} × {Math.round(r.h)}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <RcbOverlayPortal>
      <div
        data-image-tool-panel
        data-mark-overlay
        className="pointer-events-auto absolute"
        style={shellStyle}
        onPointerUp={(e) => {
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation?.();
          finishActiveDrag(e.clientX, e.clientY, e.pointerId);
        }}
        onMouseUp={(e) => {
          e.stopPropagation();
          finishActiveDrag(e.clientX, e.clientY);
        }}
        onMouseDown={(e) => {
          if (interactionLocked) return;
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          const p = localFromClient(e.clientX, e.clientY);
          if (!p.inside) return;

          const hit = [...regions].reverse().find((r) => pointInRect(p.x, p.y, r));
          dragRef.current = {
            x0: p.x,
            y0: p.y,
            pointerId: -1,
            hitId: hit?.id ?? null,
            additive: e.shiftKey,
            moved: false,
          };
          onDraftChange(null);
        }}
        onPointerDown={(e) => {
          if (interactionLocked) return;
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation?.();
          const p = localFromClient(e.clientX, e.clientY);
          if (!p.inside) return;

          const hit = [...regions].reverse().find((r) => pointInRect(p.x, p.y, r));
          dragRef.current = {
            x0: p.x,
            y0: p.y,
            pointerId: e.pointerId,
            hitId: hit?.id ?? null,
            additive: e.shiftKey,
            moved: false,
          };
          onDraftChange(null);
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (dragRef.current) return;
          const p = localFromClient(e.clientX, e.clientY);
          if (!p.inside) {
            setHoverId(null);
            return;
          }
          const hit = [...regions].reverse().find((r) => pointInRect(p.x, p.y, r));
          setHoverId(hit?.id ?? null);
        }}
        onPointerLeave={() => {
          if (!dragRef.current) setHoverId(null);
        }}
      >
        {blocked ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20 p-2">
            <div className="w-full min-w-0 max-w-full rounded-full bg-white/95 px-2 py-1 shadow-sm">
              <span className="block truncate text-center text-[11px] font-medium leading-tight text-[var(--ink)]">
                {blocked.message}
              </span>
            </div>
          </div>
        ) : null}
        {regions.map((r) => {
          const isActive = r.id === activeRegionId;
          const badgeOnly = !isActive;
          return renderBox(r, {
            id: r.id,
            index: r.index,
            label: r.label,
            selected: isActive,
            badgeOnly,
          });
        })}
        {draft && draft.w >= 1 && draft.h >= 1
          ? renderBox(draft, { draft: true })
          : null}
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(MarkRegionOverlay);
