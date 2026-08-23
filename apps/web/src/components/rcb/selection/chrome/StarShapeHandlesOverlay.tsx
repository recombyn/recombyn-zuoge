import type { SceneNode, SceneNodeInput } from '@/components/rcb/sceneNode';
/**
 * Star shape handles.
 * World-SVG knobs — same paint contract as SelectionChrome / CornerRadius.
 */
import { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { previewSvgNodeCornerRadii } from '@/components/rcb/scene/paint/sceneToSvg';
import { useRcbCamera } from '@/components/rcb/camera/context';
import {
  clampCornerRadii,
  cornerVertexCount,
  isRadiusLinked,
  radiiFromAttrs,
  serializeRadiusVertices,
  setLiveCornerRadiusPreview,
  type CornerRadii,
} from '@/components/rcb/scene/document/sceneRadii';
import {
  clampShapeSides,
  clampStarInnerRatio,
  shapeVertexPoints,
  sidesFromAttrs,
  starInnerRatioFromAttrs,
} from '@/components/rcb/scene/document/sceneShapes';
import { patchDocumentNode } from '@/store/modules/editor';
import {
  getShapeHost,
  getSharedNodeEls,
  notifyShapeHostGeometry,
} from '@/components/rcb/shapes/shapeHostRegistry';
import { strokeInnerClearanceScene } from '@/components/rcb/scene/document/sceneEffects';
import type { SceneBox } from '../alignGuides';
import {
  CHROME_HANDLE_VIS_PX,
  CHROME_RADIUS_HIT_PX,
  CHROME_STROKE_PX,
  chromeHandleHitRadiusScene,
  chromeHitScaleForBox,
  radiusHandleParkScreenPx,
  radiusParkSceneForBox,
  setOverlayHandleSeats,
  WorldSvgFrame,
  WorldScreenBadge,
} from '../SelectionChrome';

const DRAG_DISTANCE_SQUARED = 16;
const SIDES_DRAG_STEP_PX = 14;
const KNOB_VIS_PX = CHROME_HANDLE_VIS_PX;
const KNOB_STROKE_PX = CHROME_STROKE_PX;
const RADIUS_MIN_INSET_PX = radiusHandleParkScreenPx();

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

function uniformRadii(r: number): CornerRadii {
  const v = Math.max(0, Math.round(r));
  return { tl: v, tr: v, br: v, bl: v };
}

export function starHandleSites(
  width: number,
  height: number,
  sides: number,
  innerRatio: number
) {
  const pts = shapeVertexPoints('star', width, height, sides, innerRatio);
  if (pts.length < 3) return null;
  const cx = width / 2;
  const cy = height / 2;
  const top = pts[0];
  const inner = pts[1];
  const outer = pts[2];
  let ix = cx - top[0];
  let iy = cy - top[1];
  const len = Math.hypot(ix, iy) || 1;
  ix /= len;
  iy /= len;
  const outerDist = Math.hypot(top[0] - cx, top[1] - cy) || 1;
  return {
    pts,
    cx,
    cy,
    top: { x: top[0], y: top[1], ix, iy },
    // First valley is exactly on the inner-radius circle. The handle must
    // follow this boundary, not a fixed control-box coordinate.
    inner: { x: inner[0], y: inner[1] },
    // Point count belongs to the adjacent outer star corner.
    outer: { x: outer[0], y: outer[1] },
    outerDist,
  };
}

function commitUniformRadius(opts: {
  dispatch: (a: unknown) => void;
  nodeId: string;
  node: SceneNodeInput;
  radius: number;
}) {
  const w = Math.max(1, Number(opts.node.width) || 1);
  const h = Math.max(1, Number(opts.node.height) || 1);
  const clamped = clampCornerRadii(uniformRadii(opts.radius), w, h);
  const count = Math.max(1, cornerVertexCount(opts.node));
  const vertices = Array.from({ length: count }, () => Math.round(clamped.tl));
  opts.dispatch(
    patchDocumentNode({
      nodeId: opts.nodeId,
      patch: {
        attrs: {
          radiusTL: clamped.tl,
          radiusTR: clamped.tr,
          radiusBR: clamped.br,
          radiusBL: clamped.bl,
          radiusLinked: 'true',
          radiusVertices: serializeRadiusVertices(vertices),
          radius: Math.round(clamped.tl),
          cornerRadius: Math.round(clamped.tl),
        },
      },
    })
  );
}

type DragState =
  | {
      mode: 'radius';
      startR: number;
      site: { x: number; y: number; ix: number; iy: number };
      startX: number;
      startY: number;
      moved: boolean;
    }
  | {
      mode: 'inner';
      startRatio: number;
      outerDist: number;
      cx: number;
      cy: number;
      startX: number;
      startY: number;
      moved: boolean;
    }
  | {
      mode: 'sides';
      startSides: number;
      startX: number;
      startY: number;
      moved: boolean;
    };

function StarShapeHandlesOverlay({
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

  const [activeKey, setActiveKey] = useState<'radius' | 'inner' | 'sides' | null>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [liveSides, setLiveSides] = useState<number | null>(null);
  const [liveInner, setLiveInner] = useState<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const seatOwnerId = `star:${nodeId}`;

  useEffect(
    () => () => {
      setOverlayHandleSeats(seatOwnerId, null);
    },
    [seatOwnerId]
  );

  const w = Math.max(1, box.width);
  const h = Math.max(1, box.height);
  const maxR = Math.min(w, h) / 2;
  const baseSides = sidesFromAttrs(node?.attrs);
  const sides = liveSides ?? baseSides;
  const baseInner = starInnerRatioFromAttrs(node?.attrs);
  const innerRatio = liveInner ?? baseInner;
  const baseRadii = clampCornerRadii(radiiFromAttrs(node?.attrs), w, h);
  const linked = isRadiusLinked(node?.attrs);
  const baseR = Math.round(
    linked
      ? (baseRadii.tl + baseRadii.tr + baseRadii.br + baseRadii.bl) / 4
      : baseRadii.tl
  );
  const radius = dragValue != null && activeKey === 'radius' ? dragValue : baseR;

  const sites = starHandleSites(w, h, sides, innerRatio);
  // Seat tracks R along the tip→center bisector (same contract as rect R-dots).
  // A fixed park inset left the knob glued to the sharp tip while the rounded
  // silhouette pulled inward — looked like “controls stuck at the old place”.
  const parkScene = radiusParkSceneForBox(
    w,
    h,
    z,
    RADIUS_MIN_INSET_PX,
    strokeInnerClearanceScene(node)
  );
  const insetFor = (r: number) => {
    const maxAlong = Math.max(parkScene, maxR - 1);
    return Math.max(parkScene, Math.min(Math.max(0, Number(r) || 0), maxAlong));
  };

  let radiusLocal = { x: w / 2, y: insetFor(radius) };
  // Inner radius and point count both belong to explicit star vertices: the
  // right-top valley and the adjacent right outer corner, respectively.
  let innerLocal = { x: w * 0.58, y: h * 0.325 };
  let sidesLocal = { x: w - parkScene, y: h * 0.325 };
  if (sites) {
    radiusLocal = {
      x: sites.top.x + sites.top.ix * insetFor(radius),
      y: sites.top.y + sites.top.iy * insetFor(radius),
    };
    innerLocal = sites.inner;
    sidesLocal = sites.outer;
  }

  const radiusPos = localPointToScene(radiusLocal.x, radiusLocal.y, box, angle);
  const innerPos = localPointToScene(innerLocal.x, innerLocal.y, box, angle);
  const sidesPos = localPointToScene(sidesLocal.x, sidesLocal.y, box, angle);

  const preview = (opts: { r?: number; sides?: number; inner?: number }) => {
    const hostEl = liveNodeEl(nodeId);
    if (!hostEl) return;
    const map = getSharedNodeEls() || new Map<string, any>([[nodeId, hostEl]]);
    if (!map.has(nodeId)) map.set(nodeId, hostEl);
    const r = opts.r ?? radius;
    const nextSides = opts.sides ?? sides;
    const nextInner = opts.inner ?? innerRatio;
    const radii = uniformRadii(r);
    if (
      previewSvgNodeCornerRadii(map, nodeId, {
        width: w,
        height: h,
        shapeType: 'star',
        radii,
        sides: nextSides,
        attrs: {
          ...(node?.attrs || {}),
          radiusTL: radii.tl,
          radiusTR: radii.tr,
          radiusBR: radii.br,
          radiusBL: radii.bl,
          radiusLinked: 'true',
          sides: nextSides,
          starInnerRatio: nextInner,
        },
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
      const distSq = (e.clientX - d.startX) ** 2 + (e.clientY - d.startY) ** 2;
      if (!d.moved && distSq <= DRAG_DISTANCE_SQUARED) return;
      d.moved = true;

      if (d.mode === 'sides') {
        const delta = Math.round((d.startY - e.clientY) / SIDES_DRAG_STEP_PX);
        const next = clampShapeSides(d.startSides + delta, d.startSides);
        setDragValue(next);
        setLiveSides(next);
        preview({ sides: next });
        return;
      }

      if (d.mode === 'inner') {
        const sc = toScene(e.clientX, e.clientY);
        const local = scenePointToLocal(sc.x, sc.y, box, angle);
        const dist = Math.hypot(local.x - d.cx, local.y - d.cy);
        const next = clampStarInnerRatio(dist / Math.max(1e-3, d.outerDist), d.startRatio);
        setDragValue(Math.round(next * 100));
        setLiveInner(next);
        preview({ inner: next });
        return;
      }

      const sc = toScene(e.clientX, e.clientY);
      const local = scenePointToLocal(sc.x, sc.y, box, angle);
      const along = (local.x - d.site.x) * d.site.ix + (local.y - d.site.y) * d.site.iy;
      const rounded = Math.max(0, Math.min(maxR, Math.round(along)));
      setDragValue(rounded);
      setLiveCornerRadiusPreview({ nodeId, display: rounded });
      preview({ r: rounded });
    };

    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const soft = !d.moved;
      dragRef.current = null;
      setActiveKey(null);
      setDragValue(null);
      setLiveSides(null);
      setLiveInner(null);
      setLiveCornerRadiusPreview(null);

      if (soft) {
        preview({ r: baseR, sides: baseSides, inner: baseInner });
        return;
      }

      if (d.mode === 'sides') {
        const delta = Math.round((d.startY - e.clientY) / SIDES_DRAG_STEP_PX);
        const next = clampShapeSides(d.startSides + delta, d.startSides);
        dispatch(patchDocumentNode({ nodeId, patch: { attrs: { sides: next } } }));
        return;
      }

      if (d.mode === 'inner') {
        const sc = toScene(e.clientX, e.clientY);
        const local = scenePointToLocal(sc.x, sc.y, box, angle);
        const dist = Math.hypot(local.x - d.cx, local.y - d.cy);
        const next = clampStarInnerRatio(dist / Math.max(1e-3, d.outerDist), d.startRatio);
        dispatch(patchDocumentNode({ nodeId, patch: { attrs: { starInnerRatio: next } } }));
        return;
      }

      const sc = toScene(e.clientX, e.clientY);
      const local = scenePointToLocal(sc.x, sc.y, box, angle);
      const along = (local.x - d.site.x) * d.site.ix + (local.y - d.site.y) * d.site.iy;
      const rounded = Math.max(0, Math.min(maxR, Math.round(along)));
      commitUniformRadius({ dispatch, nodeId, node, radius: rounded });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !dragRef.current) return;
      dragRef.current = null;
      setActiveKey(null);
      setDragValue(null);
      setLiveSides(null);
      setLiveInner(null);
      setLiveCornerRadiusPreview(null);
      preview({ r: baseR, sides: baseSides, inner: baseInner });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
      setLiveCornerRadiusPreview(null);
    };
  }, [
    interactive,
    dispatch,
    nodeId,
    node,
    box,
    angle,
    toScene,
    baseR,
    baseSides,
    baseInner,
    sides,
    innerRatio,
    radius,
    maxR,
  ]);

  const visualSize = KNOB_VIS_PX * k;
  const stroke = KNOB_STROKE_PX * k;
  const halfVis = visualSize / 2;
  const left = box.left;
  const top = box.top;

  const radiusLabel = t('editor.imageToolbar.cornerRadius');
  const innerLabel = t('editor.imageToolbar.innerRadius', { defaultValue: '内角半径' });
  const sidesLabel = t('editor.imageToolbar.vertexCount', { defaultValue: '顶点' });

  let badgePos: { x: number; y: number } | null = null;
  let badgeText = '';
  if (activeKey && dragValue != null) {
    if (activeKey === 'radius') {
      badgePos = radiusPos;
      badgeText = `${radiusLabel} ${dragValue}`;
    } else if (activeKey === 'inner') {
      badgePos = innerPos;
      badgeText = `${innerLabel} ${dragValue}%`;
    } else {
      badgePos = sidesPos;
      badgeText = `${sidesLabel} ${dragValue}`;
    }
  }

  type KnobSpec = {
    key: 'radius' | 'inner' | 'sides';
    lx: number;
    ly: number;
    sceneX: number;
    sceneY: number;
    label: string;
    onDown: (e: PointerEvent) => void;
  };

  const knobs: KnobSpec[] = sites
    ? [
        {
          key: 'radius',
          lx: radiusLocal.x,
          ly: radiusLocal.y,
          sceneX: radiusPos.x,
          sceneY: radiusPos.y,
          label: radiusLabel,
          onDown: (e) => {
            if (e.button !== 0 || !sites) return;
            e.preventDefault();
            e.stopPropagation();
            dragRef.current = {
              mode: 'radius',
              startR: baseR,
              site: sites.top,
              startX: e.clientX,
              startY: e.clientY,
              moved: false,
            };
            setActiveKey('radius');
            setDragValue(baseR);
          },
        },
        {
          key: 'inner',
          lx: innerLocal.x,
          ly: innerLocal.y,
          sceneX: innerPos.x,
          sceneY: innerPos.y,
          label: innerLabel,
          onDown: (e) => {
            if (e.button !== 0 || !sites) return;
            e.preventDefault();
            e.stopPropagation();
            dragRef.current = {
              mode: 'inner',
              startRatio: baseInner,
              outerDist: sites.outerDist,
              cx: sites.cx,
              cy: sites.cy,
              startX: e.clientX,
              startY: e.clientY,
              moved: false,
            };
            setActiveKey('inner');
            setDragValue(Math.round(baseInner * 100));
            setLiveInner(baseInner);
          },
        },
        {
          key: 'sides',
          lx: sidesLocal.x,
          ly: sidesLocal.y,
          sceneX: sidesPos.x,
          sceneY: sidesPos.y,
          label: sidesLabel,
          onDown: (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            dragRef.current = {
              mode: 'sides',
              startSides: baseSides,
              startX: e.clientX,
              startY: e.clientY,
              moved: false,
            };
            setActiveKey('sides');
            setDragValue(baseSides);
            setLiveSides(baseSides);
          },
        },
      ]
    : [];

  const hitHalf = chromeHandleHitRadiusScene(
    z,
    CHROME_RADIUS_HIT_PX,
    chromeHitScaleForBox(w, h, z)
  );

  if (Boolean(sites) && interactive && knobs.length > 0) {
    setOverlayHandleSeats(
      seatOwnerId,
      knobs.map((knob) => ({
        pickKey: `star-${knob.key}`,
        start: knob.onDown,
        sceneX: knob.sceneX,
        sceneY: knob.sceneY,
        half: hitHalf,
      }))
    );
  } else {
    setOverlayHandleSeats(seatOwnerId, null);
  }

  if (!sites) return null;

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
      {knobs.map((knob) => {
        const isActive = activeKey === knob.key;
        return (
          <g
            key={knob.key}
            data-star-handle={knob.key}
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
            {isActive ? (
              <circle
                r={Math.max(0.01, halfVis + stroke)}
                fill="none"
                stroke="rgba(51,136,255,0.35)"
                strokeWidth={2 * k}
                style={{ pointerEvents: 'none' }}
              />
            ) : null}
          </g>
        );
      })}
    </WorldSvgFrame>
  );
}

export default StarShapeHandlesOverlay;
