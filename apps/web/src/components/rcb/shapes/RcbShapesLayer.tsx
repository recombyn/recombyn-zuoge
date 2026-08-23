import { useEffect, useLayoutEffect, useMemo, useState, memo } from 'react';
import { useRcbCamera, useRcbCameraMotion, useRcbViewportEl } from '../camera/context';
import { rcbViewportSceneBounds } from '../core/math';
import {
  RcbSpatialIndex,
  boxesIntersect,
  buildIdRankMap,
  nodeSceneAabb,
  sortIdsByRank,
} from '../core/spatialIndex';
import {
  isNodeHidden
} from '@/components/rcb/scene/document/nodeCapabilities';
import {
  stackZIndex
} from '@/components/rcb/scene/document/sceneDocument';
import { nodeLeftTop } from '@/components/rcb/scene/paint/sceneToSvg';
import { HEAVY_PATH_D_CHARS } from '@/components/rcb/scene/document/sceneShapes';
import type { SceneDocument, SceneNodeInput } from '@/components/rcb/sceneNode';
import {
  clearSceneCanvasIdlePaint,
  canIdlePaintOnCanvas,
  canvasIdleIsStrokeOnly,
  setSceneCanvasIdlePaint,
} from '@/components/rcb/render/sceneRenderer';
import RcbShapeHost from './RcbShapeHost';

export { canvasIdleIsStrokeOnly, canIdlePaintOnCanvas };

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
  /** Must stay as full SVG hosts (inline editors only — selection stays SVG). */
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

/** Cap full SVG hosts; overflow paints as Canvas idle ink. */
const MAX_FULL_HOSTS = 96;

/**
 * Hard cap on Canvas underlay paint when SVG hosts overflow budget.
 * Off-viewport nodes are already culled — they never reach this list.
 */
const MAX_CANVAS_IDLE_PAINT = 4096;

function isHeavyPathNode(node: SceneNodeInput): boolean {
  const d = String(node?.attrs?.path || '');
  return d.length >= HEAVY_PATH_D_CHARS;
}

function screenAreaPx(node: SceneNodeInput, zoom: number): number {
  const w = Math.max(1, Number(node?.width) || 1);
  const h = Math.max(1, Number(node?.height) || 1);
  const z = Math.max(0.05, zoom || 1);
  return w * h * z * z;
}

function hostBudget(opts: {
  moving: boolean;
  visibleCount: number;
}): number {
  const { moving, visibleCount } = opts;
  // Pan/zoom motion: slightly tighter SVG budget; idle keeps full host cap.
  // Far zoom alone must NOT demote in-viewport ink (cull handles off-screen).
  if (moving && visibleCount >= EFFICIENT_ZOOM_SHAPE_THRESHOLD) {
    return Math.min(MAX_FULL_HOSTS, 56);
  }
  return MAX_FULL_HOSTS;
}

function trimCanvasIds(opts: {
  document: SceneDocument;
  canvasIds: string[];
  zoom: number;
  maxCanvasIdle: number;
}): string[] {
  const { document, canvasIds, zoom, maxCanvasIdle } = opts;
  if (canvasIds.length <= maxCanvasIdle) return canvasIds;
  const scored = canvasIds.map((id) => ({
    id,
    score: screenAreaPx(document?.deltaSetLike?.[id], zoom),
  }));
  scored.sort((a, b) => b.score - a.score);
  const keep = new Set(scored.slice(0, maxCanvasIdle).map((s) => s.id));
  // Preserve document z-order among survivors.
  return canvasIds.filter((id) => keep.has(id));
}

/**
 * Split **in-viewport** ids into full SVG hosts vs Canvas2D underlay.
 *
 * Off-screen nodes are culled before this runs — that is the only skip path.
 * Far zoom must not demote visible ink to placeholders. Canvas underlay is an
 * overflow path when SVG hosts exceed budget (or during dense camera motion).
 */
export function pickFullAndCanvasIds(opts: {
  document: SceneDocument;
  visibleIds: string[];
  keepSet: Set<string>;
  /** Only these force full SVG (editors + selection). keepSet is cull-only. */
  forceFullSet?: Set<string>;
  zoom: number;
  moving: boolean;
  maxCanvasIdle?: number;
}): { fullIds: string[]; canvasIds: string[] } {
  const { document, visibleIds, zoom, moving } = opts;
  const forceFullSet = opts.forceFullSet ?? EMPTY_FORCE_FULL_SET;
  const maxCanvasIdle = opts.maxCanvasIdle ?? MAX_CANVAS_IDLE_PAINT;
  const budget = hostBudget({ moving, visibleCount: visibleIds.length });
  const motionOverflow =
    moving && visibleIds.length >= EFFICIENT_ZOOM_SHAPE_THRESHOLD;

  if (visibleIds.length <= budget && !motionOverflow) {
    // Under host budget: keep SVG hosts for every visible node.
    // Canvas-idle must NOT drop hosts — selection / hit / chrome still need a
    // mounted lattice (ADR 0027 phase 1).
    return { fullIds: [...visibleIds], canvasIds: [] };
  }

  const scored: Array<{ id: string; score: number; force: boolean; canvasIdle: boolean }> = [];
  for (const id of visibleIds) {
    const node = document?.deltaSetLike?.[id];
    const force = forceFullSet.has(id);
    const canvasIdle = !force && canIdlePaintOnCanvas(node);
    let score = screenAreaPx(node, zoom);
    // Dense motion: demote heavy paths first when filling the SVG budget.
    if (isHeavyPathNode(node) && motionOverflow) score *= 0.05;
    scored.push({ id, score, force, canvasIdle });
  }
  scored.sort((a, b) => {
    if (a.force !== b.force) return a.force ? -1 : 1;
    // Prefer SVG budget for nodes Canvas cannot paint well; demote idle first.
    if (a.canvasIdle !== b.canvasIdle) return a.canvasIdle ? 1 : -1;
    return b.score - a.score;
  });

  const fullSet = new Set<string>();
  for (const s of scored) {
    if (s.force) {
      fullSet.add(s.id);
      continue;
    }
    // Overflow / dense-motion path: idle Canvas ink skips SVG hosts.
    if (s.canvasIdle) continue;
    if (fullSet.size < budget) fullSet.add(s.id);
  }
  // Preserve document z-order for both lists.
  const fullIds = visibleIds.filter((id) => fullSet.has(id));
  const canvasRaw = visibleIds.filter((id) => !fullSet.has(id));
  const canvasIds = trimCanvasIds({
    document,
    canvasIds: canvasRaw,
    zoom,
    maxCanvasIdle,
  });
  return { fullIds, canvasIds };
}

/**
 * Renders each ROOT child as its own SVG shape host (sharp under CSS camera zoom).
 * Canvas Path2D is only used by selection indicators / draw-tool overlays.
 * Off-viewport nodes are not mounted (lazy paint); selection/editing stay culled-alive.
 * Host overflow / dense camera motion: Canvas2D underlay paints eligible nodes
 * (`setSceneCanvasIdlePaint` → `paintCanvasIdleNode`). Off-viewport ids are not mounted.
 * Selected / editing ids are forceFull (SVG hosts) so transform preview can
 * update DOM; Canvas proxies also read `TransformPreview` via effectivePaintBox.
 * z-index comes from document.stackOrder so shapes can interleave with artboards.
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

  const { fullIds, canvasIds } = useMemo(
    () =>
      pickFullAndCanvasIds({
        document,
        visibleIds,
        keepSet,
        forceFullSet,
        zoom: cullCam.zoom || 1,
        moving,
      }),
    [document, visibleIds, keepSet, forceFullSet, cullCam.zoom, moving]
  );

  const patched = useMemo(() => new Set(lastPatchedNodeIds.filter(Boolean)), [lastPatchedNodeIds]);

  // Publish Canvas idle ids to the stage overlay (screen-space, camera baked).
  // useLayoutEffect so RcbCanvas's paint layout effect sees the snapshot same frame.
  useLayoutEffect(() => {
    if (!document || !canvasIds.length) {
      clearSceneCanvasIdlePaint();
      return () => {
        clearSceneCanvasIdlePaint();
      };
    }
    const sceneDoc = document;
    setSceneCanvasIdlePaint({
      document: sceneDoc,
      canvasIds,
      hiddenNodeId: hiddenNodeId ?? null,
      getNodeBox: (id) => {
        const node = sceneDoc.deltaSetLike?.[id];
        if (!node || isNodeHidden(node)) return null;
        const { left, top } = nodeLeftTop(sceneDoc, node);
        return {
          left,
          top,
          width: Math.max(1, Number(node.width) || 1),
          height: Math.max(1, Number(node.height) || 1),
        };
      },
    });
    return () => {
      clearSceneCanvasIdlePaint();
    };
  }, [document, canvasIds, hiddenNodeId, documentPatchToken]);

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
        // Layer hide (`attrs.hidden`) + inline-edit hide share the same paint gate.
        const layerHidden = isNodeHidden(node);
        return (
          <RcbShapeHost
            key={id}
            nodeId={id}
            document={document}
            zIndex={stackZIndex(document, 'node', id)}
            reloadToken={patched.has(id) ? `${reloadToken}:${documentPatchToken}` : reloadToken}
            frameClipToken={frameClipToken}
            forceHidden={hiddenNodeId === id || layerHidden}
            revealOverflow={forceFullSet.has(id)}
          />
        );
      })}
    </div>
  );
}

export default memo(RcbShapesLayer);
