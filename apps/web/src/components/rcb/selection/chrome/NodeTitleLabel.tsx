/**
 * Frame / image / video title row above the control box.
 * HTML under camera scale (same contract as SelectionToolbarShell) — not world SVG.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  memo,
} from 'react';
import { LuAudioLines, LuImagePlus } from 'react-icons/lu';
import { RiClapperboardFill, RiVideoAiLine } from 'react-icons/ri';
import {
  RcbOverlayPortal,
  useRcbCamera,
  useRcbDevicePixelRatio,
  rcbCameraCssZoom,
  rcbSceneToScreen,
} from '@/components/rcb';
import { subscribeShapeHost } from '@/components/rcb/shapes/shapeHostRegistry';
import {
  NODE_TITLE_LABEL_GAP_PX,
  NODE_TITLE_LABEL_LINE_PX,
} from './SelectionToolbarShell';
import { liveShapeGeomBox } from '../HostPathChrome';
import { cn } from '@/utils/classnames';

type NodeTitleLabelBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type NodeTitleIcon =
  | 'frame'
  | 'image'
  | 'image-generator'
  | 'video'
  | 'video-generator'
  | 'lottie'
  | 'lottie-generator'
  | 'audio';

type Props = {
  /** Scene-space AABB of the node / frame. */
  box: NodeTitleLabelBox;
  name: string;
  sizeWidth: number;
  sizeHeight: number;
  /** Hit-test marker: `data-frame-label` | `data-image-label`. */
  dataAttr: 'frame-label' | 'image-label';
  icon?: NodeTitleIcon;
  dataProps?: Record<string, string>;
  /** Degrees; title follows the rotated top edge. */
  angle?: number;
  hidden?: boolean;
  onSelect?: () => void;
  onRename?: (name: string, options?: { skipHistory?: boolean }) => void;
  onMove?: (x: number, y: number, opts?: { skipGrid?: boolean }) => void;
  onMoveStart?: () => void;
  onMoveEnd?: () => void;
  originX?: number;
  originY?: number;
  renameAriaLabel?: string;
  /**
   * Prefer live host lattice (same as blue control box). When set, overrides
   * `box` left/top/size from Redux so the title does not drift after sticky snap.
   */
  nodeId?: string;
};

const MUTED = 'var(--muted)';
/** Idle + edit font (screen px; parent counter-scales under camera zoom). */
const TITLE_FONT_PX = 11;
const TITLE_ICON_PX = 12;

/**
 * Scene-space title layout: used by toolbar clearance math / tests.
 * Paint is HTML (`scale(1/zoom)`); these numbers stay `screenPx / zoom`.
 */
export function nodeTitleLabelWorldPlacement(
  box: NodeTitleLabelBox,
  zoom: number,
  opts?: { sizeText?: string }
): {
  inv: number;
  gapScene: number;
  lineScene: number;
  fontSize: number;
  iconSize: number;
  labelBottomScene: number;
  labelTopScene: number;
  textY: number;
  iconX: number;
  iconY: number;
  nameX: number;
  sizeX: number;
  /** Name column width before the size text (overflow clip). */
  nameMaxWidth: number;
  sizeReserve: number;
  hitLeft: number;
  hitTop: number;
  hitWidth: number;
  hitHeight: number;
} {
  const z = Math.max(0.05, zoom || 1);
  const inv = 1 / z;
  // Exactly NODE_TITLE_LABEL_GAP_PX screen px above the control-box top.
  const gapScene = NODE_TITLE_LABEL_GAP_PX * inv;
  const lineScene = NODE_TITLE_LABEL_LINE_PX * inv;
  const fontSize = TITLE_FONT_PX * inv;
  const iconSize = TITLE_ICON_PX * inv;
  const labelBottomScene = box.top - gapScene;
  const labelTopScene = labelBottomScene - lineScene;
  const textY = labelTopScene + lineScene * 0.5;
  const gapIcon = 4 * inv;
  const gapNameSize = 8 * inv;
  const sizeText = opts?.sizeText ?? '000 × 000';
  const sizeReserve = Math.max(fontSize * 3, sizeText.length * fontSize * 0.62);
  const nameX = box.left + iconSize + gapIcon;
  const sizeX = box.left + Math.max(1, box.width);
  const nameMaxWidth = Math.max(0, sizeX - gapNameSize - sizeReserve - nameX);
  return {
    inv,
    gapScene,
    lineScene,
    fontSize,
    iconSize,
    labelBottomScene,
    labelTopScene,
    textY,
    iconX: box.left,
    iconY: textY - iconSize * 0.5,
    nameX,
    sizeX,
    nameMaxWidth,
    sizeReserve,
    hitLeft: box.left,
    hitTop: labelTopScene,
    hitWidth: Math.max(1, box.width),
    hitHeight: lineScene,
  };
}

/**
 * HTML title under camera `scale(zoom)` — keep CSS offsets small.
 * Never place children at `±(boxSize * zoom)` then `scale(1/zoom)`: at 10000%
 * that creates tens of thousands of CSS px and the compositor drifts the label.
 *
 * Layers: scene rotate about plate center → scene mid to top-left →
 * `scale(1/zoom)` label with only screen-px gap above the edge.
 * Label `left: 0` is the plate’s left edge (Figma-style left align).
 */
export function nodeTitleHtmlAnchor(
  box: NodeTitleLabelBox,
  zoom: number,
  angle = 0
): {
  inv: number;
  outerLeft: number;
  outerTop: number;
  rotateDeg: number;
  midLeft: number;
  midTop: number;
  titleTopPx: number;
  maxWidthPx: number;
} {
  const z = Math.max(0.05, zoom || 1);
  const inv = 1 / z;
  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  return {
    inv,
    outerLeft: box.left + w / 2,
    outerTop: box.top + h / 2,
    rotateDeg: Math.abs(angle) > 0.001 ? angle : 0,
    midLeft: -w / 2,
    midTop: -h / 2,
    titleTopPx: -NODE_TITLE_LABEL_GAP_PX,
    maxWidthPx: w / inv,
  };
}

/** Stage layout px from plate top → title bottom. */
export function nodeTitleScreenGapPx(
  place: { labelBottomScene: number },
  boxTop: number,
  cameraZoom: number,
  viewportScale = 1
): number {
  const z = Math.max(0.05, cameraZoom || 1);
  const sx = viewportScale > 0 ? viewportScale : 1;
  return (boxTop - place.labelBottomScene) * z * sx;
}

/** Same glyphs as context-menu Generators (LuImagePlus / RiVideoAiLine / RiClapperboardFill). */
function TitleIcon({ kind }: { kind: NodeTitleIcon }): ReactNode {
  const iconStyle = { color: MUTED } as const;
  if (kind === 'audio') {
    return (
      <LuAudioLines
        size={TITLE_ICON_PX}
        strokeWidth={2}
        className="shrink-0"
        style={iconStyle}
        aria-hidden
      />
    );
  }
  if (kind === 'image-generator') {
    return (
      <LuImagePlus
        size={TITLE_ICON_PX}
        strokeWidth={2}
        className="shrink-0"
        style={iconStyle}
        aria-hidden
      />
    );
  }
  if (kind === 'video-generator') {
    return (
      <RiVideoAiLine
        size={TITLE_ICON_PX}
        className="shrink-0"
        style={{ ...iconStyle, opacity: 0.72 }}
        aria-hidden
      />
    );
  }
  if (kind === 'lottie-generator') {
    return (
      <RiClapperboardFill
        size={TITLE_ICON_PX}
        className="shrink-0"
        style={iconStyle}
        aria-hidden
      />
    );
  }
  const common = {
    fill: 'none' as const,
    stroke: MUTED,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  let path: ReactNode = null;
  if (kind === 'frame') {
    path = (
      <>
        <rect x={3} y={3} width={18} height={18} rx={2} {...common} />
        <path d="M3 9h18" {...common} />
        <path d="M9 21V9" {...common} />
      </>
    );
  } else if (kind === 'video') {
    path = (
      <>
        <rect x={2} y={5} width={20} height={14} rx={2} {...common} />
        <path d="M10 9l5 3-5 3z" {...common} fill={MUTED} />
      </>
    );
  } else {
    path = (
      <>
        <rect x={3} y={3} width={18} height={18} rx={2} {...common} />
        <circle cx={9} cy={9} r={2} {...common} />
        <path d="M21 15l-5-5L5 21" {...common} />
      </>
    );
  }
  return (
    <svg
      width={TITLE_ICON_PX}
      height={TITLE_ICON_PX}
      viewBox="0 0 24 24"
      className="shrink-0"
      aria-hidden
    >
      {path}
    </svg>
  );
}

/**
 * Title row above frames / images / generators — HTML chrome, screen-constant type.
 */
function NodeTitleLabel({
  box,
  name,
  sizeWidth,
  sizeHeight,
  dataAttr,
  icon,
  dataProps,
  angle = 0,
  hidden = false,
  onSelect,
  onRename,
  onMove,
  onMoveStart,
  onMoveEnd,
  originX = 0,
  originY = 0,
  renameAriaLabel,
  nodeId,
}: Props): ReactNode {
  const [editing, setEditing] = useState(false);
  const lastRenamedRef = useRef(name);
  const renameStartRef = useRef(name);
  const wroteDuringEditRef = useRef(false);
  const [labelDragging, setLabelDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wasEditingRef = useRef(false);
  const labelDragRef = useRef<{
    originX: number;
    originY: number;
    clientX0: number;
    clientY0: number;
    started: boolean;
  } | null>(null);
  const camera = useRcbCamera();
  const dpr = useRcbDevicePixelRatio();
  const z = rcbCameraCssZoom(camera);
  const inv = 1 / Math.max(0.05, z);
  const rotated = Math.abs(angle) > 0.001;
  const sizeText = `${Math.round(sizeWidth)} × ${Math.round(sizeHeight)}`;
  const [hostEpoch, setHostEpoch] = useState(0);
  useEffect(
    () => (nodeId ? subscribeShapeHost(nodeId, () => setHostEpoch((n) => n + 1)) : undefined),
    [nodeId]
  );
  // Same lattice as blue control box (host sticky snap) — Redux box alone drifts.
  const live = nodeId ? liveShapeGeomBox(nodeId) : null;
  const plate = live || box;

  useEffect(() => {
    if (!editing) {
      lastRenamedRef.current = name;
    }
  }, [name, editing]);

  const rename = (value: string, options?: { skipHistory?: boolean }) => {
    if (value === lastRenamedRef.current) return;
    lastRenamedRef.current = value;
    const skipHistory = Boolean(options?.skipHistory && wroteDuringEditRef.current);
    onRename?.(value, { skipHistory });
    if (options?.skipHistory) wroteDuringEditRef.current = true;
  };

  const beginRename = () => {
    if (!onRename) return;
    renameStartRef.current = name;
    wroteDuringEditRef.current = false;
    setEditing(true);
  };

  useLayoutEffect(() => {
    const wasEditing = wasEditingRef.current;
    wasEditingRef.current = editing;
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    if (window.document.activeElement !== el) el.focus({ preventScroll: true });
    // Select only on edit entry. Name writes remount the HTML host, but the
    // cursor must remain where the user was typing after that remount.
    if (!wasEditing) el.select();
  }, [editing]);

  useEffect(() => {
    if (!editing) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.('[data-rcb-title-edit="1"]')) return;
      window.requestAnimationFrame(() => {
        const el = inputRef.current;
        const value = (el?.value ?? '').trim() || name;
        setEditing(false);
        rename(value);
      });
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [editing, name, onRename]);

  const iconKind: NodeTitleIcon =
    icon || (dataAttr === 'frame-label' ? 'frame' : 'image');

  const commit = () => {
    const next = (inputRef.current?.value ?? '').trim() || name;
    setEditing(false);
    rename(next);
  };

  if (hidden || labelDragging) return null;

  const attrProps =
    dataAttr === 'frame-label'
      ? { 'data-frame-label': true as const }
      : { 'data-image-label': true as const };

  const onLabelPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    if (editing) return;
    onSelect?.();
    // Frame labels also support dragging. Start editing on the second press so
    // a drag listener cannot consume the browser's later double-click event.
    if (e.detail === 2) {
      e.preventDefault();
      beginRename();
      return;
    }
    if (!onMove || e.button !== 0) return;
    labelDragRef.current = {
      originX,
      originY,
      clientX0: e.clientX,
      clientY0: e.clientY,
      started: false,
    };
    const onMoveWin = (ev: PointerEvent) => {
      const drag = labelDragRef.current;
      if (!drag) return;
      const dx = (ev.clientX - drag.clientX0) / z;
      const dy = (ev.clientY - drag.clientY0) / z;
      if (!drag.started) {
        if (Math.hypot(dx, dy) < 3) return;
        drag.started = true;
        setLabelDragging(true);
        onMoveStart?.();
      }
      onMove(Math.round(drag.originX + dx), Math.round(drag.originY + dy), {
        skipGrid: ev.ctrlKey || ev.metaKey,
      });
    };
    const onUpWin = () => {
      const wasDragging = labelDragRef.current?.started;
      labelDragRef.current = null;
      setLabelDragging(false);
      window.removeEventListener('pointermove', onMoveWin);
      window.removeEventListener('pointerup', onUpWin);
      if (wasDragging) onMoveEnd?.();
    };
    window.addEventListener('pointermove', onMoveWin);
    window.addEventListener('pointerup', onUpWin);
  };

  // Scene rotate about plate center → mid to top-left (scene px) →
  // scale(1/zoom) label with only screen-px gap (no boxSize*zoom CSS).
  const center = rcbSceneToScreen(
    camera,
    plate.left + Math.max(1, plate.width) / 2,
    plate.top + Math.max(1, plate.height) / 2,
    dpr
  );
  // Same scene-to-screen anchor as SelectionToolbarShell. The title is plain
  // screen-space HTML, so its box dimensions must be zoomed before rotation.
  const html = {
    outerLeft: center.x,
    outerTop: center.y,
    rotateDeg: rotated ? angle : 0,
    midLeft: -(Math.max(1, plate.width) * z) / 2,
    midTop: -(Math.max(1, plate.height) * z) / 2,
    titleTopPx: -NODE_TITLE_LABEL_GAP_PX,
    maxWidthPx: Math.max(1, plate.width) * z,
  };

  return (
    <RcbOverlayPortal>
      <div
      data-rcb-node-title="1"
      className="pointer-events-none absolute z-[999990] overflow-visible"
      style={{
        left: html.outerLeft,
        top: html.outerTop,
        width: 0,
        height: 0,
        transform: html.rotateDeg ? `rotate(${html.rotateDeg}deg)` : undefined,
        transformOrigin: '0 0',
        pointerEvents: 'none',
      }}
    >
      <div
        className="pointer-events-none absolute overflow-visible"
        style={{
          left: html.midLeft,
          top: html.midTop,
          width: 0,
          height: 0,
        }}
      >
        <div
          className="pointer-events-none absolute overflow-visible"
          style={{
            left: 0,
            top: 0,
            width: 0,
            height: 0,
          transform: 'none',
          }}
        >
          <div
            {...attrProps}
            {...dataProps}
            role="button"
            tabIndex={0}
            aria-label={renameAriaLabel || name}
            className={cn(
              'pointer-events-auto absolute flex min-w-0 items-center justify-between gap-1 overflow-hidden font-medium select-none',
              onMove ? 'cursor-grab' : 'cursor-default'
            )}
            style={{
              left: 0,
              top: html.titleTopPx,
              maxWidth: html.maxWidthPx,
              width: html.maxWidthPx,
              height: NODE_TITLE_LABEL_LINE_PX,
              transform: 'translateY(-100%)',
              color: MUTED,
              fontSize: TITLE_FONT_PX,
              lineHeight: `${NODE_TITLE_LABEL_LINE_PX}px`,
            }}
            onPointerDown={onLabelPointerDown}
            onKeyDown={(e) => {
              if (editing) return;
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              e.stopPropagation();
              onSelect?.();
              if (e.key === 'Enter') beginRename();
            }}
            onDoubleClick={(e) => {
              if (!onRename) return;
              e.preventDefault();
              e.stopPropagation();
              onSelect?.();
              beginRename();
            }}
          >
            <TitleIcon kind={iconKind} />
            {editing && onRename ? (
              <input
                ref={inputRef}
                data-rcb-title-edit="1"
                data-text-inline-editor
                defaultValue={name}
                aria-label={renameAriaLabel || name}
                className="min-w-0 flex-1 appearance-none overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 font-medium leading-none text-[var(--ink)] shadow-none outline-none ring-0"
                style={{
                  fontSize: TITLE_FONT_PX,
                  lineHeight: `${NODE_TITLE_LABEL_LINE_PX}px`,
                  height: NODE_TITLE_LABEL_LINE_PX,
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const trimmed = e.currentTarget.value.trim();
                  if (trimmed) rename(trimmed, { skipHistory: true });
                }}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commit();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    rename(renameStartRef.current, { skipHistory: true });
                    setEditing(false);
                  }
                  e.stopPropagation();
                }}
              />
            ) : (
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {name}
              </span>
            )}
            <span className="shrink-0 opacity-80 tabular-nums">{sizeText}</span>
          </div>
        </div>
      </div>
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(NodeTitleLabel);
