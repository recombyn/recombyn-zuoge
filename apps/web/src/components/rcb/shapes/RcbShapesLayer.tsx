import { useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from 'react';
import { useSelector } from '@/store';
import { useRcbCamera, useRcbCameraMotion, useRcbViewportEl } from '../camera/context';
import { rcbViewportSceneBounds } from '../core/math';
import {
  RcbSpatialIndex,
  SCENE_SPATIAL_LARGE_THRESHOLD,
  boxesIntersect,
  buildIdRankMap,
  getSharedSceneSpatialRuntime,
  nodeSceneAabb,
  sortIdsByRank,
} from '../core/spatialIndex';
import {
  isImageProcessRunning,
  isNodeOverlayHidden,
  isNodeStructurallyHiddenInDocument,
} from '@/components/rcb/scene/document/nodeCapabilities';
import {
  stackZIndex
} from '@/components/rcb/scene/document/sceneDocument';
import { nodeLeftTop } from '@/components/rcb/scene/paint/sceneToSvg';
import type { SceneDocument, SceneNodeInput } from '@/components/rcb/sceneNode';
import {
  clearSceneCanvasIdlePaint,
  canIdlePaintOnCanvas,
  canvasIdleIsStrokeOnly,
  bumpSceneCanvasIdlePaint,
  requestIdleCanvasFullRepaint,
  setSceneCanvasIdlePaint,
} from '@/components/rcb/render/sceneRenderer';
import {
  getLiveCornerRadiusPreviewNodeId,
  subscribeLiveCornerRadiusPreview,
} from '@/components/rcb/scene/document/sceneRadii';
import { effectivePaintBox } from '@/components/rcb/core/transformPreview';
import {
  applySoaHostInkFlags,
  bulkInsertSoaFromDocument,
  bulkRemoveSoaByIds,
  bulkUpsertSoaQuadtree,
  getSharedSceneRenderBuffer,
  isSoaCanvasShapesEnabled,
  markAllSoaDirty,
  resolveSoaPaintBox,
  SOA_FLAG_FREE,
  syncSceneRenderBufferFromDocument,
  syncSceneRenderBufferIncremental,
  type SceneRenderBuffer,
} from '@/components/rcb/render/sceneRenderBuffer';
import {
  bindSoaBakeElementTiles,
  getSharedSoaBake,
  getSharedSoaBakeCache,
  patchSoaBakeDirty,
  resetSharedSoaBake,
  setSharedSoaBake,
  unbindSoaBakeElement,
} from '@/components/rcb/render/soaBakeLayer';
import {
  createRenderDemotionScheduler,
  type RenderDemotionScheduler,
} from '@/components/rcb/render/renderDemotionScheduler';
import { RCB_SOA_AI_FLUSH } from '@/components/editor/sceneEvents';
import { setFrameClipRevealOverflowIds } from '@/components/rcb/frames/frameContentClip';
import RcbShapeHost from './RcbShapeHost';

export { canvasIdleIsStrokeOnly, canIdlePaintOnCanvas };

function bindDemoteBakeTiles(buf: SceneRenderBuffer, ids: readonly string[]): void {
  const cache = getSharedSoaBakeCache();
  if (!cache) return;
  for (const id of ids) {
    const i = buf.indexById.get(id);
    if (i == null) continue;
    const { x, y, w, h } = resolveSoaPaintBox(buf, i);
    bindSoaBakeElementTiles(cache, id, {
      minX: Math.min(x, x + w),
      minY: Math.min(y, y + h),
      maxX: Math.max(x, x + w),
      maxY: Math.max(y, y + h),
    });
  }
}

function unbindPromoteBakeTiles(ids: readonly string[]): void {
  const cache = getSharedSoaBakeCache();
  if (!cache) return;
  for (const id of ids) unbindSoaBakeElement(cache, id);
}

function flushDemotionPaintWake(ids?: readonly string[]): void {
  const buf = getSharedSceneRenderBuffer();
  if (ids && ids.length > 0) {
    patchSharedSpatialFromSoaIds(buf, ids);
  } else {
    refreshSharedSpatialFromSoa(buf);
  }
  const bake = getSharedSoaBake();
  const cache = getSharedSoaBakeCache();
  if (bake?.valid && cache) patchSoaBakeDirty(buf, bake);
  bumpSceneCanvasIdlePaint();
}

function patchSharedSpatialFromSoaIds(
  buf: SceneRenderBuffer,
  ids: readonly string[]
): void {
  if (buf.count < SCENE_SPATIAL_LARGE_THRESHOLD) return;
  const runtime = getSharedSceneSpatialRuntime();
  if (!runtime) return;
  runtime.upsertIdsFromRenderBuffer(buf, ids, { pad: 32 });
}

function createShapesDemotionScheduler(
  forceFullSetRef: { current: ReadonlySet<string> },
  onHintsChanged: () => void
): RenderDemotionScheduler {
  return createRenderDemotionScheduler({
    demoteDelayMs: 300,
    onHintsChanged,
    sink: {
      promote(ids) {
        const buf = getSharedSceneRenderBuffer();
        if (buf.count === 0) return;
        const hosts = new Set(forceFullSetRef.current);
        for (const id of ids) hosts.add(id);
        applySoaHostInkFlags(buf, hosts, { onlyIds: ids });
        unbindPromoteBakeTiles(ids);
      },
      demote(ids) {
        const buf = getSharedSceneRenderBuffer();
        if (buf.count === 0) return;
        applySoaHostInkFlags(buf, forceFullSetRef.current, { onlyIds: ids });
        bulkUpsertSoaQuadtree(buf, ids);
        bindDemoteBakeTiles(buf, ids);
      },
      afterFlips(ids) {
        flushDemotionPaintWake(ids);
      },
    },
  });
}

/** After SoA sync, push shape AABBs into the shared spatial runtime (large N). */
function refreshSharedSpatialFromSoa(buf: SceneRenderBuffer) {
  if (buf.count < SCENE_SPATIAL_LARGE_THRESHOLD) return;
  const runtime = getSharedSceneSpatialRuntime();
  if (!runtime) return;
  runtime.upsertFromRenderBuffer(buf, { pad: 32 });
}

/**
 * Sync document → SoA buffer (+ host ink flags + spatial). Used by the shapes layer and
 * AI flush. Prefer calling once per AI transaction commit, not per tool_op.
 *
 * Membership changes (boolean delete+add, paste, undo) must full-rebuild: callers
 * like `setDocument` often leave `lastPatchedNodeIds` stale / omit deleted ids,
 * and incremental-with-removeMissing:false left ghost rects that still painted
 * but could not be selected.
 */
export function syncSoaBufferFromDocumentNow(
  document: SceneDocument,
  opts: {
    ids: readonly string[];
    lastPatchedNodeIds?: readonly string[];
    forceFullIds: ReadonlySet<string> | readonly string[];
    fullRebuild?: boolean;
  }
): boolean {
  if (!isSoaCanvasShapesEnabled()) return false;
  const buf = getSharedSceneRenderBuffer();
  const patchedList = (opts.lastPatchedNodeIds || []).filter(Boolean);
  const liveIds = opts.ids.map(String).filter((id) => id && id !== 'ROOT');
  const membershipChanged = soaBufferMembershipChanged(buf, liveIds);
  const canIncremental =
    !opts.fullRebuild &&
    !membershipChanged &&
    buf.count > 0 &&
    patchedList.length > 0 &&
    patchedList.length <= Math.max(32, Math.floor(liveIds.length * 0.2 || 1));
  if (canIncremental) {
    if (patchedList.length >= 8) {
      const toWrite: string[] = [];
      const toRemove: string[] = [];
      for (const id of patchedList) {
        if (!document.deltaSetLike?.[id]) toRemove.push(id);
        else toWrite.push(id);
      }
      if (toRemove.length) bulkRemoveSoaByIds(buf, toRemove);
      if (toWrite.length) bulkInsertSoaFromDocument(buf, document, toWrite);
      const keep = new Set(liveIds);
      const missing: string[] = [];
      for (let i = 0; i < buf.count; i += 1) {
        if (buf.flags[i] & SOA_FLAG_FREE) continue;
        const id = buf.ids[i];
        if (id && !keep.has(id)) missing.push(id);
      }
      if (missing.length) bulkRemoveSoaByIds(buf, missing);
    } else {
      syncSceneRenderBufferIncremental(buf, document, patchedList, {
        allIds: liveIds,
        removeMissing: true,
      });
    }
  } else {
    syncSceneRenderBufferFromDocument(buf, document);
    markAllSoaDirty(buf);
    resetSharedSoaBake();
    setSharedSoaBake(null);
  }
  applySoaHostInkFlags(buf, opts.forceFullIds);
  refreshSharedSpatialFromSoa(buf);
  return true;
}

/** HTML/SVG hosts only when canvas cannot own the pixels (effects / live HTML media). */
export function nodeNeedsDomShapeHost(
  node: SceneNodeInput | null | undefined,
  forceFull = false
): boolean {
  if (forceFull) return true;
  if (!node) return true;
  if (isImageProcessRunning(node)) return true;
  const key = String(node.key || '');
  // Static text → canvas ink; caret → TextInlineEditor overlay.
  // Static image → paintCanvasMediaInk; SoftGlow process still forceFull above.
  // Video idle → canvas poster; selected/playing video is forceFull (FO + HTML <video>).
  if (key === 'lottie' || key === 'audio' || key === 'group') return true;
  return !canIdlePaintOnCanvas(node);
}

/** True when SoA slot ids diverge from document ROOT children (add/remove). */
export function soaBufferMembershipChanged(
  buf: SceneRenderBuffer,
  liveIds: readonly string[]
): boolean {
  const keep = new Set(liveIds.map(String).filter(Boolean));
  let liveCount = 0;
  for (let i = 0; i < buf.count; i += 1) {
    if (buf.flags[i] & SOA_FLAG_FREE) continue;
    const id = buf.ids[i];
    if (!id || !keep.has(id)) return true;
    liveCount += 1;
  }
  return liveCount !== keep.size;
}

/**
 * Whether ink (DOM host or canvas) should drop artboard clip.
 * Processing SoftGlow stays clipped. Selected / editing nodes reveal past
 * clipContent so overflow matches unclipped selection chrome (editable).
 */
export function shouldRevealShapeOverflow(
  keepOrForceFull: boolean,
  node: SceneNodeInput | null | undefined
): boolean {
  if (!keepOrForceFull || isImageProcessRunning(node)) return false;
  return true;
}

type Props = {
  document: SceneDocument;
  reloadToken?: number | string;
  /** Bumps paint for nodes touched by the latest document patch. */
  documentPatchToken?: number;
  lastPatchedNodeIds?: string[];
  /** Hide this node's SVG paint (e.g. while inline text editor is open). */
  hiddenNodeId?: string | null;
  /** Never cull these (selection / inline editors) even if off-screen. */
  keepVisibleIds?: readonly string[];
  /** Must stay as full SVG hosts (SoftGlow / inline editors — selection stays on canvas ink). */
  forceFullIds?: readonly string[];
  /** Shared scene index from SvgCanvas — drives viewport visible set. */
  spatialIndex?: RcbSpatialIndex | null;
};

const EMPTY_KEEP: readonly string[] = [];
const EMPTY_FORCE_FULL: readonly string[] = [];
const EMPTY_FORCE_FULL_SET = new Set<string>();

/** Screen-px margin so shapes entering the view aren't blank for a frame. */
const CULL_PAD_SCREEN_PX = 96;

/** Above this count, use stepped zoom while the camera is moving. */
const EFFICIENT_ZOOM_SHAPE_THRESHOLD = 80;

/** Prefer index.search over O(N) AABB walk once the scene is this large. */
const INDEX_CULL_THRESHOLD = 64;

/** Cap on canvas ink ids after viewport cull. */
const MAX_CANVAS_INK_PAINT = 4096;

function screenAreaPx(node: SceneNodeInput, zoom: number): number {
  const w = Math.max(1, Number(node?.width) || 1);
  const h = Math.max(1, Number(node?.height) || 1);
  const z = Math.max(0.05, zoom || 1);
  return w * h * z * z;
}

function trimCanvasInkIds(opts: {
  document: SceneDocument;
  canvasIds: string[];
  zoom: number;
  maxCanvasInk: number;
}): string[] {
  const { document, canvasIds, zoom, maxCanvasInk } = opts;
  if (canvasIds.length <= maxCanvasInk) return canvasIds;
  const scored = canvasIds.map((id) => ({
    id,
    score: screenAreaPx(document?.deltaSetLike?.[id], zoom),
  }));
  scored.sort((a, b) => b.score - a.score);
  const keep = new Set(scored.slice(0, maxCanvasInk).map((s) => s.id));
  return canvasIds.filter((id) => keep.has(id));
}

/**
 * Split in-viewport ids: DOM hosts vs SoA/canvas ink (one surface for vectors).
 */
export function pickFullAndCanvasIds(opts: {
  document: SceneDocument;
  visibleIds: string[];
  /** Editors / SoftGlow only — not selection of canvas-ink shapes. */
  forceFullSet?: Set<string>;
  /**
   * Extra ids that must keep a DOM host during demote quiet period
   * (RenderDemotionScheduler CANDIDATE / ACTIVE_SVG).
   */
  holdHostIds?: ReadonlySet<string>;
  zoom: number;
  maxCanvasInk?: number;
}): { fullIds: string[]; canvasIds: string[] } {
  const { document, visibleIds, zoom } = opts;
  const forceFullSet = opts.forceFullSet ?? EMPTY_FORCE_FULL_SET;
  const holdHostIds = opts.holdHostIds;
  const maxCanvasInk = opts.maxCanvasInk ?? MAX_CANVAS_INK_PAINT;
  const fullIds: string[] = [];
  const canvasRaw: string[] = [];
  for (const id of visibleIds) {
    const node = document?.deltaSetLike?.[id];
    if (isNodeStructurallyHiddenInDocument(document, node)) continue;
    const forceHost = forceFullSet.has(id) || Boolean(holdHostIds?.has(id));
    if (nodeNeedsDomShapeHost(node, forceHost)) fullIds.push(id);
    else canvasRaw.push(id);
  }
  return {
    fullIds,
    canvasIds: trimCanvasInkIds({
      document,
      canvasIds: canvasRaw,
      zoom,
      maxCanvasInk,
    }),
  };
}

/**
 * Mounts DOM hosts (text/media/editors). Vector ink is SoA canvas (single surface).
 * Off-viewport nodes are culled; keepVisibleIds stay for selection chrome.
 */
function RcbShapesLayer({
  document,
  reloadToken = 0,
  documentPatchToken = 0,
  lastPatchedNodeIds = [],
  hiddenNodeId = null,
  keepVisibleIds = EMPTY_KEEP,
  forceFullIds = EMPTY_FORCE_FULL,
  spatialIndex = null,
}: Props) {
  const camera = useRcbCamera();
  const { moving, efficientZoom } = useRcbCameraMotion();
  const viewportEl = useRcbViewportEl();
  const frameClipToken = useMemo(
    () =>
      (document.frames || [])
        .map((frame) =>
          [
            frame.id,
            frame.x,
            frame.y,
            frame.width,
            frame.height,
            frame.clipContent,
            frame.hidden,
          ].join(','),
        )
        .join('|'),
    [document.frames],
  );
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  /** Coalesce pan/zoom cull to one update per frame. */
  const [cullCam, setCullCam] = useState({ x: camera.x, y: camera.y, zoom: camera.zoom });

  useEffect(() => {
    if (!viewportEl) return undefined;
    const measure = () => {
      const r = viewportEl.getBoundingClientRect();
      setStageSize({
        width: Math.max(0, r.width),
        height: Math.max(0, r.height),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(viewportEl);
    return () => ro.disconnect();
  }, [viewportEl]);

  const ids = useMemo(() => {
    const children = document?.deltaSetLike?.ROOT?.children;
    return Array.isArray(children) ? (children as string[]) : [];
  }, [document]);

  const idRank = useMemo(() => buildIdRankMap(ids), [ids]);

  const zoomForCull =
    moving && ids.length >= EFFICIENT_ZOOM_SHAPE_THRESHOLD ? efficientZoom : camera.zoom;

  useEffect(() => {
    let raf = 0;
    raf = requestAnimationFrame(() => {
      setCullCam({ x: camera.x, y: camera.y, zoom: zoomForCull });
    });
    return () => cancelAnimationFrame(raf);
  }, [camera.x, camera.y, zoomForCull]);

  const keepSet = useMemo(
    () => new Set(keepVisibleIds.filter(Boolean)),
    [keepVisibleIds]
  );
  const forceFullSet = useMemo(
    () => new Set(forceFullIds.filter(Boolean)),
    [forceFullIds]
  );

  /** Defer SoA buffer rebuild while AI tool_ops apply — flush once on unlock. */
  const aiMutationLock = useSelector(
    (s) => (s.editor?.aiMutationLock as number) || 0
  );
  /** Bumps pick/publish when 动画工作台 isolation toggles (document unchanged). */
  const workbenchTimelineToken = useSelector(
    (s) => String(s.editor?.lottieTimelinePanel?.nodeId || '')
  );

  /** Mount only in-view (+ keep) ids — never `ids.filter` over 100k after spatial hits. */
  const visibleIds = useMemo(() => {
    if (!document || !ids.length || stageSize.width < 1 || stageSize.height < 1) {
      return ids;
    }
    const vp = rcbViewportSceneBounds(cullCam, stageSize);
    const pad = CULL_PAD_SCREEN_PX / Math.max(0.05, cullCam.zoom || 1);
    const view = {
      minX: vp.x - pad,
      minY: vp.y - pad,
      maxX: vp.x + vp.width + pad,
      maxY: vp.y + vp.height + pad,
    };

    if (ids.length >= INDEX_CULL_THRESHOLD && spatialIndex && spatialIndex.size > 0) {
      const hits = spatialIndex.search(view.minX, view.minY, view.maxX, view.maxY);
      const vis = new Set(hits.map((h) => h.id));
      for (const id of keepSet) vis.add(id);
      return sortIdsByRank(vis, idRank, { ascending: true });
    }

    const out: string[] = [];
    for (const id of ids) {
      if (keepSet.has(id)) {
        out.push(id);
        continue;
      }
      const box = nodeSceneAabb(document, id, 8);
      if (!box) continue;
      if (boxesIntersect(box, view)) out.push(id);
    }
    return out;
  }, [document, ids, stageSize, cullCam, spatialIndex, idRank, keepSet]);

  const forceFullSetRef = useRef(forceFullSet);
  forceFullSetRef.current = forceFullSet;
  const idsRef = useRef(ids);
  idsRef.current = ids;

  // Promote/demote quiet period: CANDIDATE keeps DOM host until timer fires.
  const [holdEpoch, setHoldEpoch] = useState(0);
  const demotionRef = useRef<RenderDemotionScheduler | null>(null);
  if (!demotionRef.current) {
    demotionRef.current = createShapesDemotionScheduler(forceFullSetRef, () => {
      setHoldEpoch((n) => n + 1);
    });
  }

  const holdHostIds = useMemo(() => {
    return demotionRef.current?.heldHostIds() ?? forceFullSet;
  }, [holdEpoch, forceFullSet]);

  const { fullIds, canvasIds } = useMemo(
    () =>
      pickFullAndCanvasIds({
        document,
        visibleIds,
        forceFullSet,
        holdHostIds,
        zoom: cullCam.zoom || 1,
      }),
    [document, visibleIds, forceFullSet, holdHostIds, cullCam.zoom, workbenchTimelineToken]
  );

  useLayoutEffect(() => {
    if (!isSoaCanvasShapesEnabled() || !document) return;
    if (aiMutationLock > 0) return;
    syncSoaBufferFromDocumentNow(document, {
      ids,
      lastPatchedNodeIds,
      forceFullIds: forceFullSetRef.current,
    });
    if (lastPatchedNodeIds.length) {
      demotionRef.current?.noteElementsActive(lastPatchedNodeIds);
    }
  }, [document, documentPatchToken, reloadToken, ids, lastPatchedNodeIds, aiMutationLock]);

  useLayoutEffect(() => {
    if (!isSoaCanvasShapesEnabled() || aiMutationLock > 0 || !document) return;
    const buf = getSharedSceneRenderBuffer();
    if (buf.count === 0) return;
    demotionRef.current?.setForceHosts(forceFullSet);
  }, [forceFullSet, aiMutationLock, document]);

  useEffect(() => {
    return () => {
      demotionRef.current?.dispose();
      demotionRef.current = null;
    };
  }, []);

  // Corner-radius drag stays on SoA canvas (transparent SVG corners).
  useLayoutEffect(() => {
    if (!isSoaCanvasShapesEnabled() || aiMutationLock > 0) return;
    const unsubRadius = subscribeLiveCornerRadiusPreview(() => {
      const buf = getSharedSceneRenderBuffer();
      if (buf.count === 0) return;
      const hostIds = new Set(forceFullSetRef.current);
      const radiusId = getLiveCornerRadiusPreviewNodeId();
      if (radiusId) hostIds.delete(radiusId);
      const flipped = applySoaHostInkFlags(buf, hostIds);
      if (flipped > 0) flushDemotionPaintWake();
    });
    return () => {
      unsubRadius();
    };
  }, [aiMutationLock]);

  // AI transaction commit — one buffer sync + bake invalidate + idle paint bump.
  useEffect(() => {
    if (!isSoaCanvasShapesEnabled()) return;
    const onFlush = () => {
      if (!document) return;
      syncSoaBufferFromDocumentNow(document, {
        ids: idsRef.current,
        forceFullIds: forceFullSetRef.current,
        fullRebuild: true,
      });
      bumpSceneCanvasIdlePaint();
    };
    window.addEventListener(RCB_SOA_AI_FLUSH, onFlush);
    return () => window.removeEventListener(RCB_SOA_AI_FLUSH, onFlush);
  }, [document]);

  // Publish canvas-ink ids + selection reveal (skip artboard clip for selected ink).
  // Reveal must NOT be cleared in this effect's cleanup — dep churn mid-drag would
  // race TransformPreview paint and re-clip overflow for a frame.
  const revealKeyRef = useRef('');
  useLayoutEffect(() => {
    if (!document) {
      setFrameClipRevealOverflowIds(null);
      revealKeyRef.current = '';
      clearSceneCanvasIdlePaint();
      return;
    }
    const revealIds: string[] = [];
    for (const id of keepSet) {
      const node = document.deltaSetLike?.[id];
      if (node && shouldRevealShapeOverflow(true, node)) revealIds.push(id);
    }
    const revealKey = revealIds.slice().sort().join('\0');
    const revealChanged = revealKey !== revealKeyRef.current;
    revealKeyRef.current = revealKey;
    setFrameClipRevealOverflowIds(revealIds);
    // Selection reveal toggles clip skip — force a full idle clear so leftover
    // dirty AABBs cannot hide overflow (or leave stale clipped bake pixels).
    if (revealChanged) {
      if (isSoaCanvasShapesEnabled()) {
        markAllSoaDirty(getSharedSceneRenderBuffer());
      }
      requestIdleCanvasFullRepaint();
    }

    if (aiMutationLock > 0) return;
    if (!canvasIds.length) {
      clearSceneCanvasIdlePaint();
      return;
    }
    const sceneDoc = document;
    const paintCanvasIds = canvasIds.filter((id) => {
      const node = sceneDoc.deltaSetLike?.[id];
      return node && !isNodeStructurallyHiddenInDocument(sceneDoc, node);
    });
    setSceneCanvasIdlePaint({
      document: sceneDoc,
      canvasIds: paintCanvasIds,
      hiddenNodeId: hiddenNodeId ?? null,
      getNodeBox: (id) => {
        const node = sceneDoc.deltaSetLike?.[id];
        // Structural only — playhead in/out is AnimationPlayheadSceneSync (DOM).
        if (!node || isNodeStructurallyHiddenInDocument(sceneDoc, node)) return null;
        const { left, top } = nodeLeftTop(sceneDoc, node);
        const box = effectivePaintBox(
          id,
          {
            left,
            top,
            width: Math.max(1, Number(node.width) || 1),
            height: Math.max(1, Number(node.height) || 1),
          },
          Number(node.attrs?.angle) || 0
        );
        if (box.hidden) return null;
        return {
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
        };
      },
    });
    return () => {
      clearSceneCanvasIdlePaint();
    };
  }, [
    document,
    canvasIds,
    hiddenNodeId,
    documentPatchToken,
    aiMutationLock,
    workbenchTimelineToken,
    keepSet,
  ]);

  useEffect(() => {
    return () => {
      setFrameClipRevealOverflowIds(null);
    };
  }, []);

  const patched = useMemo(() => new Set(lastPatchedNodeIds.filter(Boolean)), [lastPatchedNodeIds]);

  if (!document || !visibleIds.length) return null;

  return (
    <div
      data-rcb-shapes-layer="1"
      data-rcb-visible-count={visibleIds.length}
      data-rcb-full-host-count={fullIds.length}
      data-rcb-canvas-idle-count={canvasIds.length}
      className="pointer-events-none absolute left-0 top-0 overflow-visible"
    >
      {fullIds.map((id) => {
        const node = document?.deltaSetLike?.[id];
        return (
          <RcbShapeHost
            key={id}
            nodeId={id}
            document={document}
            zIndex={stackZIndex(document, 'node', id)}
            reloadToken={patched.has(id) ? `${reloadToken}:${documentPatchToken}` : reloadToken}
            frameClipToken={frameClipToken}
            forceHidden={isNodeOverlayHidden(document, node, hiddenNodeId === id)}
            // SoftGlow plates stay forceFull (live SVG) but keep frame clip.
            // Selected DOM hosts (images / editors) reveal via keepVisibleIds.
            revealOverflow={shouldRevealShapeOverflow(
              keepSet.has(id) || forceFullSet.has(id),
              node
            )}
          />
        );
      })}
    </div>
  );
}

export default memo(RcbShapesLayer);
