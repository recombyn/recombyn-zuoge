/**
 * Canvas write / hit / geometry session — imperative API used by SvgCanvas.
 */
import type { Dispatch } from '@reduxjs/toolkit';
import {
  addNodeToDocument,
  patchDeltaSetLike,
  reconcileStackOrder,
  updateNodesInDocument,
} from '@/components/rcb/scene/document/sceneDocument';
import {
  nodeIdsBoundToFrames,
} from '@/components/rcb/scene/document/sceneClipboard';
import {
  createImageNode,
  createShapeNode,
  createTextNode,
  fitImageSize,
  measureImageNaturalSize,
} from '@/components/rcb/scene/document/nodeFactories';
import {
  isAudioNode,
  isLottieNode,
  isVideoNode,
} from '@/components/rcb/scene/document/nodeCapabilities';
import { clearImageProcessAttrs } from '@/components/rcb/scene/document/mediaLifecycle';
import {
  STROKE_GEOMETRY_HEIGHT,
  strokeNodeFromEndpoints,
} from '@/components/rcb/scene/document/sceneShapes';
import {
  deflateSelectionBox,
  inflateSelectionBox,
} from '@/components/rcb/scene/document/sceneEffects';
import { hitTestWithSpatialIndex } from '@/components/rcb/render/sceneRenderer';
import {
  clearNodeTransformPreviews,
  setNodeTransformAngles,
  setNodeTransformPreviews,
} from '@/components/rcb/core/transformPreview';
import {
  parseNodeText,
  parseNodeTextStyle,
} from '@/components/rcb/scene/document/sceneText';
import {
  clearSceneDragPreview,
  dedupeSceneNode,
  nodeLeftTop,
  previewSvgNodeAngle,
  previewSvgNodeGeometry,
  purgeOrphanSceneNodes,
} from '@/components/rcb/scene/paint/sceneToSvg';
import { patchNodesGeometry, sceneToDocumentCoords } from '@/components/rcb/scene/paint/svgToScene';
import type { SceneSpatialRuntime } from '@/components/rcb/core/spatialIndex';
import { getShapeHost, replaceShapePaint, shapeHostRevealsOverflow, type SvgBoardHandle } from '@/components/rcb';
import {
  rcbCenterOnPoint,
  rcbDefaultPlaceFontSize,
  rcbFitImageIntoViewport,
  rcbLayoutGeneratorPlate,
  GENERATOR_EMPTY_STROKE_OUTSET,
  getDocumentGridSize,
  snapCoordToGrid,
} from '@/components/rcb';
import { parseFrameSelId } from '@/components/rcb/selection/frameSelectionIds';
import { syncFrameContentClip } from '@/components/rcb/frames/frameContentClip';
import { frameForNodeIntersectPlacement } from '@/components/rcb/frames/frameNodeBinding';
import type { VideoGeomOverride } from '@/components/editor/nodes/VideoNode/VideoNodeOverlay';
import type { createDragWriteCoalescer } from './dragWriteCoalescer';
import type { ArtboardFrameGeometry } from '@/components/rcb/frames/HtmlArtboardFrame';
import {
  patchDocumentNode,
  pushEditorHistory,
  setActiveTool,
  setDocument,
  setDocumentFromCanvas,
  setPendingImageSrc,
  setSelectedNodeId,
  setSelectedNodeIds,
} from '@/store/modules/editor';
import type { SceneDocument, SceneNode } from '@/components/rcb/sceneNode';

type DragWriteCoalescer = ReturnType<typeof createDragWriteCoalescer>;

export type SceneBox = { left: number; top: number; width: number; height: number };

export type GeomPatch = {
  nodeId: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Fit generator plate to viewport, center on scene click (or fallback), snap to grid. */
export function layoutGeneratorPlateAtScene(opts: {
  document: SceneDocument | null | undefined;
  camera: { zoom?: number };
  stageEl: HTMLElement | null;
  natural: { width: number; height: number };
  center: { x: number; y: number } | null;
  fit?: { minRatio?: number; maxRatio?: number };
}): { x: number; y: number; width: number; height: number } {
  const doc = opts.document;
  const fallback = { x: 40, y: 40, width: 360, height: 360 };
  if (!doc) return fallback;
  const view = opts.stageEl?.getBoundingClientRect();
  const zoom = Math.max(0.05, Number(opts.camera?.zoom) || 1);
  const center =
    opts.center && Number.isFinite(opts.center.x) && Number.isFinite(opts.center.y)
      ? opts.center
      : { x: 40 + fallback.width / 2, y: 40 + fallback.height / 2 };
  if (!view || view.width <= 0 || view.height <= 0) {
    const origin = sceneToDocumentCoords(
      doc,
      center.x - fallback.width / 2,
      center.y - fallback.height / 2
    );
    return { ...fallback, x: origin.x, y: origin.y };
  }
  const laid = rcbLayoutGeneratorPlate({
    natural: opts.natural,
    viewport: { width: view.width, height: view.height },
    zoom,
    center,
    gridSize: getDocumentGridSize(doc),
    visualOutset: GENERATOR_EMPTY_STROKE_OUTSET,
    fit: opts.fit,
  });
  const origin = sceneToDocumentCoords(doc, laid.left, laid.top);
  return { x: origin.x, y: origin.y, width: laid.width, height: laid.height };
}

export function listNodeIdsFromDoc(doc: SceneDocument | null | undefined): readonly string[] {
  const page = doc?.pages?.find((p) => p.id === doc?.activePageId) || doc?.pages?.[0];
  const fromPage = page?.children;
  // Return live children — never copy O(N) on every hit/guides call.
  if (Array.isArray(fromPage) && fromPage.length) return fromPage;
  const rootKids = doc?.deltaSetLike?.ROOT?.children;
  return Array.isArray(rootKids) ? rootKids : [];
}

export function getNodeBoxFromDoc(doc: SceneDocument | null | undefined, nodeId: string): SceneBox | null {
  const node = doc?.deltaSetLike?.[nodeId];
  if (!node) return null;
  const { left, top } = nodeLeftTop(doc, node);
  const geom: SceneBox = {
    left,
    top,
    width: Math.max(1, Number(node.width) || 1),
    height: Math.max(1, Number(node.height) || 1),
  };
  // Control box = path + stroke visual outer (resize / rotate follow ink).
  return inflateSelectionBox(geom, node);
}

/** Persist chrome box → stored path geometry. */
export function toGeometryPatches(doc: SceneDocument | null | undefined, patches: GeomPatch[]): GeomPatch[] {
  return patches.map((p) => {
    const node = doc?.deltaSetLike?.[p.nodeId];
    const deflated = deflateSelectionBox(p, node);
    return {
      ...p,
      left: deflated.left,
      top: deflated.top,
      width: deflated.width,
      height: deflated.height,
    };
  });
}

/**
 * Merge live preview angles from documentRef into the committed Redux base.
 * Line/arrow endpoint drags update angle only on the live doc until commit.
 */
export function mergeLiveAnglesIntoDoc(
  base: SceneDocument,
  live: SceneDocument | null | undefined,
  nodeIds: string[]
): SceneDocument {
  if (!live?.deltaSetLike || !nodeIds.length) return base;
  let deltaSetLike = base.deltaSetLike;
  let changed = false;
  for (const nodeId of nodeIds) {
    const liveNode = live.deltaSetLike[nodeId];
    const node = deltaSetLike?.[nodeId];
    if (!liveNode || !node) continue;
    const liveAngle = Number(liveNode.attrs?.angle);
    if (!Number.isFinite(liveAngle)) continue;
    const curAngle = Number(node.attrs?.angle) || 0;
    if (Math.abs(curAngle - liveAngle) < 1e-6) continue;
    if (!changed) {
      deltaSetLike = { ...deltaSetLike };
      changed = true;
    }
    deltaSetLike[nodeId] = {
      ...node,
      attrs: { ...node.attrs, angle: liveAngle },
    };
  }
  return changed ? { ...base, deltaSetLike } : base;
}

/** Line/arrow keep a 1px geometry height — hit tolerance is handled separately. */
export function normalizeGeomPatches(doc: SceneDocument | null | undefined, patches: GeomPatch[]): GeomPatch[] {
  return patches.map((p) => {
    const t = String(doc?.deltaSetLike?.[p.nodeId]?.attrs?.shapeType || '');
    if (t !== 'line' && t !== 'arrow') return p;
    const midY = p.top + p.height / 2;
    return {
      ...p,
      height: STROKE_GEOMETRY_HEIGHT,
      top: midY - STROKE_GEOMETRY_HEIGHT / 2,
      width: Math.max(1, p.width),
    };
  });
}

export function hitTestFrameInDoc(doc: SceneDocument | null | undefined, x: number, y: number): string | null {
  const frames = Array.isArray(doc?.frames) ? doc.frames : [];
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const frame = frames[i];
    if (!frame || frame.locked || frame.hidden) continue;
    const fx = Number(frame.x) || 0;
    const fy = Number(frame.y) || 0;
    const fw = Math.max(1, Number(frame.width) || 1);
    const fh = Math.max(1, Number(frame.height) || 1);
    if (x >= fx && x <= fx + fw && y >= fy && y <= fy + fh) {
      return String(frame.id);
    }
  }
  return null;
}

function rectIntersectsFrame(
  rect: { left: number; top: number; width: number; height: number },
  frame: { x?: number; y?: number; width?: number; height?: number }
) {
  const right = rect.left + Math.max(1, rect.width);
  const bottom = rect.top + Math.max(1, rect.height);
  const frameLeft = Number(frame.x) || 0;
  const frameTop = Number(frame.y) || 0;
  const frameRight = frameLeft + Math.max(1, Number(frame.width) || 1);
  const frameBottom = frameTop + Math.max(1, Number(frame.height) || 1);
  return rect.left < frameRight && right > frameLeft && rect.top < frameBottom && bottom > frameTop;
}

function frameForNodePlacement(
  doc: SceneDocument,
  rect: { left: number; top: number; width: number; height: number }
) {
  return frameForNodeIntersectPlacement(doc, rect);
}

/** Maintain one explicit artboard binding through node moves and resizes. */
function applyNodeFrameBindings(
  doc: SceneDocument,
  patches: GeomPatch[],
  detachedSink?: Set<string>
): SceneDocument {
  const bindingPatches: Array<{ nodeId: string; patch: { attrs: Record<string, unknown> } }> = [];
  const frames = Array.isArray(doc.frames) ? doc.frames : [];
  for (const patch of patches) {
    const node = doc.deltaSetLike?.[patch.nodeId];
    if (!node) continue;
    // Binding follows the geometry produced by this gesture. Reading the node
    // first makes a moved node look like it is still at its old position and
    // leaves a stale frameId after it has completely left the artboard.
    const rect = {
      left: Number(patch.left) || 0,
      top: Number(patch.top) || 0,
      width: Math.max(1, Number(patch.width) || 1),
      height: Math.max(1, Number(patch.height) || 1),
    };
    const currentId = String(node.attrs?.frameId || '').trim();
    let nextId = currentId || null;
    if (currentId) {
      const owner = frames.find((frame) => String(frame.id) === currentId);
      if (owner && rectIntersectsFrame(rect, owner)) {
        nextId = currentId;
      } else {
        nextId = frameForNodePlacement(doc, rect);
      }
    } else {
      nextId = frameForNodePlacement(doc, rect);
    }
    if (nextId === currentId) continue;
    const attrs = { ...(node.attrs || {}) };
    if (nextId) {
      attrs.frameId = nextId;
      if (nextId !== currentId) {
        const orders = Object.values(doc.deltaSetLike || {})
          .filter((item) => String(item?.attrs?.frameId || '').trim() === nextId)
          .map((item) => Number(item?.attrs?.frameOrder))
          .filter(Number.isFinite);
        attrs.frameOrder = orders.length ? Math.max(...orders) + 1 : 0;
      }
    } else {
      delete attrs.frameId;
      delete attrs.frameOrder;
    }
    bindingPatches.push({ nodeId: patch.nodeId, patch: { attrs } });
  }
  if (!bindingPatches.length) return doc;
  const nodeReplacements: Record<string, SceneNode> = {};
  for (const item of bindingPatches) {
    const node = doc.deltaSetLike?.[item.nodeId];
    if (!node) continue;
    nodeReplacements[item.nodeId] = {
      ...node,
      attrs: item.patch.attrs,
    };
  }
  let next = {
    ...doc,
    deltaSetLike: patchDeltaSetLike(doc.deltaSetLike, nodeReplacements),
  };

  // Detached nodes leave their frame-local stack. Put them at the top of the
  // infinite-canvas stack so they cannot remain hidden behind the old frame
  // plate or an unrelated world node after becoming visible again.
  const detachedIds = bindingPatches
    .filter(({ nodeId, patch }) => {
      const before = doc.deltaSetLike?.[nodeId];
      return Boolean(String(before?.attrs?.frameId || '').trim()) && !String(patch.attrs?.frameId || '').trim();
    })
    .map(({ nodeId }) => nodeId);
  if (detachedIds.length) {
    detachedIds.forEach((id) => detachedSink?.add(id));
    const detachedKeys = new Set(detachedIds.map((id) => `node:${id}`));
    const order = Array.isArray(next?.stackOrder) ? next.stackOrder.map(String) : [];
    const remaining = order.filter((key) => !detachedKeys.has(key));
    next = { ...next, stackOrder: [...remaining, ...detachedIds.map((id) => `node:${id}`)] };
  }
  reconcileStackOrder(next);
  return next;
}

/** Bind a freshly created node to the clipContent frame its bbox intersects. */
export function bindCreatedNodeToFrame(
  doc: SceneDocument,
  nodeId: string,
  rect: { left: number; top: number; width: number; height: number }
): SceneDocument {
  return applyNodeFrameBindings(doc, [{ nodeId, ...rect }]);
}

function promoteNodesToWorldTop(doc: SceneDocument, nodeIds: Iterable<string>): SceneDocument {
  const ids = [...new Set([...nodeIds].map(String).filter(Boolean))];
  if (!ids.length) return doc;
  const keys = new Set(ids.map((id) => `node:${id}`));
  const order = Array.isArray(doc.stackOrder) ? doc.stackOrder.map(String) : [];
  const remaining = order.filter((key) => !keys.has(key));
  return {
    ...doc,
    stackOrder: [...remaining, ...ids.map((id) => `node:${id}`)],
  };
}

export type CanvasSessionDeps = {
  getDocument: () => SceneDocument | null;
  /** Prefer Redux head during transform — local ref can lag finishImageProcess. */
  getCommittedDocument?: () => SceneDocument | null;
  setDocumentLocal: (doc: SceneDocument) => void;
  getBoard: () => SvgBoardHandle | null;
  getZoom: () => number;
  isReadOnly: () => boolean;
  dispatch: Dispatch<any>;
  spatial: SceneSpatialRuntime;
  setEditingTextId: (id: string | null) => void;
  measureViewport: () => DOMRect | null;
  getDragWriteCoalescer: () => DragWriteCoalescer;
  previewFrameGeometry: (frames: ArtboardFrameGeometry[]) => void;
  clearFrameGeometryPreview: () => void;
  publishVideoLiveGeom: (next: Record<string, VideoGeomOverride> | null) => void;
  clearVideoLiveGeom: () => void;
};

export type ShapeCreateBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
  frameId?: string | null;
};

export type CanvasSession = {
  listNodeIds: () => readonly string[];
  getNodeBox: (nodeId: string) => SceneBox | null;
  hitTest: (
    x: number,
    y: number,
    screen?: { clientX: number; clientY: number }
  ) => string | null;
  hitTestFrame: (x: number, y: number) => string | null;
  queryNodeIdsInRect: (box: SceneBox) => string[];
  finishToSelect: () => void;
  onCreateShape: (kind: string, box: ShapeCreateBox) => void;
  onPlaceText: (point: { x: number; y: number; width?: number; autoSize?: boolean }) => void;
  imageSizeForViewport: (natural: { width: number; height: number }) => {
    width: number;
    height: number;
  };
  placeImageAt: (src: string, x: number, y: number) => Promise<void>;
  onGeometryCommit: (
    patches: GeomPatch[],
    options?: { textResizeMode?: 'scale' | 'wrap'; skipHistory?: boolean }
  ) => void;
  onGeometryPreview: (
    patches: GeomPatch[],
    options?: { textResizeMode?: 'scale' | 'wrap' | 'frame' }
  ) => void;
  resetFrameMoveOwners: () => void;
  onAngleCommit: (nodeId: string, angleDeg: number, options?: { skipHistory?: boolean }) => void;
  onAnglePreview: (nodeId: string, angleDeg: number) => void;
};

export function createCanvasSession(deps: CanvasSessionDeps): CanvasSession {
  const frameMoveOwners = new Map<string, string[]>();
  const detachedNodeIds = new Set<string>();
  const listNodeIds = () => listNodeIdsFromDoc(deps.getDocument());

  const getNodeBox = (nodeId: string) => getNodeBoxFromDoc(deps.getDocument(), nodeId);

  const hitTest = (
    x: number,
    y: number,
    screen?: { clientX: number; clientY: number }
  ) => {
    const board = deps.getBoard();
    return hitTestWithSpatialIndex(
      {
        getDocument: deps.getDocument,
        getSpatial: () => deps.spatial,
        getZoom: deps.getZoom,
        listNodeIds,
        getNodeBox,
        getNodeEls: () => board?.nodeEls ?? null,
      },
      { x, y },
      screen
    );
  };

  const hitTestFrame = (x: number, y: number) => hitTestFrameInDoc(deps.getDocument(), x, y);

  const queryNodeIdsInRect = (box: SceneBox) =>
    deps.spatial.queryIdsInRect(box, { ascending: true });

  const finishToSelect = () => {
    deps.dispatch(setActiveTool('select'));
  };

  const onCreateShape = (kind: string, box: ShapeCreateBox) => {
    const doc = deps.getDocument();
    if (!doc || deps.isReadOnly()) return;
    const isStroke = kind === 'line' || kind === 'arrow';

    if (isStroke && box.x0 != null && box.y0 != null && box.x1 != null && box.y1 != null) {
      const a = sceneToDocumentCoords(doc, box.x0, box.y0);
      const b = sceneToDocumentCoords(doc, box.x1, box.y1);
      const placed = strokeNodeFromEndpoints({
        x0: a.x,
        y0: a.y,
        x1: b.x,
        y1: b.y,
      });
      const { id, node } = createShapeNode({
        x: placed.x,
        y: placed.y,
        width: placed.width,
        height: placed.height,
        shapeType: kind,
        fill: 'transparent',
        angle: placed.angle,
      });
      const requestedFrameId = String(box.frameId || '').trim();
      if (requestedFrameId && doc.frames?.some((frame) => String(frame.id) === requestedFrameId)) {
        node.attrs.frameId = requestedFrameId;
      }
      const created = addNodeToDocument(doc, id, node);
      const bound = requestedFrameId
        ? created
        : applyNodeFrameBindings(created, [
            { nodeId: id, left: node.x, top: node.y, width: node.width, height: node.height },
          ]);
      deps.setDocumentLocal(bound);
      // History without sceneReloadToken — remounting every host caused a one-frame jump.
      deps.dispatch(pushEditorHistory());
      deps.dispatch(setDocumentFromCanvas(bound));
      deps.dispatch(setSelectedNodeIds([id]));
      deps.dispatch(setSelectedNodeId(id));
      finishToSelect();
      return;
    }

    // Circles / regular polygons / stars are already squared in ShapeDrawFeature
    // (visual→geom). Do NOT Math.max(3, size) here — that inflated geom 2→3 and
    // made committed ink jump from visual 3×3 to 4×4 after center stroke.
    const origin = sceneToDocumentCoords(doc, box.left, box.top);
    const { id, node } = createShapeNode({
      x: origin.x,
      y: origin.y,
      width: box.width,
      height: box.height,
      shapeType: kind,
      fill: '#FFFFFF',
    });
    const requestedFrameId = String(box.frameId || '').trim();
    if (requestedFrameId && doc.frames?.some((frame) => String(frame.id) === requestedFrameId)) {
      node.attrs.frameId = requestedFrameId;
    }
    const next = addNodeToDocument(doc, id, node);
    const bound = requestedFrameId
      ? next
      : applyNodeFrameBindings(next, [
          { nodeId: id, left: node.x, top: node.y, width: node.width, height: node.height },
        ]);
    deps.setDocumentLocal(bound);
    deps.dispatch(pushEditorHistory());
    deps.dispatch(setDocumentFromCanvas(bound));
    deps.dispatch(setSelectedNodeIds([id]));
    deps.dispatch(setSelectedNodeId(id));
    finishToSelect();
  };

  const onPlaceText = (point: { x: number; y: number; width?: number; autoSize?: boolean }) => {
    const doc = deps.getDocument();
    if (!doc || deps.isReadOnly()) return;
    const autoSize = point.autoSize !== false;
    const gridSize = getDocumentGridSize(doc);
    const zoom = Math.max(0.05, deps.getZoom() || 1);
    // Screen-constant ~14px so 3000% zoom does not spawn document-14 glyphs.
    const fontSize = rcbDefaultPlaceFontSize(zoom, 14);
    const origin = sceneToDocumentCoords(
      doc,
      snapCoordToGrid(point.x, gridSize),
      snapCoordToGrid(point.y, gridSize)
    );
    const fixedW = autoSize
      ? 2
      : Math.max(gridSize, snapCoordToGrid(Math.max(gridSize, point.width || 160), gridSize));
    const { id, node } = createTextNode({
      x: origin.x,
      y: origin.y,
      text: '',
      width: fixedW,
      // Height comes from measured font metrics — do not hardcode 20.
      autoSize,
      fontSize,
    });
    const next = addNodeToDocument(doc, id, node);
    const bound = applyNodeFrameBindings(next, [
      { nodeId: id, left: node.x, top: node.y, width: node.width, height: node.height },
    ]);
    deps.setDocumentLocal(bound);
    deps.dispatch(setDocument(bound));
    deps.dispatch(setSelectedNodeIds([id]));
    deps.dispatch(setSelectedNodeId(id));
    deps.setEditingTextId(id);
    finishToSelect();
  };

  const imageSizeForViewport = (natural: { width: number; height: number }) => {
    const view = deps.measureViewport();
    if (!view || view.width < 1 || view.height < 1) {
      return fitImageSize(natural.width, natural.height, 2400);
    }
    return rcbFitImageIntoViewport(natural, view, deps.getZoom());
  };

  const placeImageAt = async (src: string, x: number, y: number) => {
    if (deps.isReadOnly()) return;
    try {
      const natural = await measureImageNaturalSize(src);
      const { width, height } = imageSizeForViewport(natural);
      const latest = deps.getDocument();
      if (!latest) return;
      const placed = rcbCenterOnPoint({ x, y }, { width, height });
      const origin = sceneToDocumentCoords(latest, placed.left, placed.top);
      const { id, node } = createImageNode({
        x: origin.x,
        y: origin.y,
        width: placed.width,
        height: placed.height,
        src,
      });
      const placedDoc = addNodeToDocument(latest, id, node);
      const bound = applyNodeFrameBindings(placedDoc, [
        { nodeId: id, left: node.x, top: node.y, width: node.width, height: node.height },
      ]);
      deps.dispatch(setDocument(bound));
      deps.dispatch(setSelectedNodeId(id));
      deps.dispatch(setPendingImageSrc(null));
      finishToSelect();
    } catch {
      deps.dispatch(setPendingImageSrc(null));
      finishToSelect();
    }
  };

  const applyFrameGeometryPatches = (
    patches: GeomPatch[],
    opts?: { preview?: boolean }
  ) => {
    const nodePatches: GeomPatch[] = [];
    const frames: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];
    for (const p of patches) {
      const fid = parseFrameSelId(p.nodeId);
      if (fid) {
        frames.push({
          id: fid,
          x: p.left,
          y: p.top,
          width: Math.max(1, p.width),
          height: Math.max(1, p.height),
        });
      } else {
        nodePatches.push(p);
      }
    }
    if (!frames.length) return { nodePatches, frames };
    // Live paint is imperative, just like node SVG geometry. Redux only receives
    // the final document on commit so frame and content cannot alternate frames.
    if (opts?.preview) {
      deps.previewFrameGeometry(frames);
    }
    return { nodePatches, frames };
  };

  const translateFrameContent = (
    doc: SceneDocument,
    frames: Array<{ id: string; x: number; y: number }>,
    owners: Map<string, string[]> = frameMoveOwners
  ) => {
    const patches: Array<{ nodeId: string; patch: { x: number; y: number } }> = [];
    for (const framePatch of frames) {
      const frame = (doc.frames || []).find((item) => String(item.id) === String(framePatch.id));
      if (!frame) continue;
      const dx = framePatch.x - (Number(frame.x) || 0);
      const dy = framePatch.y - (Number(frame.y) || 0);
      if (dx === 0 && dy === 0) continue;
      const owned = owners.get(framePatch.id) || nodeIdsBoundToFrames(doc, [framePatch.id]);
      for (const nodeId of owned) {
        const node = doc.deltaSetLike?.[nodeId];
        if (!node) continue;
        patches.push({
          nodeId,
          patch: {
            x: (Number(node.x) || 0) + dx,
            y: (Number(node.y) || 0) + dy,
          },
        });
      }
    }
    return patches.length ? updateNodesInDocument(doc, patches) : doc;
  };

  const onGeometryCommit = (
    patches: GeomPatch[],
    options?: { textResizeMode?: 'scale' | 'wrap'; skipHistory?: boolean }
  ) => {
    // Drop coalesced media previews — frame paint is committed below.
    deps.getDragWriteCoalescer().cancel();
    // Base geometry on the committed Redux doc. During a transform, documentRef
    // is intentionally not synced from Redux — writing it back would revive
    // attrs cleared mid-drag (e.g. processStatus after upload finishes).
    const committed = deps.getCommittedDocument?.() ?? null;
    const live = deps.getDocument();
    const board = deps.getBoard();
    if ((!committed && !live) || deps.isReadOnly() || !patches.length) return;
    const { nodePatches, frames } = applyFrameGeometryPatches(patches);
    const touchedNodeIds = nodePatches
      .map((p) => String(p.nodeId || '').trim())
      .filter(Boolean);
    const doc = mergeLiveAnglesIntoDoc(committed || live!, live, touchedNodeIds);
    let next = doc;
    if (nodePatches.length) {
      const normalized = normalizeGeomPatches(doc, toGeometryPatches(doc, nodePatches));
      next = patchNodesGeometry(doc, normalized, {
        fitTextBox: true,
        textResizeMode: options?.textResizeMode,
      });
      next = applyNodeFrameBindings(next, normalized, detachedNodeIds);
      next = promoteNodesToWorldTop(next, detachedNodeIds);
      // Sync SVG for node patches (below). Keep normalized in scope via rebuild from next.
      deps.setDocumentLocal(next);
      if (board) {
        normalized.forEach((p) => {
          const el = board.nodeEls.get(p.nodeId) as any;
          const shapeType = String(
            el?.sceneShapeType ||
              el?.attr?.('data-scene-shape-type') ||
              next?.deltaSetLike?.[p.nodeId]?.attrs?.shapeType ||
              ''
          );
          const isStrokeShape = shapeType === 'line' || shapeType === 'arrow';
          const isText = next?.deltaSetLike?.[p.nodeId]?.key === 'text';
          const didResize = Boolean(el?.__sceneDidResize);
          clearSceneDragPreview(board.nodeEls, p.nodeId);
          // Images/svg use scale preview while dragging — remount to bake
          // width/height (and refresh the infinite SVG viewport) on commit.
          if (didResize || isStrokeShape || isText) {
            void replaceShapePaint(next, board.nodeEls, p.nodeId, board.root ? board : null);
            return;
          }
          const synced = previewSvgNodeGeometry(board.nodeEls, p.nodeId, p);
          if (!synced) {
            void replaceShapePaint(next, board.nodeEls, p.nodeId, board.root ? board : null);
            return;
          }
          const host = getShapeHost(p.nodeId);
          if (host?.layer) {
            dedupeSceneNode(host.layer, p.nodeId, board.nodeEls.get(p.nodeId) ?? null);
          } else if (board.layer) {
            dedupeSceneNode(board.layer, p.nodeId, board.nodeEls.get(p.nodeId) ?? null);
          }
        });
        const validIds = next?.deltaSetLike?.ROOT?.children || [];
        if (board.layer) {
          purgeOrphanSceneNodes(board.layer, board.nodeEls, validIds);
        } else {
          [...board.nodeEls.keys()].forEach((id) => {
            if (!validIds.includes(id)) board.nodeEls.delete(id);
          });
        }
      }
    }
    // Merge frame boxes into the same document write so nodes don't clobber frames.
    if (frames.length) {
      next = translateFrameContent(next, frames, frameMoveOwners);
      const byId = new Map(frames.map((f) => [f.id, f]));
      next = {
        ...next,
        frames: (Array.isArray(next.frames) ? next.frames : []).map((f: any) => {
          const hit = byId.get(String(f?.id));
          if (!hit) return f;
          return { ...f, x: hit.x, y: hit.y, width: hit.width, height: hit.height };
        }),
      };
    }
    const latestCommitted = deps.getCommittedDocument?.() ?? committed;
    if (latestCommitted && touchedNodeIds.length) {
      for (const id of touchedNodeIds) {
        const committedNode = latestCommitted.deltaSetLike?.[id];
        const pending = String(committedNode?.attrs?.processStatus || '') === 'running';
        const written = String(next?.deltaSetLike?.[id]?.attrs?.processStatus || '') === 'running';
        if (!pending && written) {
          next = clearImageProcessAttrs(next, id);
        }
      }
    }
    deps.setDocumentLocal(next);
    if (!options?.skipHistory) {
      deps.dispatch(pushEditorHistory());
    }
    deps.dispatch(setDocumentFromCanvas(next));
    // Same React turn as Redux doc — HTML plates must not fall back to stale
    // coords between commit and onTransformingChange(false).
    deps.clearVideoLiveGeom();
    deps.clearFrameGeometryPreview();
    clearNodeTransformPreviews();
    frameMoveOwners.clear();
    detachedNodeIds.clear();
  };

  const onGeometryPreview = (
    patches: GeomPatch[],
    options?: { textResizeMode?: 'scale' | 'wrap' | 'frame' }
  ) => {
    const doc = deps.getDocument();
    const board = deps.getBoard();
    if (!doc || deps.isReadOnly() || !patches.length) return;
    const { nodePatches, frames } = applyFrameGeometryPatches(patches, { preview: true });
    if (!board) return;
    if (frames.length) {
      for (const frame of frames) {
        if (!frameMoveOwners.has(frame.id)) {
          frameMoveOwners.set(frame.id, nodeIdsBoundToFrames(doc, [frame.id]));
        }
      }
    }
    const normalized = nodePatches.length
      ? normalizeGeomPatches(doc, toGeometryPatches(doc, nodePatches))
      : [];
    let next = normalized.length
      ? patchNodesGeometry(doc, normalized, {
          textResizeMode: options?.textResizeMode,
        })
      : doc;
    if (normalized.length) {
      next = applyNodeFrameBindings(next, normalized, detachedNodeIds);
      next = promoteNodesToWorldTop(next, detachedNodeIds);
      if (detachedNodeIds.size) {
        // Persist detachment immediately so the next render cannot restore the
        // old Redux snapshot and make the artboard drag the node again.
        deps.dispatch(setDocumentFromCanvas(next));
        detachedNodeIds.clear();
      }
    }
    const translated = translateFrameContent(next, frames, frameMoveOwners);
    const previewDocument = frames.length
      ? {
          ...translated,
          frames: (Array.isArray(translated.frames) ? translated.frames : []).map((frame) => {
            const patch = frames.find((item) => item.id === frame.id);
            return patch ? { ...frame, ...patch } : frame;
          }),
        }
      : next;
    deps.setDocumentLocal(previewDocument);
    const videoOverrides: Record<string, VideoGeomOverride> = {};
    let hasVideo = false;
    const coalescer = deps.getDragWriteCoalescer();
    const previewPatches: Array<{
      nodeId: string;
      left: number;
      top: number;
      width: number;
      height: number;
      angle?: number;
    }> = [];
    normalized.forEach((p) => {
      const node = previewDocument?.deltaSetLike?.[p.nodeId];
      const isText = node?.key === 'text';
      const box =
        isText && options?.textResizeMode === 'wrap'
          ? {
              left: p.left,
              top: p.top,
              width: Math.max(1, Number(node.width) || p.width),
              height: Math.max(1, Number(node.height) || p.height),
            }
          : p;
      previewPatches.push({
        nodeId: p.nodeId,
        left: box.left,
        top: box.top,
        width: Math.max(1, box.width),
        height: Math.max(1, box.height),
        angle: Number(node?.attrs?.angle) || 0,
      });
      // Per-shape hosts may register before shared nodeEls is wired — recover.
      if (!board.nodeEls.get(p.nodeId)) {
        const hostEl = getShapeHost(p.nodeId)?.el;
        if (hostEl) board.nodeEls.set(p.nodeId, hostEl);
      }
      previewSvgNodeGeometry(board.nodeEls, p.nodeId, box, {
        textResizeMode: options?.textResizeMode,
        plainText: isText ? parseNodeText(node.attrs || {}) : undefined,
        textStyle: isText ? parseNodeTextStyle(node.attrs || {}) : undefined,
      });
      if (
        node?.key === 'video' ||
        node?.key === 'lottie' ||
        node?.key === 'audio' ||
        // SoftGlow process plates sit in HTML — keep them glued like media hosts.
        node?.key === 'image'
      ) {
        hasVideo = true;
        const pending = coalescer.getPendingVideoGeom()?.[p.nodeId];
        const host = board.nodeEls.get(p.nodeId) as
          | (SVGElement & {
              __sceneDidResize?: boolean;
              __sceneDragBaseW?: number;
              __sceneDragBaseH?: number;
            })
          | undefined;
        // While CSS-scale resizing, FO stays at drag-base size — HTML plate must
        // match that base box or scrubber/video layout drifts inside the FO.
        const useBase =
          Boolean(host?.__sceneDidResize) &&
          Number(host?.__sceneDragBaseW) > 0 &&
          Number(host?.__sceneDragBaseH) > 0;
        videoOverrides[p.nodeId] = {
          left: box.left,
          top: box.top,
          width: useBase ? Number(host!.__sceneDragBaseW) : Math.max(1, box.width),
          height: useBase ? Number(host!.__sceneDragBaseH) : Math.max(1, box.height),
          angle: Number.isFinite(pending?.angle)
            ? Number(pending!.angle)
            : Number(node.attrs?.angle) || 0,
        };
      }
      const el = board.nodeEls.get(p.nodeId);
      if (el && board.root) {
        const previewNode = {
          ...(previewDocument.deltaSetLike?.[p.nodeId] || node),
          x: box.left,
          y: box.top,
          width: box.width,
          height: box.height,
        };
        syncFrameContentClip(board.root, el, previewDocument, previewNode, {
          zoom: deps.getZoom(),
          revealOverflow: shapeHostRevealsOverflow(p.nodeId),
        });
      }
    });
    if (frames.length) {
      const movedIds = new Set(
        frames.flatMap((frame) => frameMoveOwners.get(frame.id) || [])
      );
      for (const nodeId of movedIds) {
        const before = next.deltaSetLike?.[nodeId];
        const after = previewDocument.deltaSetLike?.[nodeId];
        if (!before || !after || (before.x === after.x && before.y === after.y)) continue;
        const box = {
          left: Number(after.x) || 0,
          top: Number(after.y) || 0,
          width: Math.max(1, Number(after.width) || 1),
          height: Math.max(1, Number(after.height) || 1),
        };
        previewSvgNodeGeometry(board.nodeEls, nodeId, box, {
          plainText: after.key === 'text' ? parseNodeText(after.attrs || {}) : undefined,
          textStyle: after.key === 'text' ? parseNodeTextStyle(after.attrs || {}) : undefined,
        });
        const el = board.nodeEls.get(nodeId);
        if (el && board.root) {
          syncFrameContentClip(board.root, el, previewDocument, after, {
            zoom: deps.getZoom(),
            revealOverflow: shapeHostRevealsOverflow(nodeId),
          });
        }
      }
    }
    // Fact-layer preview for Canvas underlay / chrome (ADR 0027) — not SVG-DOM-only.
    setNodeTransformPreviews(previewPatches);
    const spatialPatchIds = new Set<string>(
      normalized.map((p) => String(p.nodeId || '').trim()).filter(Boolean)
    );
    if (frames.length) {
      for (const frame of frames) {
        for (const nodeId of frameMoveOwners.get(frame.id) || []) {
          spatialPatchIds.add(String(nodeId || '').trim());
        }
      }
    }
    if (spatialPatchIds.size) {
      deps.spatial.patchNodes(previewDocument, [...spatialPatchIds]);
    }
    // Keep HTML <video> plates glued to chrome (Redux doc is still pre-gesture).
    if (hasVideo) {
      deps.publishVideoLiveGeom({
        ...(coalescer.getPendingVideoGeom() || {}),
        ...videoOverrides,
      });
    }
  };

  const onAngleCommit = (
    nodeId: string,
    angleDeg: number,
    options?: { skipHistory?: boolean }
  ) => {
    if (deps.isReadOnly() || !nodeId) return;
    const nextAngle = Number(angleDeg.toFixed(2));
    const doc = deps.getDocument();
    if (doc?.deltaSetLike?.[nodeId]) {
      const node = doc.deltaSetLike[nodeId];
      deps.setDocumentLocal({
        ...doc,
        deltaSetLike: patchDeltaSetLike(doc.deltaSetLike, {
          [nodeId]: {
            ...node,
            attrs: { ...node.attrs, angle: nextAngle },
          },
        }),
      });
    }
    deps.dispatch(
      patchDocumentNode({
        nodeId,
        patch: { attrs: { angle: nextAngle } },
        skipHistory: Boolean(options?.skipHistory),
      })
    );
    clearNodeTransformPreviews([nodeId]);
  };

  const onAnglePreview = (nodeId: string, angleDeg: number) => {
    const doc = deps.getDocument();
    const board = deps.getBoard();
    if (!doc || !board || deps.isReadOnly() || !nodeId) return;
    const node = doc.deltaSetLike?.[nodeId];
    if (!node) return;
    const nextAngle = Number(angleDeg.toFixed(2));
    deps.setDocumentLocal({
      ...doc,
      deltaSetLike: patchDeltaSetLike(doc.deltaSetLike, {
        [nodeId]: {
          ...node,
          attrs: { ...node.attrs, angle: nextAngle },
        },
      }),
    });
    deps.spatial.patchNodes(deps.getDocument()!, [nodeId]);
    setNodeTransformAngles([{ nodeId, angle: nextAngle }]);
    const synced = previewSvgNodeAngle(
      board.nodeEls,
      nodeId,
      nextAngle,
      deps.getDocument()
    );
    if (!synced) {
      void replaceShapePaint(
        deps.getDocument(),
        board.nodeEls,
        nodeId,
        board.root ? board : null
      );
    }
    // HTML video / lottie / audio / image SoftGlow plates read Redux doc —
    // push live angle so rotate tracks chrome.
    if (
      isVideoNode(node) ||
      isLottieNode(node) ||
      isAudioNode(node) ||
      node.key === 'image'
    ) {
      const live = deps.getDocument()?.deltaSetLike?.[nodeId] || node;
      const { left, top } = nodeLeftTop(deps.getDocument(), live);
      const coalescer = deps.getDragWriteCoalescer();
      const pending = coalescer.getPendingVideoGeom()?.[nodeId];
      deps.publishVideoLiveGeom({
        ...(coalescer.getPendingVideoGeom() || {}),
        [nodeId]: {
          left: pending?.left ?? left,
          top: pending?.top ?? top,
          width: Math.max(1, pending?.width != null ? pending.width : Number(live.width) || 1),
          height: Math.max(
            1,
            pending?.height != null ? pending.height : Number(live.height) || 1
          ),
          angle: nextAngle,
        },
      });
    }
  };

  return {
    listNodeIds,
    getNodeBox,
    hitTest,
    hitTestFrame,
    queryNodeIdsInRect,
    finishToSelect,
    onCreateShape,
    onPlaceText,
    imageSizeForViewport,
    placeImageAt,
    onGeometryCommit,
    onGeometryPreview,
    resetFrameMoveOwners: () => {
      frameMoveOwners.clear();
      detachedNodeIds.clear();
    },
    onAngleCommit,
    onAnglePreview,
  };
}
