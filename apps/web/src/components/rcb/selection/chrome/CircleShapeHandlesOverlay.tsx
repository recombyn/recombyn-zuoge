import type { SceneNode, SceneNodeInput } from '@/components/rcb/sceneNode';
/**
 * Circle / ellipse knobs: 内半径, 开始位置 (display), 弧度 / 周弧度.
 */
import { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { previewSvgNodeEllipseParams } from '@/components/rcb/scene/paint/sceneToSvg';
import { useRcbCamera } from '@/components/rcb/camera/context';
import {
  clampEllipseArcPercent,
  clampEllipseInnerRatio,
  advanceEllipseArcAlong,
  ellipseArcAlongRadFromPercent,
  ellipseArcEndAngles,
  ellipseArcPercentFromAlongRad,
  ellipseArcPercentFromAttrs,
  ellipseInnerRatioFromAttrs,
  ellipseStartDegFromAttrs,
  snapEllipseInnerRatio,
} from '@/components/rcb/scene/document/sceneShapes';
import { patchDocumentNode } from '@/store/modules/editor';
import {
  getShapeHost,
  getSharedNodeEls,
  notifyShapeHostGeometry,
} from '@/components/rcb/shapes/shapeHostRegistry';
import type { SceneBox } from '../alignGuides';
import {
  CHROME_HANDLE_VIS_PX,
  CHROME_RADIUS_HIT_PX,
  CHROME_STROKE_PX,
  chromeHandleHitRadiusScene,
  chromeHitScaleForBox,
  setOverlayHandleSeats,
  WorldSvgFrame,
  WorldScreenBadge,
} from '../SelectionChrome';

const INNER_DRAG_DISTANCE_SQUARED = 64;
const INNER_HANDLE_HIT_PX = 14;
const KNOB_VIS_PX = CHROME_HANDLE_VIS_PX;
const KNOB_STROKE_PX = CHROME_STROKE_PX;

function liveNodeEl(nodeId: string): Element | null {
  return (
    (getSharedNodeEls()?.get(nodeId) as Element | undefined) ||
    (getShapeHost(nodeId)?.el as Element | null | undefined) ||
    null
  );
}

function scenePointToLocal(
  sceneX: number,
  sceneY: number,
  box: SceneBox,
  angleDeg: number
): { x: number; y: number } {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const dx = sceneX - cx;
  const dy = sceneY - cy;
  if (Math.abs(angleDeg) < 0.001) {
    return { x: dx + box.width / 2, y: dy + box.height / 2 };
  }
  const rad = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: dx * cos - dy * sin + box.width / 2,
    y: dx * sin + dy * cos + box.height / 2,
  };
}

function localPointToScene(
  lx: number,
  ly: number,
  box: SceneBox,
  angleDeg: number
): { x: number; y: number } {
  const cx = box.width / 2;
  const cy = box.height / 2;
  const dx = lx - cx;
  const dy = ly - cy;
  if (Math.abs(angleDeg) < 0.001) {
    return { x: box.left + lx, y: box.top + ly };
  }
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: box.left + cx + dx * cos - dy * sin,
    y: box.top + cy + dx * sin + dy * cos,
  };
}

function commitEllipseParams(opts: {
  dispatch: (a: unknown) => void;
  nodeId: string;
  innerRatio: number;
  arcPercent: number;
  startDeg: number;
  skipHistory?: boolean;
}) {
  opts.dispatch(
    patchDocumentNode({
      nodeId: opts.nodeId,
      skipHistory: Boolean(opts.skipHistory),
      patch: {
        attrs: {
          ellipseInnerRatio: snapEllipseInnerRatio(opts.innerRatio),
          ellipseArcPercent: clampEllipseArcPercent(opts.arcPercent),
          ellipseStartDeg: opts.startDeg,
        },
      },
    })
  );
}

type DragState =
  | {
      mode: 'inner';
      startRatio: number;
      current: number;
      startX: number;
      startY: number;
      moved: boolean;
    }
  | {
      mode: 'arc';
      current: number;
      /** Preserve an existing partial arc's direction; complete circles open clockwise. */
      sweepSign: 1 | -1;
      /** Remaining sweep radians in (0, 2π]; capped at a single full turn. */
      alongRad: number;
      lastPointerAngle: number;
      startX: number;
      startY: number;
      moved: boolean;
    };

function CircleShapeHandlesOverlay({
  box,
  angle,
  nodeId,
  node,
  toScene,
  stageEl: _stageEl,
  interactive = true,
}: {
  box: SceneBox;
  angle: number;
  nodeId: string;
  node: SceneNodeInput;
  toScene: (clientX: number, clientY: number) => { x: number; y: number };
  stageEl: HTMLElement | null;
  interactive?: boolean;
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const camera = useRcbCamera();
  const z = Math.max(0.05, camera.zoom || 1);
  const k = 1 / z;

  const [activeKey, setActiveKey] = useState<'inner' | 'arc' | null>(null);
  const [hoverStart, setHoverStart] = useState(false);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [liveInner, setLiveInner] = useState<number | null>(null);
  const [liveArc, setLiveArc] = useState<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const seatOwnerId = `circle:${nodeId}`;

  useEffect(
    () => () => {
      setOverlayHandleSeats(seatOwnerId, null);
    },
    [seatOwnerId]
  );

  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const outerR = Math.min(rx, ry);

  const baseInner = ellipseInnerRatioFromAttrs(node?.attrs);
  const baseArc = ellipseArcPercentFromAttrs(node?.attrs);
  const startDeg = ellipseStartDegFromAttrs(node?.attrs);
  const innerRatio = liveInner ?? baseInner;
  const arcPercent = liveArc ?? baseArc;
  const isFull = Math.abs(arcPercent) >= 99.95;

  // Visual seats belong to the actual geometry edge. Hit slop is handled
  // separately by chromeHandleHitRadiusScene below; it must not move the
  // painted controls inward from the outer/inner circle.
  const arcSeatR = outerR;
  const { a0, a1 } = ellipseArcEndAngles(arcPercent, startDeg);
  const seatOnRim = (ang: number, r: number) => ({
    x: cx + Math.cos(ang) * (rx / outerR) * r,
    y: cy + Math.sin(ang) * (ry / outerR) * r,
  });
  // Inner radius is anchored opposite the fixed opening start, never at the
  // changing arc midpoint. The knob remains on the same inner-ring edge while
  // the user changes the opening sweep.
  const innerSeatR =
    innerRatio > 1e-4 ? Math.max(2 * k, outerR * innerRatio) : 0;
  let innerLocal = { x: cx, y: cy };
  if (innerRatio > 1e-4) {
    innerLocal = seatOnRim(a0 + Math.PI, innerSeatR);
  }
  // Full: one 周弧度 knob where ends coincide (at 开始位置).
  // Partial: fixed 开始位置 at a0 + movable 弧度 at a1.
  const startLocal = seatOnRim(a0, arcSeatR);
  const arcLocal = seatOnRim(isFull ? a0 : a1, arcSeatR);

  const innerPos = localPointToScene(innerLocal.x, innerLocal.y, box, angle);
  const startPos = localPointToScene(startLocal.x, startLocal.y, box, angle);
  const arcPos = localPointToScene(arcLocal.x, arcLocal.y, box, angle);

  const preview = (opts: { inner?: number; arc?: number }) => {
    const hostEl = liveNodeEl(nodeId);
    if (!hostEl) return;
    const map = getSharedNodeEls() || new Map<string, any>([[nodeId, hostEl]]);
    if (!map.has(nodeId)) map.set(nodeId, hostEl);
    if (
      previewSvgNodeEllipseParams(map, nodeId, {
        width: w,
        height: h,
        innerRatio: opts.inner ?? innerRatio,
        arcPercent: opts.arc ?? arcPercent,
        startDeg,
      })
    ) {
      notifyShapeHostGeometry(nodeId);
    }
  };

  useEffect(() => {
    if (!interactive) return undefined;

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      // Arc follows the pointer immediately; inner keeps a tiny slop before drag.
      if (d.mode === 'inner') {
        const distSq = (e.clientX - d.startX) ** 2 + (e.clientY - d.startY) ** 2;
        if (!d.moved && distSq <= INNER_DRAG_DISTANCE_SQUARED) return;
      }
      d.moved = true;

      const sc = toScene(e.clientX, e.clientY);
      const local = scenePointToLocal(sc.x, sc.y, box, angle);

      if (d.mode === 'inner') {
        const dist = Math.hypot(local.x - cx, local.y - cy);
        const next = snapEllipseInnerRatio(
          clampEllipseInnerRatio(dist / Math.max(1e-3, outerR), d.startRatio),
          { sceneDist: dist, zoom: z }
        );
        d.current = next;
        setDragValue(Math.round(next * 100));
        setLiveInner(next);
        preview({ inner: next });
        return;
      }

      // Arc uses angle movement, not an absolute angle: passing the fixed start
      // ray clamps at a full turn instead of re-opening on the opposite side.
      const pointerAngle = Math.atan2(local.y - cy, local.x - cx);
      d.alongRad = advanceEllipseArcAlong(
        d.alongRad,
        pointerAngle - d.lastPointerAngle,
        d.sweepSign
      );
      d.lastPointerAngle = pointerAngle;
      const next = ellipseArcPercentFromAlongRad(d.alongRad, d.sweepSign);
      d.current = next;
      setDragValue(Math.round(next * 10) / 10);
      setLiveArc(next);
      preview({ arc: next });
    };

    const onUp = () => {
      const d = dragRef.current;
      if (!d) return;
      const soft = !d.moved;
      dragRef.current = null;
      setActiveKey(null);
      setDragValue(null);
      setLiveInner(null);
      setLiveArc(null);

      if (soft) {
        preview({ inner: baseInner, arc: baseArc });
        return;
      }

      commitEllipseParams({
        dispatch,
        nodeId,
        innerRatio: d.mode === 'inner' ? d.current : baseInner,
        arcPercent: d.mode === 'arc' ? d.current : baseArc,
        startDeg,
        skipHistory: false,
      });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !dragRef.current) return;
      dragRef.current = null;
      setActiveKey(null);
      setDragValue(null);
      setLiveInner(null);
      setLiveArc(null);
      preview({ inner: baseInner, arc: baseArc });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [
    interactive,
    box,
    angle,
    toScene,
    cx,
    cy,
    outerR,
    z,
    baseInner,
    baseArc,
    startDeg,
    dispatch,
    nodeId,
    w,
    h,
  ]);

  const visualSize = KNOB_VIS_PX * k;
  const stroke = KNOB_STROKE_PX * k;
  const halfVis = visualSize / 2;
  const left = box.left;
  const top = box.top;

  const innerLabel = t('editor.imageToolbar.ellipseInnerRadius', {
    defaultValue: '内半径',
  });
  const startLabel = t('editor.imageToolbar.ellipseStartPosition', {
    defaultValue: '开始位置',
  });
  const arcLabel = isFull
    ? t('editor.imageToolbar.ellipseFullArc', { defaultValue: '周弧度' })
    : t('editor.imageToolbar.arcPercent', { defaultValue: '弧度' });
  const startDegLabel = Math.round(startDeg * 10) / 10;

  let badgePos: { x: number; y: number } | null = null;
  let badgeText = '';
  if (activeKey === 'inner' && dragValue != null) {
    badgePos = innerPos;
    badgeText = `${innerLabel} ${dragValue}%`;
  } else if (activeKey === 'arc' && dragValue != null) {
    badgePos = arcPos;
    badgeText = `${arcLabel} ${dragValue}%`;
  } else if (hoverStart && !isFull && !activeKey) {
    badgePos = startPos;
    badgeText = `${startLabel} ${startDegLabel}°`;
  }

  const beginInner = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      mode: 'inner',
      startRatio: baseInner,
      current: baseInner,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    setActiveKey('inner');
    setHoverStart(false);
    setDragValue(Math.round(baseInner * 100));
    setLiveInner(baseInner);
  };

  /** Double-click 内半径 → solid disk (restore after opening a hole). */
  const resetInnerSolid = (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = null;
    setActiveKey(null);
    setDragValue(null);
    setLiveInner(null);
    setLiveArc(null);
    commitEllipseParams({
      dispatch,
      nodeId,
      innerRatio: 0,
      arcPercent: baseArc,
      startDeg,
    });
    preview({ inner: 0 });
  };

  const beginArc = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const sc = toScene(e.clientX, e.clientY);
    const local = scenePointToLocal(sc.x, sc.y, box, angle);
    dragRef.current = {
      mode: 'arc',
      current: baseArc,
      sweepSign: Math.abs(baseArc) >= 99.95 ? 1 : baseArc < 0 ? -1 : 1,
      alongRad: ellipseArcAlongRadFromPercent(baseArc),
      lastPointerAngle: Math.atan2(local.y - cy, local.x - cx),
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    setActiveKey('arc');
    setHoverStart(false);
    setDragValue(Math.round(baseArc * 10) / 10);
    setLiveArc(baseArc);
  };

  /** Double-click 弧度 → full circle with the canonical clockwise opening direction. */
  const resetArcFull = (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const full = 100;
    dragRef.current = null;
    setActiveKey(null);
    setDragValue(null);
    setLiveInner(null);
    setLiveArc(null);
    commitEllipseParams({
      dispatch,
      nodeId,
      innerRatio: baseInner,
      arcPercent: full,
      startDeg,
    });
    preview({ arc: full });
  };

  type KnobSpec = {
    key: string;
    lx: number;
    ly: number;
    sceneX: number;
    sceneY: number;
    label: string;
    interactive: boolean;
    isActive: boolean;
    onDown?: (e: PointerEvent) => void;
    onDoubleClick?: (e: MouseEvent) => void;
    onEnter?: () => void;
    onLeave?: () => void;
  };

  const knobs: KnobSpec[] = [
    {
      key: 'inner',
      lx: innerLocal.x,
      ly: innerLocal.y,
      sceneX: innerPos.x,
      sceneY: innerPos.y,
      label: innerLabel,
      interactive: true,
      isActive: activeKey === 'inner',
      onDown: beginInner,
      onDoubleClick: resetInnerSolid,
    },
  ];

  if (isFull) {
    // Coincident ends → single 周弧度 control.
    knobs.push({
      key: 'arc',
      lx: arcLocal.x,
      ly: arcLocal.y,
      sceneX: arcPos.x,
      sceneY: arcPos.y,
      label: arcLabel,
      interactive: true,
      isActive: activeKey === 'arc',
      onDown: beginArc,
      onDoubleClick: resetArcFull,
    });
  } else {
    knobs.push(
      {
        key: 'start',
        lx: startLocal.x,
        ly: startLocal.y,
        sceneX: startPos.x,
        sceneY: startPos.y,
        label: `${startLabel} ${startDegLabel}°`,
        interactive: false,
        isActive: hoverStart,
        onEnter: () => setHoverStart(true),
        onLeave: () => setHoverStart(false),
      },
      {
        key: 'arc',
        lx: arcLocal.x,
        ly: arcLocal.y,
        sceneX: arcPos.x,
        sceneY: arcPos.y,
        label: arcLabel,
        interactive: true,
        isActive: activeKey === 'arc',
        onDown: beginArc,
        onDoubleClick: resetArcFull,
      }
    );
  }

  const hitHalf = chromeHandleHitRadiusScene(
    z,
    CHROME_RADIUS_HIT_PX,
    chromeHitScaleForBox(w, h, z)
  );

  if (interactive && knobs.length > 0) {
    setOverlayHandleSeats(
      seatOwnerId,
      knobs.map((knob) => ({
        pickKey: `circle-${knob.key}`,
        interactive: knob.interactive,
        start: knob.onDown ?? (() => {}),
        onDoubleClick: knob.onDoubleClick,
        onEnter: knob.onEnter,
        onLeave: knob.onLeave,
        sceneX: knob.sceneX,
        sceneY: knob.sceneY,
        half:
          knob.key === 'inner'
            ? chromeHandleHitRadiusScene(
                z,
                INNER_HANDLE_HIT_PX,
                chromeHitScaleForBox(w, h, z)
              )
            : hitHalf,
      }))
    );
  } else {
    setOverlayHandleSeats(seatOwnerId, null);
  }

  return (
    <WorldSvgFrame
      nodeId={nodeId}
      left={left}
      top={top}
      width={w}
      height={h}
      angle={angle}
      zClass="z-[28]"
      pointerEvents="none"
      sceneChildren={
        badgePos ? (
          <WorldScreenBadge
            text={badgeText}
            x={badgePos.x}
            y={badgePos.y}
            inv={k}
            anchor="right"
            clearance={halfVis + 2 * k}
          />
        ) : null
      }
    >
      {knobs.map((knob) => (
        <g
          key={knob.key}
          data-circle-handle={knob.key}
          transform={`translate(${knob.lx} ${knob.ly})`}
          style={{ pointerEvents: 'all' }}
        >
          <title>{knob.label}</title>
          <circle
            r={Math.max(0.01, halfVis - stroke / 2)}
            fill="#ffffff"
            stroke="#3388ff"
            strokeWidth={stroke}
            style={{ pointerEvents: 'all' }}
          />
          {knob.isActive ? (
            <circle
              r={Math.max(0.01, halfVis + stroke)}
              fill="none"
              stroke="rgba(51,136,255,0.35)"
              strokeWidth={2 * k}
              style={{ pointerEvents: 'none' }}
            />
          ) : null}
        </g>
      ))}
    </WorldSvgFrame>
  );
}

export default CircleShapeHandlesOverlay;
