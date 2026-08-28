/**
 * Frame / image / video title row above the control box.
 * HTML under camera scale (same contract as SelectionToolbarShell) — not world SVG.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  type SVGProps,
  memo,
} from 'react';
import { LuAudioLines, LuImagePlus, LuType } from 'react-icons/lu';
import { RiVideoAiLine } from 'react-icons/ri';
import { LottieOutlineIcon } from '@/components/editor/nodes/LottieNode/LottieOutlineIcon';
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
  NODE_TITLE_LABEL_INSET_PX,
  NODE_TITLE_LABEL_LINE_PX,
} from './SelectionToolbarShell';
import { liveShapeGeomBox } from '../HostPathChrome';
import { shiftConstrainedMoveDelta } from '../selectionLogic';
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
  | 'audio'
  | 'text';

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
  onMove?: (
    x: number,
    y: number,
    opts?: { skipGrid?: boolean; axisLock?: 'h' | 'v' }
  ) => void;
  onMoveStart?: () => void;
  onMoveEnd?: () => void;
  originX?: number;
  originY?: number;
  renameAriaLabel?: string;
  /** Short badge after the name (e.g. mockup mode indicator). */
  titleSuffix?: string;
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

const ZERO_BOX: CSSProperties = {
  position: 'absolute',
  overflow: 'visible',
  pointerEvents: 'none',
  width: 0,
  height: 0,
};

const STROKE_ICON = {
  fill: 'none' as const,
  stroke: MUTED,
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/**
 * Scene-space title layout: used by toolbar clearance math / tests.
 * Paint is HTML (`scale(1/zoom)`); these numbers stay `screenPx / zoom`.
 */
export function nodeTitleLabelWorldPlacement(
  box: NodeTitleLabelBox,
  zoom: number,
  opts?: { sizeText?: string }
) {
  const z = Math.max(0.05, zoom || 1);
  const inv = 1 / z;
  const gapScene = NODE_TITLE_LABEL_GAP_PX * inv;
  const lineScene = NODE_TITLE_LABEL_LINE_PX * inv;
  const fontSize = TITLE_FONT_PX * inv;
  const iconSize = TITLE_ICON_PX * inv;
  const insetScene = NODE_TITLE_LABEL_INSET_PX * inv;
  const labelBottomScene = box.top - gapScene;
  const labelTopScene = labelBottomScene - lineScene;
  const textY = labelTopScene + lineScene * 0.5;
  const sizeText = opts?.sizeText ?? '000 × 000';
  const sizeReserve = Math.max(fontSize * 3, sizeText.length * fontSize * 0.62);
  const iconX = box.left + insetScene;
  const nameX = iconX + iconSize + 4 * inv;
  const sizeX = box.left + Math.max(1, box.width);
  return {
    inv,
    gapScene,
    lineScene,
    fontSize,
    iconSize,
    labelBottomScene,
    labelTopScene,
    textY,
    iconX,
    iconY: textY - iconSize * 0.5,
    nameX,
    sizeX,
    nameMaxWidth: Math.max(0, sizeX - 8 * inv - sizeReserve - nameX),
    sizeReserve,
    hitLeft: iconX,
    hitTop: labelTopScene,
    hitWidth: Math.max(1, box.width - insetScene),
    hitHeight: lineScene,
  };
}

/**
 * HTML title under camera `scale(zoom)` — keep CSS offsets small.
 * Never place children at `±(boxSize * zoom)` then `scale(1/zoom)`: at 10000%
 * that creates tens of thousands of CSS px and the compositor drifts the label.
 */
export function nodeTitleHtmlAnchor(
  box: NodeTitleLabelBox,
  zoom: number,
  angle = 0
) {
  const z = Math.max(0.05, zoom || 1);
  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  return {
    inv: 1 / z,
    outerLeft: box.left + w / 2,
    outerTop: box.top + h / 2,
    rotateDeg: Math.abs(angle) > 0.001 ? angle : 0,
    midLeft: -w / 2,
    midTop: -h / 2,
    titleTopPx: -NODE_TITLE_LABEL_GAP_PX,
    titleLeftPx: NODE_TITLE_LABEL_INSET_PX,
    maxWidthPx: Math.max(1, w * z - NODE_TITLE_LABEL_INSET_PX),
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

function LucideTitleIcon({
  Icon,
  opacity,
}: {
  Icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }>;
  opacity?: number;
}): ReactNode {
  return (
    <Icon
      size={TITLE_ICON_PX}
      strokeWidth={2}
      className="shrink-0"
      style={{ color: MUTED, opacity }}
      aria-hidden
    />
  );
}

function SvgTitleIcon({ children }: { children: ReactNode }): ReactNode {
  return (
    <svg
      width={TITLE_ICON_PX}
      height={TITLE_ICON_PX}
      viewBox="0 0 24 24"
      className="shrink-0"
      aria-hidden
    >
      {children}
    </svg>
  );
}

/** Same glyphs as context-menu Generators. */
function TitleIcon({ kind }: { kind: NodeTitleIcon }): ReactNode {
  switch (kind) {
    case 'audio':
      return <LucideTitleIcon Icon={LuAudioLines} />;
    case 'text':
      return <LucideTitleIcon Icon={LuType} />;
    case 'image-generator':
      return <LucideTitleIcon Icon={LuImagePlus} />;
    case 'video-generator':
      return <LucideTitleIcon Icon={RiVideoAiLine} opacity={0.72} />;
    case 'lottie':
    case 'lottie-generator':
      return (
        <LottieOutlineIcon
          size={TITLE_ICON_PX}
          strokeWidth={1.75}
          className="shrink-0"
          style={{ color: MUTED }}
        />
      );
    case 'frame':
      return (
        <SvgTitleIcon>
          <rect x={3} y={3} width={18} height={18} rx={2} {...STROKE_ICON} />
          <path d="M3 9h18" {...STROKE_ICON} />
          <path d="M9 21V9" {...STROKE_ICON} />
        </SvgTitleIcon>
      );
    case 'video':
      return (
        <SvgTitleIcon>
          <rect x={2} y={5} width={20} height={14} rx={2} {...STROKE_ICON} />
          <path d="M10 9l5 3-5 3z" {...STROKE_ICON} fill={MUTED} />
        </SvgTitleIcon>
      );
    default:
      return (
        <SvgTitleIcon>
          <rect x={3} y={3} width={18} height={18} rx={2} {...STROKE_ICON} />
          <circle cx={9} cy={9} r={2} {...STROKE_ICON} />
          <path d="M21 15l-5-5L5 21" {...STROKE_ICON} />
        </SvgTitleIcon>
      );
  }
}

function TitleNameField({
  editing,
  name,
  titleSuffix,
  renameAriaLabel,
  inputRef,
  onRenameLive,
  onCommit,
  onCancel,
}: {
  editing: boolean;
  name: string;
  titleSuffix?: string;
  renameAriaLabel?: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onRenameLive: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}): ReactNode {
  if (!editing) {
    return (
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
        {name}
        {titleSuffix ? <span className="ml-1 opacity-70">· {titleSuffix}</span> : null}
      </span>
    );
  }

  return (
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
        if (trimmed) onRenameLive(trimmed);
      }}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
        e.stopPropagation();
      }}
    />
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
  titleSuffix,
  nodeId,
}: Props): ReactNode {
  const [editing, setEditing] = useState(false);
  const [labelDragging, setLabelDragging] = useState(false);
  const lastRenamedRef = useRef(name);
  const renameStartRef = useRef(name);
  const wroteDuringEditRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wasEditingRef = useRef(false);
  const labelDragRef = useRef<{
    originX: number;
    originY: number;
    clientX0: number;
    clientY0: number;
    started: boolean;
    moveAxisLock?: 'h' | 'v';
  } | null>(null);

  const camera = useRcbCamera();
  const dpr = useRcbDevicePixelRatio();
  const z = rcbCameraCssZoom(camera);
  const sizeText = `${Math.round(sizeWidth)} × ${Math.round(sizeHeight)}`;

  // Subscribe so sticky host snaps re-render the title with the control box.
  const [, setHostEpoch] = useState(0);
  useEffect(
    () => (nodeId ? subscribeShapeHost(nodeId, () => setHostEpoch((n) => n + 1)) : undefined),
    [nodeId]
  );
  const plate = (nodeId && liveShapeGeomBox(nodeId)) || box;

  useEffect(() => {
    if (!editing) lastRenamedRef.current = name;
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

  const commit = () => {
    const next = (inputRef.current?.value ?? '').trim() || name;
    setEditing(false);
    rename(next);
  };

  const cancelRename = () => {
    rename(renameStartRef.current, { skipHistory: true });
    setEditing(false);
  };

  useLayoutEffect(() => {
    const wasEditing = wasEditingRef.current;
    wasEditingRef.current = editing;
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    if (window.document.activeElement !== el) el.focus({ preventScroll: true });
    // Select only on edit entry — remounts from live rename must keep the caret.
    if (!wasEditing) el.select();
  }, [editing]);

  useEffect(() => {
    if (!editing) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.('[data-rcb-title-edit="1"]')) return;
      window.requestAnimationFrame(() => {
        const value = (inputRef.current?.value ?? '').trim() || name;
        setEditing(false);
        rename(value);
      });
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [editing, name, onRename]);

  if (hidden || labelDragging) return null;

  const iconKind = icon ?? (dataAttr === 'frame-label' ? 'frame' : 'image');
  const hitAttr =
    dataAttr === 'frame-label'
      ? ({ 'data-frame-label': true } as const)
      : ({ 'data-image-label': true } as const);

  const onLabelPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    // Right-click opens the canvas context menu (window capture). Do not steal it.
    if (e.button === 2) return;
    e.stopPropagation();
    if (editing) return;
    onSelect?.();
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
      const { dx: cdx, dy: cdy } = shiftConstrainedMoveDelta(drag, dx, dy, ev.shiftKey);
      onMove(Math.round(drag.originX + cdx), Math.round(drag.originY + cdy), {
        skipGrid: ev.ctrlKey || ev.metaKey,
        axisLock: drag.moveAxisLock,
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

  const plateW = Math.max(1, plate.width);
  const plateH = Math.max(1, plate.height);
  const center = rcbSceneToScreen(
    camera,
    plate.left + plateW / 2,
    plate.top + plateH / 2,
    dpr
  );
  const rotateDeg = Math.abs(angle) > 0.001 ? angle : 0;
  const titleWidth = Math.max(1, plateW * z - NODE_TITLE_LABEL_INSET_PX);

  return (
    <RcbOverlayPortal>
      <div
        data-rcb-node-title="1"
        className="pointer-events-none absolute z-[999990] overflow-visible"
        style={{
          ...ZERO_BOX,
          left: center.x,
          top: center.y,
          transform: rotateDeg ? `rotate(${rotateDeg}deg)` : undefined,
          transformOrigin: '0 0',
        }}
      >
        <div
          className="pointer-events-none absolute overflow-visible"
          style={{
            ...ZERO_BOX,
            left: -(plateW * z) / 2,
            top: -(plateH * z) / 2,
          }}
        >
          <div
            {...hitAttr}
            {...dataProps}
            role="button"
            tabIndex={0}
            aria-label={renameAriaLabel || name}
            className={cn(
              'pointer-events-auto absolute flex min-w-0 items-center justify-between gap-1 overflow-hidden font-medium select-none',
              onMove ? 'cursor-grab' : 'cursor-default'
            )}
            style={{
              left: NODE_TITLE_LABEL_INSET_PX,
              top: -NODE_TITLE_LABEL_GAP_PX,
              width: titleWidth,
              maxWidth: titleWidth,
              height: NODE_TITLE_LABEL_LINE_PX,
              transform: 'translateY(-100%)',
              color: MUTED,
              fontSize: TITLE_FONT_PX,
              lineHeight: `${NODE_TITLE_LABEL_LINE_PX}px`,
            }}
            onPointerDown={onLabelPointerDown}
            onKeyDown={(e) => {
              if (editing || (e.key !== 'Enter' && e.key !== ' ')) return;
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
            <TitleNameField
              editing={editing && Boolean(onRename)}
              name={name}
              titleSuffix={titleSuffix}
              renameAriaLabel={renameAriaLabel}
              inputRef={inputRef}
              onRenameLive={(value) => rename(value, { skipHistory: true })}
              onCommit={commit}
              onCancel={cancelRename}
            />
            <span className="shrink-0 opacity-80 tabular-nums">{sizeText}</span>
          </div>
        </div>
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(NodeTitleLabel);
