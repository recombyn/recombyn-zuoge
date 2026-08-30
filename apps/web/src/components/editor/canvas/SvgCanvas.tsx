import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  addNodeToDocument,
  removeNodesFromDocument,
  reorderNodesInDocument,
  listSceneNodes,
  updateNodeInDocument,
} from '@/components/rcb/scene/document/sceneDocument';
import {
  createImageNode,
  createShapeNode,
  measureImageNaturalSize,
  parseLottieAnimationData,
  prepareVideoUploadPreview,
  fitMediaIntoViewport,
  MEDIA_PLACE_DEFAULT,
} from '@/components/rcb/scene/document/nodeFactories';
import { expandSelectionWithGroups } from '@/components/rcb/scene/document/sceneGroups';
import { listProcessingNodeIds } from '@/components/rcb/process/processGlow';
import {
  nodeIdsBoundToFrames,
  type SceneClipboardPayload,
} from '@/components/rcb/scene/document/sceneClipboard';
import {
  loadSceneOntoSvg,
  nodeLeftTop,
} from '@/components/rcb/scene/paint/sceneToSvg';
import { sceneToDocumentCoords } from '@/components/rcb/scene/paint/svgToScene';
import { strokeCenterlineToFilledOutline } from '@/components/rcb/scene/paint/outlineToPath';
import { computeShapeBoolean, type ShapeBox } from '@/components/rcb/selection/shapeBoolean';
import { createDragWriteCoalescer } from './dragWriteCoalescer';
import {
  bindCreatedNodeToFrame,
  createCanvasSession,
  layoutGeneratorPlateAtScene,
} from './canvasSession';
import { runCanvasCtxAction } from './runCanvasCtxAction';
import {
  setSceneHitTestBridge,
} from '@/components/rcb/scene/document/sceneHitBridge';
import {
  SceneSpatialRuntime,
  getSharedSceneSpatialRuntime,
  setSharedSceneSpatialRuntime,
} from '@/components/rcb/core/spatialIndex';
import {
  createSvgSceneRenderer,
  type SceneRenderer,
} from '@/components/rcb/render/sceneRenderer';
import { useSvgBoard } from '@/components/rcb/canvas/useSvgBoard';
import {
  RcbShapesLayer,
  replaceShapePaint,
  setSharedNodeEls,
  listShapeHosts,
  rcbScreenToScene,
  type SvgBoardHandle,
} from '@/components/rcb';
import {
  clearLiveArtboardFrameGeometry,
  previewArtboardFrameGeometry,
} from '@/components/rcb/frames/HtmlArtboardFrame';
import { previewSvgNodeTransform } from '@/components/rcb/scene/paint/sceneToSvg';
import {
  abortNodeUpload,
  formatUploadErrorMessage,
  isUploadAbortError,
  createFilePreviewUrl,
  revokeNodePreviewSrc,
} from '@/utils/uploadImage';
import { uploadCanvasPlaceholderFile } from '@/utils/canvasUploadFlow';
import { probeAudioDuration } from '@/components/editor/nodes/shared/mediaProbe';
import store, { type RootState } from '@/store';
import { message } from '@/components/base';
import { useTranslation } from 'react-i18next';
import {
  cssPreviewForGradient,
  parseFillGradient,
  parseFillType,
  parseFillImageAdjust,
  serializeFillImageAttrs,
} from '@/components/rcb/scene/document/sceneFill';
import { cssSolidWithOpacity } from '@/components/base/colorPanel';
import {
  patchDocumentNode,
  setActiveFrameId,
  setFrameChromeMode,
  setSelectedFrameIds,
  setMixedSelection,
  setActiveTool,
  setDocument,
  setDocumentFromCanvas,
  removeDocumentNodes,
  pushEditorHistory,
  setPendingImageSrc,
  setSelectedNodeId,
  setSelectedNodeIds,
  startImageUploadPlaceholder,
  startVideoUploadPlaceholder,
  startAudioUploadPlaceholder,
  finishImageProcess,
  failImageProcess,
  spawnAnimationBoard,
  importLottieIntoAnimationFrame,
  undo,
  redo,
  clearCanvasAttachPick,
  setCanvasAttachPickBlocked,
  setPendingCanvasAttach,
  EMPTY_ID_LIST,
  isImageToolSidePanelKind,
  isImageToolCropSessionKind,
} from '@/store/modules/editor';
import { requestProjectFlush } from '@/components/editor/useProjectCloudSync';
import {
  canCollabRedo,
  canCollabUndo,
  collabRedo,
  collabUndo,
  getCollabUndoEpoch,
  getCollabViewEpoch,
  isCollabActive,
  isCollabViewOnly,
  subscribeCollabUndo,
  subscribeCollabView,
} from '@/components/editor/collab/collabRuntime';
import SvgPaper from './SvgPaper';
import { pointerToWorld, type ArtboardRect } from './pointerToWorld';
import {
  attachPickFilterOpts,
  ctxMenuSeedNodeIds,
  filterChatAttachNodeIds,
  frameForFullBleedPlate,
  resolveAttachPickPayload,
} from './attachPick';
import { ctxMenuTargetHasProcessing, resolveCtxMenuTargets } from './ctxMenuGuards';
import { buildCanvasContextMenuProps } from './buildCanvasContextMenuProps';
import { closedPenFillAttrs } from './penFillAttrs';
import {
  noteCanvasFlyOrigin,
  resolveAttachPayloadFlyOrigin,
} from '@/components/editor/panels/agent/composer/flyToChat';
import {
  findAnimationFrameAtDocPoint,
  resolveActiveAnimationFrameId,
} from '@/components/editor/nodes/AnimationNode/resolveAnimationFrameId';
import {
  mediaFileAcceptForWorkbenchTimeline,
  warnIfAvBlockedByAnimationWorkbenchFocus,
} from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';
import {
  useCanvasClipboard,
  type CanvasClipboardApi,
} from './clipboard/useCanvasClipboard';
import { useCanvasContextMenu } from './contextMenu/useCanvasContextMenu';
import { useChatImageDrop } from './drop/useChatImageDrop';
import { useCanvasHotkeys } from './keyboard/useCanvasHotkeys';
import {
  SelectionFeature,
  ShapeDrawFeature,
  TextPlaceFeature,
  ImagePlaceFeature,
  PencilDrawFeature,
  PenDrawFeature,
  PenPathEditFeature,
  BucketFillFeature,
  DEFAULT_PENCIL_BRUSH_ID,
  findPencilBrush,
  rcbCenterOnPoint,
  getDocumentGridSize,
  snapCoordToGrid,
} from '@/components/rcb';
import AudioNodeOverlay, {
  type AudioGeomOverride,
} from '@/components/editor/nodes/AudioNode/AudioNodeOverlay';
import VideoNodeOverlay, {
  type VideoGeomOverride,
} from '@/components/editor/nodes/VideoNode/VideoNodeOverlay';
import AnimationNodeOverlay, {
  type LottieGeomOverride,
} from '@/components/editor/nodes/AnimationNode/AnimationNodeOverlay';
import type { SceneDocument, ScenePage } from '@/components/rcb/sceneNode';
import TextInlineEditor from '@/components/editor/nodes/TextNode/TextInlineEditor';
import TextFrameOverlay from '@/components/editor/nodes/TextNode/TextFrameOverlay';
import CanvasContextMenu, {
  type ContextMenuState,
  type CtxAction,
} from '@/components/rcb/selection/chrome/CanvasContextMenu';
import {
  useRcbCamera,
  useRcbOverlayRoot,
  useRcbViewportEl,
} from '@/components/rcb';

const EMPTY_NODE_IDS: string[] = [];

type SvgCanvasProps = {
  document: SceneDocument;
  readOnly?: boolean;
  /**
   * Skip image/video-generator plates and process-shimmer (share preview / export-like view).
   */
  omitNonExportable?: boolean;
  reloadToken?: number;
  selectedNodeId?: string | null;
  selectedNodeIds?: string[];
  documentPatchToken?: number;
  /** Nodes patched via Redux — refresh SVG even when selection is empty (e.g. agent busy). */
  lastPatchedNodeIds?: string[];
  lastPatchTransformOnly?: boolean;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onLoadStart?: () => void;
  onReady?: () => void;
  /** Notify the parent world while selection move / resize / rotate is active. */
  onTransformingChange?: (transforming: boolean) => void;
  /** Artboard drag — same handlers as title label move (hide title, co-move children). */
  onFrameMoveStart?: (frameId: string) => void;
  onFrameMoveEnd?: () => void;
  onFrameMove?: (
    frameId: string,
    x: number,
    y: number,
    opts?: { skipGrid?: boolean; axisLock?: 'h' | 'v' }
  ) => void;
  /** Open the editor AI agent dock (selection contextual bar). */
  onOpenAgent?: (opts?: { prompt?: string }) => void;
  /** Right-click 銆屾坊鍔犲埌 Chat銆嶁€?one node id, `frame:id`, or multiple selected ids as one group. */
  onAddToChat?: (target: string | string[]) => void;
  /** When true, paper has no outer shadow (hosted inside HtmlArtboardFrame). */
  embedded?: boolean;
  /** Full viewport stage — pencil/pen hit-test beyond the finite SVG paper. */
  stageEl?: HTMLElement | null;
  /**
   * Drawable paper in world units. Prefer origin at (0,0) and grow width/height
   * to cover the camera frustum — do not slide the origin with pan/zoom.
   */
  viewRect?: { x: number; y: number; width: number; height: number } | null;
};

/**
 * SVG.js editor shell — mounts the board and composes feature components.
 */
function SvgCanvas({
  document,
  readOnly = false,
  omitNonExportable = false,
  reloadToken = 0,
  selectedNodeId = null,
  selectedNodeIds = [],
  documentPatchToken = 0,
  lastPatchedNodeIds = [],
  lastPatchTransformOnly = false,
  onZoomIn,
  onZoomOut,
  onReady,
  onTransformingChange,
  onFrameMoveStart,
  onFrameMoveEnd,
  onFrameMove,
  onOpenAgent,
  onAddToChat,
  embedded = false,
  stageEl = null,
  viewRect = null,
}: SvgCanvasProps) {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const camera = useRcbCamera();
  const viewportEl = useRcbViewportEl();
  useSyncExternalStore(subscribeCollabView, getCollabViewEpoch, getCollabViewEpoch);
  const collabViewOnly = isCollabViewOnly();
  // Collab share viewers: block mutations while still allowing pan/zoom/select chrome.
  readOnly = Boolean(readOnly || collabViewOnly);
  const canvasApplyLock = useSelector(
    (s: RootState) => (s.editor.canvasApplyLock || 0) as number
  );
  const applyLocked = canvasApplyLock > 0;
  const activeTool = useSelector((s: RootState) => s.editor.activeTool);
  const shapeKind = useSelector((s: RootState) => s.editor.shapeKind);
  const pendingImageSrc = useSelector((s: RootState) => s.editor.pendingImageSrc);
  const penStrokeColor = useSelector((s: RootState) => String(s.editor.penStrokeColor || '#333333'));
  const penFillColor = useSelector((s: RootState) =>
    String(s.editor.penFillColor ?? 'transparent')
  );
  const penStrokeWidth = useSelector((s: RootState) => {
    const n = Number(s.editor.penStrokeWidth);
    return Number.isFinite(n) && n > 0 ? n : 1;
  });
  const pencilBrushId = useSelector((s: RootState) =>
    String(s.editor.pencilBrushId || DEFAULT_PENCIL_BRUSH_ID)
  );
  const pencilPressureEnabled = useSelector((s: RootState) =>
    s.editor.pencilPressureEnabled !== false
  );
  const penStrokeOpacity = useSelector((s: RootState) => {
    const n = Number(s.editor.penStrokeOpacity);
    return Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : 100;
  });
  const bucketFill = useSelector((s: RootState) => s.editor.bucketFill);
  const bucketFillRef = useRef(bucketFill);
  bucketFillRef.current = bucketFill;
  const workspaceMode = useSelector(
    (s: RootState) => (s.editor.workspaceMode || 'design') as 'design' | 'dev'
  );
  const canvasAttachPick = useSelector(
    (s: RootState) =>
      s.editor.canvasAttachPick as null | { target: string; accept?: 'image' | 'media' }
  );
  const canvasAttachPickRef = useRef(canvasAttachPick);
  canvasAttachPickRef.current = canvasAttachPick;
  const onAddToChatRef = useRef(onAddToChat);
  onAddToChatRef.current = onAddToChat;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const lastPointerClientRef = useRef({ x: 0, y: 0 });
  const hitTestRef = useRef<(x: number, y: number, screen?: { clientX: number; clientY: number }) => string | null>(
    () => null
  );
  const reduxCanUndo = useSelector((s: RootState) => (s.editor.historyPast?.length || 0) > 0);
  const reduxCanRedo = useSelector((s: RootState) => (s.editor.historyFuture?.length || 0) > 0);
  useSyncExternalStore(subscribeCollabUndo, getCollabUndoEpoch, getCollabUndoEpoch);
  // Collab prefers Yjs undo; if that stack is empty (pre-seed / sync lag), fall
  // back to Redux so the menu and Ctrl+Z stay usable. View-only never undoes.
  const viewOnly = isCollabViewOnly();
  const collabActive = isCollabActive();
  const canUndo = !viewOnly && (collabActive ? canCollabUndo() || reduxCanUndo : reduxCanUndo);
  const canRedo = !viewOnly && (collabActive ? canCollabRedo() || reduxCanRedo : reduxCanRedo);
  const imageToolPanel = useSelector(
    (s: RootState) => s.editor.imageToolPanel as null | { nodeId: string; kind: string }
  );
  const imageToolSessionNodeId =
    imageToolPanel &&
    (imageToolPanel.kind === 'mark' ||
      imageToolPanel.kind === 'quickEdit')
      ? imageToolPanel.nodeId
      : null;
  const imageToolPanelKind = imageToolPanel?.kind;
  const shapeStylePanel = useSelector((s: RootState) => s.editor.shapeStylePanel as null | { kind: string });
  const shapeStylePanelOpen = Boolean(shapeStylePanel);
  const cropExpandOpen = isImageToolCropSessionKind(imageToolPanelKind);
  const imageToolSidePanelOpen = isImageToolSidePanelKind(imageToolPanelKind);
  const videoToolPanelKind = useSelector(
    (s: RootState) => s.editor.videoToolPanel?.kind as string | undefined
  );
  const videoToolOpen = videoToolPanelKind === 'trim';
  const audioToolPanelKind = useSelector(
    (s: RootState) => s.editor.audioToolPanel?.kind as string | undefined
  );
  const audioToolOpen =
    audioToolPanelKind === 'trim' || audioToolPanelKind === 'speed';
  const activeFrameId = useSelector(
    (s: RootState) => (s.editor.document?.activeFrameId as string | null) ?? null
  );
  const selectedFrameIds = useSelector(
    (s: RootState) => (s.editor.selectedFrameIds as string[]) ?? EMPTY_ID_LIST
  );
  const animationTimelineOpen = useSelector(
    (s: RootState) => Boolean(s.editor.lottieTimelinePanel?.nodeId)
  );

  const paperRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Scene / selection refs (declared once — do not duplicate in this component).
  const documentRef = useRef(document);
  const selectedIdsRef = useRef<string[]>([]);
  const activeFrameIdRef = useRef<string | null>(null);
  const selectedFrameIdsRef = useRef<string[]>([]);
  const loadSeqRef = useRef(0);
  const lastLoadKeyRef = useRef<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const imagePlaceAtRef = useRef<{ x: number; y: number } | null>(null);
  const [paperEl, setPaperEl] = useState<HTMLElement | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const clipboardRef = useRef<SceneClipboardPayload | null>(null);
  /** When the in-app node clipboard was last written (Ctrl+C / cut / context copy). */
  const internalClipboardAtRef = useRef(0);
  /** Last seen OS clipboard fingerprint + when it changed (for paste priority). */
  const osClipboardMetaRef = useRef<{ fingerprint: string; at: number }>({
    fingerprint: '',
    at: 0,
  });
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  /** Double-click pen path → anchor / handle edit. */
  const [editingPenId, setEditingPenId] = useState<string | null>(null);
  const [pathEditSubtool, setPathEditSubtool] = useState<'select' | 'pen' | 'add-anchor' | 'curve'>('select');
  /** After inline text commit, blank-canvas pointerup must not clear selection. */
  const keepSelectAfterTextEditRef = useRef<string | null>(null);
  /** Frames painted directly during a mixed transform; restored on cancellation. */
  const frameGeometryPreviewIdsRef = useRef(new Set<string>());
  const resetFrameMoveOwnersRef = useRef<() => void>(() => undefined);
  const [geometryTransforming, setGeometryTransforming] = useState(false);
  const geometryTransformingRef = useRef(false);
  /** Live video plate boxes while dragging — Redux only commits on gesture end. */
  const [videoLiveGeom, setVideoLiveGeom] = useState<Record<string, VideoGeomOverride> | null>(
    null
  );
  const setVideoLiveGeomRef = useRef(setVideoLiveGeom);
  setVideoLiveGeomRef.current = setVideoLiveGeom;
  const dragWriteCoalesceRef = useRef(
    createDragWriteCoalescer(({ videoGeom }) => {
      if (videoGeom !== undefined) setVideoLiveGeomRef.current(videoGeom);
    })
  );
  useEffect(
    () => () => {
      dragWriteCoalesceRef.current.cancel();
    },
    []
  );
  const overlayRoot = useRcbOverlayRoot();

  const clearFrameGeometryPreview = useCallback(() => {
    const liveDoc = documentRef.current;
    const frames = Array.isArray(liveDoc?.frames) ? liveDoc.frames : [];
    const previewIds = [...frameGeometryPreviewIdsRef.current];
    clearLiveArtboardFrameGeometry(previewIds);
    previewIds.forEach((id) => {
      const frame = frames.find((item: any) => String(item?.id) === id);
      if (frame) previewArtboardFrameGeometry(frame, { recordLive: false });
    });
    frameGeometryPreviewIdsRef.current.clear();
  }, []);

  const onGeometryTransformingChange = useCallback((next: boolean) => {
    geometryTransformingRef.current = next;
    setGeometryTransforming(next);
    onTransformingChange?.(next);
    if (!next) {
      dragWriteCoalesceRef.current.cancel();
      // Clear live geom with the Redux document write in onGeometryCommit when
      // possible. Soft-click / cancelled transforms still need a clear here.
      setVideoLiveGeom(null);
      clearFrameGeometryPreview();
      resetFrameMoveOwnersRef.current();
    }
  }, [clearFrameGeometryPreview, onTransformingChange]);
  // Geometry previews update documentRef before Redux commits on pointer-up.
  // Do not overwrite that live document with the previous Redux snapshot while
  // a transform is active, otherwise cleared frame bindings reappear.
  if (!geometryTransformingRef.current) {
    documentRef.current = document;
  }
  selectedIdsRef.current = ctxMenuSeedNodeIds(selectedNodeIds || [], selectedNodeId);
  activeFrameIdRef.current = activeFrameId;
  selectedFrameIdsRef.current = selectedFrameIds;

  // Content bounds (export / guides). Infinite embedded mode has no DOM paper size —
  // camera CSS on RcbCanvas world layer owns pan/zoom.
  const paperW = viewRect?.width || document?.width || 794;
  const paperH = viewRect?.height || document?.height || 1123;
  const infinite = Boolean(embedded);
  const artboard = useMemo(
    () => ({ x: 0, y: 0, width: paperW, height: paperH }),
    [paperW, paperH]
  );
  const modLabel = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '?' : 'Ctrl';
  // Embedded infinite canvas: per-shape hosts (RcbShapesLayer). Finite paper keeps mono board.
  const { boardRef: monoBoardRef, boardEpoch } = useSvgBoard(hostRef, paperW, paperH, {
    infinite,
    enabled: !infinite,
  });
  const nodeElsRef = useRef(new Map<string, SVGElement>());
  const perShapeBoardRef = useRef<SvgBoardHandle>({
    root: null as unknown as SVGSVGElement,
    layer: null as unknown as SVGGElement,
    nodeEls: nodeElsRef.current,
    getSvgElement: () => null,
    toSvgString: () => '',
  });
  const boardRef = infinite ? perShapeBoardRef : monoBoardRef;

  useEffect(() => {
    if (!infinite) return undefined;
    setSharedNodeEls(nodeElsRef.current);
    perShapeBoardRef.current.nodeEls = nodeElsRef.current;
    // Hosts that painted before shared map was set wrote into a throwaway Map.
    listShapeHosts().forEach((h) => {
      if (h.el) nodeElsRef.current.set(h.nodeId, h.el);
    });
    return () => setSharedNodeEls(null);
  }, [infinite]);

  useEffect(() => {
    setPaperEl(paperRef.current);
  }, [boardEpoch, infinite]);

  // Non-infinite only: keep a finite SVG paper. Embedded infinite must NOT re-apply viewBox.
  useEffect(() => {
    if (infinite) return;
    const board = boardRef.current;
    if (!board) return;
    const w = Math.max(1, Math.round(paperW));
    const h = Math.max(1, Math.round(paperH));
    try {
      board.root.setAttribute('width', String(w));
      board.root.setAttribute('height', String(h));
      board.root.setAttribute('viewBox', `0 0 ${w} ${h}`);
      board.root.setAttribute('preserveAspectRatio', 'none');
    } catch {
      /* ignore */
    }
  }, [infinite, paperW, paperH, boardEpoch, boardRef]);

  useEffect(() => {
    if (infinite) {
      // Per-shape hosts mount via RcbShapesLayer; signal ready once children are known.
      onReadyRef.current?.();
      return;
    }
    const board = boardRef.current;
    if (!board || !document) return;
    // Width/height omitted: world surface padding changes on every edge move.
    const key = `${reloadToken}:${boardEpoch}:${String(document.backgroundColor || '')}`;
    if (lastLoadKeyRef.current === key) return;
    lastLoadKeyRef.current = key;

    const seq = ++loadSeqRef.current;
    board.loadSeq = seq;
    // Drop stale wrappers immediately so in-place preview cannot re-attach detached ghosts.
    board.nodeEls = new Map();
    async function loadScene() {
      const map = await loadSceneOntoSvg(board.root, board.layer, document, seq, board, {
        infinite,
        omitNonExportable,
      });
      if (loadSeqRef.current !== seq) return;
      board.nodeEls = map || new Map();
      onReadyRef.current?.();
    }
    void loadScene();
  }, [document, reloadToken, boardEpoch, infinite, omitNonExportable, boardRef]);

  useEffect(() => {
    if (!documentPatchToken || geometryTransforming) return;
    const board = boardRef.current;
    const doc = documentRef.current;
    if (!board || !doc) return;
    // Only nodes touched by the latest document patch — never repaint on selection
    // alone (re-setting a video poster flashes the first frame under the live <video>).
    lastPatchedNodeIds.forEach((id) => {
      if (!id) return;
      if (lastPatchTransformOnly) {
        const node = doc.deltaSetLike?.[id];
        if (previewSvgNodeTransform(board.nodeEls, id, node)) return;
      }
      void replaceShapePaint(doc, board.nodeEls, id, board.root ? board : null);
    });
  }, [documentPatchToken, lastPatchTransformOnly, lastPatchedNodeIds, geometryTransforming, boardRef]);

  const cameraZoomRef = useRef(camera.zoom);
  cameraZoomRef.current = camera.zoom;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const overlayRootRef = useRef(overlayRoot);
  overlayRootRef.current = overlayRoot;
  const paperElRef = useRef(paperEl);
  paperElRef.current = paperEl;
  // boardRef identity flips with infinite mode — hold the live ref object.
  const boardRefHolder = useRef(boardRef);
  boardRefHolder.current = boardRef;

  /**
   * Spatial index — owned by SceneSpatialRuntime (reload / membership / patch).
   * Never rebuild every AABB because size drifted by 1.
   * Published via setSharedSceneSpatialRuntime for stage underlay consumers.
   */
  const spatialRuntimeRef = useRef(new SceneSpatialRuntime(256));
  useEffect(() => {
    setSharedSceneSpatialRuntime(spatialRuntimeRef.current);
    return () => {
      if (getSharedSceneSpatialRuntime() === spatialRuntimeRef.current) {
        setSharedSceneSpatialRuntime(null);
      }
    };
  }, []);
  const session = useMemo(
    () =>
      createCanvasSession({
        getDocument: () => documentRef.current,
        getCommittedDocument: () =>
          (store.getState() as RootState).editor?.document ?? null,
        setDocumentLocal: (doc) => {
          documentRef.current = doc;
        },
        getBoard: () => boardRefHolder.current.current,
        getZoom: () => cameraZoomRef.current,
        isReadOnly: () => readOnlyRef.current,
        dispatch,
        spatial: spatialRuntimeRef.current,
        setEditingTextId,
        measureViewport: () =>
          overlayRootRef.current?.getBoundingClientRect() ||
          paperElRef.current?.parentElement?.getBoundingClientRect() ||
          null,
        getDragWriteCoalescer: () => dragWriteCoalesceRef.current,
        previewFrameGeometry: (frames) => {
          frames.forEach((frame) => {
            if (previewArtboardFrameGeometry(frame)) {
              frameGeometryPreviewIdsRef.current.add(String(frame.id));
            }
          });
        },
        clearFrameGeometryPreview,
        publishVideoLiveGeom: (next) => {
          dragWriteCoalesceRef.current.queueVideoGeom(next);
        },
        clearVideoLiveGeom: () => {
          setVideoLiveGeomRef.current(null);
        },
      }),
    [dispatch, clearFrameGeometryPreview]
  );
  resetFrameMoveOwnersRef.current = session.resetFrameMoveOwners;
  const {
    listNodeIds,
    getNodeBox,
    hitTestFrame,
    queryNodeIdsInRect,
    finishToSelect,
    onCreateShape,
    onPlaceText,
    imageSizeForViewport,
    placeImageAt,
    onGeometryCommit,
    onGeometryPreview,
    onAngleCommit,
    onAnglePreview,
  } = session;

  /**
   * ADR 0027 SceneRenderer — svg adapter owns hit; paint still via shape hosts.
   * Precise hit is Path2D / AABB only (no live SVG DOM lattice).
   * canvasSession.hitTest uses the same spatial helper for non-UI callers.
   */
  const sceneRenderer = useMemo(
    (): SceneRenderer =>
      createSvgSceneRenderer({
        getDocument: () => documentRef.current,
        getSpatial: () => spatialRuntimeRef.current,
        getZoom: () => cameraZoomRef.current,
        listNodeIds,
        getNodeBox,
      }),
    [listNodeIds, getNodeBox]
  );
  useEffect(() => () => sceneRenderer.dispose(), [sceneRenderer]);

  const hitTest = useCallback(
    (x: number, y: number, screen?: { clientX: number; clientY: number }) =>
      sceneRenderer.hitTest({ x, y }, screen),
    [sceneRenderer]
  );

  const nodeSpatialIndex = useMemo(() => {
    const runtime = spatialRuntimeRef.current;
    const doc = geometryTransforming ? documentRef.current : document;
    if (!doc) {
      runtime.clear();
      return runtime.index;
    }
    const page: ScenePage | undefined =
      doc?.pages?.find((p) => p.id === doc?.activePageId) || doc?.pages?.[0];
    const fromPage = page?.children;
    let childrenSrc: string[] = [];
    if (Array.isArray(fromPage) && fromPage.length) {
      childrenSrc = fromPage;
    } else if (Array.isArray(doc?.deltaSetLike?.ROOT?.children)) {
      childrenSrc = doc.deltaSetLike.ROOT.children;
    }
    return runtime.sync({
      document: doc,
      childrenIds: childrenSrc,
      reloadToken,
      patchedNodeIds: lastPatchedNodeIds,
      aabbPad: 32,
    });
  }, [document, reloadToken, lastPatchedNodeIds, geometryTransforming]);

  useEffect(() => {
    setSceneHitTestBridge(hitTest);
    return () => setSceneHitTestBridge(null);
  }, [hitTest]);

  hitTestRef.current = hitTest;

  /** Apply one canvas pick into composer, then exit pick mode (one pick per activation). */
  const noteFlyOriginForPayload = useCallback(
    (payload: string | string[], fromPointer: boolean) => {
      if (fromPointer) {
        const p = lastPointerClientRef.current;
        if (p.x || p.y) {
          noteCanvasFlyOrigin(p.x, p.y);
          return;
        }
      }
      const doc = documentRef.current;
      if (!doc) return;
      const origin = resolveAttachPayloadFlyOrigin({
        document: doc,
        payload,
        camera,
      });
      if (origin) noteCanvasFlyOrigin(origin.x, origin.y);
    },
    [camera]
  );

  const completeCanvasAttachPick = useCallback(
    (pickTarget: string, payload: string | string[]) => {
      noteFlyOriginForPayload(payload, true);
      if (pickTarget === 'agent') {
        onAddToChatRef.current?.(payload);
      } else {
        // Pending attach keeps the node composer open via the payload — do not
        // steal selection onto the host plate (that feels like exiting pick).
        dispatch(setPendingCanvasAttach({ target: pickTarget, payload }));
      }
      dispatch(clearCanvasAttachPick());
    },
    [dispatch, noteFlyOriginForPayload]
  );

  const emitAddToChat = useCallback(
    (payload: string | string[]) => {
      noteFlyOriginForPayload(payload, false);
      onAddToChatRef.current?.(payload);
    },
    [noteFlyOriginForPayload]
  );

  // Track pointer for pick-mode fly origin (click → composer).
  useEffect(() => {
    if (!stageEl) return undefined;
    const onPointer = (e: PointerEvent) => {
      lastPointerClientRef.current = { x: e.clientX, y: e.clientY };
    };
    stageEl.addEventListener('pointerdown', onPointer, true);
    stageEl.addEventListener('pointermove', onPointer, true);
    return () => {
      stageEl.removeEventListener('pointerdown', onPointer, true);
      stageEl.removeEventListener('pointermove', onPointer, true);
    };
  }, [stageEl]);

  // Plus / not-allowed cursor while picking for Chat.
  useEffect(() => {
    if (!canvasAttachPick || !stageEl) {
      dispatch(setCanvasAttachPickBlocked(false));
      return undefined;
    }
    const onMove = (e: PointerEvent) => {
      const pt = rcbScreenToScene(camera, stageEl, e.clientX, e.clientY);
      const id = hitTestRef.current(pt.x, pt.y, {
        clientX: e.clientX,
        clientY: e.clientY,
      });
      if (!id) {
        dispatch(setCanvasAttachPickBlocked(false));
        return;
      }
      const doc = documentRef.current;
      const seed = expandSelectionWithGroups(doc, [id]);
      const attachable = filterChatAttachNodeIds(
        doc,
        seed,
        attachPickFilterOpts(canvasAttachPickRef.current)
      );
      dispatch(setCanvasAttachPickBlocked(seed.length > 0 && attachable.length === 0));
    };
    stageEl.addEventListener('pointermove', onMove);
    return () => {
      stageEl.removeEventListener('pointermove', onMove);
      dispatch(setCanvasAttachPickBlocked(false));
    };
  }, [canvasAttachPick, stageEl, dispatch, camera]);

  const onSelectFrame = useCallback(
    (frameId: string | null, opts?: { chrome?: 'soft' | 'full' }) => {
      const pick = canvasAttachPickRef.current;
      if (pick?.target) {
        if (!frameId) {
          dispatch(clearCanvasAttachPick());
          return;
        }
        completeCanvasAttachPick(pick.target, `frame:${frameId}`);
        return;
      }
      if (!frameId) {
        dispatch(setActiveFrameId(null));
        return;
      }
      const chrome = opts?.chrome === 'soft' ? 'soft' : 'full';
      dispatch(setSelectedNodeIds([]));
      dispatch(setSelectedNodeId(null));
      dispatch(setActiveFrameId(frameId));
      dispatch(setFrameChromeMode(chrome));
    },
    [dispatch, completeCanvasAttachPick]
  );

  const onSelectFrames = useCallback(
    (frameIds: string[]) => {
      const pick = canvasAttachPickRef.current;
      const ids = Array.isArray(frameIds) ? frameIds.filter(Boolean) : [];
      if (pick?.target) {
        if (!ids.length) {
          dispatch(clearCanvasAttachPick());
          return;
        }
        completeCanvasAttachPick(pick.target, `frame:${ids[0]}`);
        return;
      }
      if (!ids.length) {
        dispatch(setActiveFrameId(null));
        return;
      }
      dispatch(setSelectedNodeIds([]));
      dispatch(setSelectedFrameIds(ids));
    },
    [dispatch, completeCanvasAttachPick]
  );

  const onSelectMixed = useCallback(
    (nodeIds: string[], frameIds: string[], opts?: { additive?: boolean }) => {
      const pick = canvasAttachPickRef.current;
      if (pick?.target && !opts?.additive) {
        const resolved = resolveAttachPickPayload(
          documentRef.current,
          nodeIds || [],
          (frameIds || [])[0],
          attachPickFilterOpts(pick)
        );
        if (!resolved) {
          dispatch(clearCanvasAttachPick());
          return;
        }
        if (resolved.blockedOnly) return; // stay in pick mode
        completeCanvasAttachPick(pick.target, resolved.payload);
        return;
      }
      keepSelectAfterTextEditRef.current = null;
      let nextNodes = expandSelectionWithGroups(documentRef.current, nodeIds || []);
      let nextFrames = [...new Set((frameIds || []).filter(Boolean))];
      if (opts?.additive) {
        const curNodes = new Set(selectedIdsRef.current);
        nextNodes.forEach((id) => {
          if (curNodes.has(id)) curNodes.delete(id);
          else curNodes.add(id);
        });
        nextNodes = [...curNodes];
        const curFrames = new Set(selectedFrameIdsRef.current);
        nextFrames.forEach((id) => {
          if (curFrames.has(id)) curFrames.delete(id);
          else curFrames.add(id);
        });
        nextFrames = [...curFrames];
      }
      dispatch(setMixedSelection({ nodeIds: nextNodes, frameIds: nextFrames }));
    },
    [dispatch, completeCanvasAttachPick]
  );

  const onSelect = useCallback(
    (ids: string[], opts?: { additive?: boolean }) => {
      // Allow selection in read-only Dev/preview so inspect annotations work.
      // Do not re-select after text blur: blank click must clear focus/selection.
      keepSelectAfterTextEditRef.current = null;
      const doc = documentRef.current;
      const pick = canvasAttachPickRef.current;

      // Composer pick mode — attach hit (group-expanded); blocked nodes keep pick active.
      if (pick?.target && !opts?.additive) {
        if (!ids.length) {
          dispatch(clearCanvasAttachPick());
          return;
        }
        if (ids.length === 1) {
          const plateFrame = frameForFullBleedPlate(doc, ids[0]);
          if (plateFrame) {
            completeCanvasAttachPick(pick.target, `frame:${plateFrame.id}`);
            return;
          }
        }
        const resolved = resolveAttachPickPayload(
          doc,
          ids,
          undefined,
          attachPickFilterOpts(pick)
        );
        if (!resolved) {
          dispatch(clearCanvasAttachPick());
          return;
        }
        if (resolved.blockedOnly) return;
        completeCanvasAttachPick(pick.target, resolved.payload);
        return;
      }

      // Soft-click a near-full-bleed background plate → select the artboard instead
      // (avoids a white+stroke rect looking like a UI overlay on the poster).
      if (!opts?.additive && ids.length === 1) {
        const plateFrame = frameForFullBleedPlate(doc, ids[0]);
        if (plateFrame) {
          dispatch(setSelectedNodeIds([]));
          dispatch(setActiveFrameId(plateFrame.id));
          dispatch(setFrameChromeMode('soft'));
          return;
        }
      }
      // Clicking any grouped member selects the whole group.
      let seed = expandSelectionWithGroups(doc, ids);
      let next = seed;
      if (opts?.additive) {
        const cur = new Set(selectedIdsRef.current);
        seed.forEach((id) => {
          if (cur.has(id)) cur.delete(id);
          else cur.add(id);
        });
        next = [...cur];
        // Keep frames when shift-adding nodes.
        dispatch(setSelectedNodeIds(next));
        return;
      }
      // Prefer setSelectedNodeIds only — setSelectedNodeId clears multi-select to [id].
      dispatch(setMixedSelection({ nodeIds: next, frameIds: [] }));
    },
    [dispatch, completeCanvasAttachPick]
  );

  const onTextEditCommit = useCallback(
    (next: {
      attrs: Record<string, unknown>;
      width: number;
      height: number;
      left?: number;
    }) => {
      if (!editingTextId) return;
      const id = editingTextId;
      const doc = documentRef.current;
      keepSelectAfterTextEditRef.current = null;
      const patch: Record<string, unknown> = {
        attrs: next.attrs,
        width: next.width,
        height: next.height,
      };
      if (next.left != null && doc) {
        const coords = sceneToDocumentCoords(doc, next.left, 0);
        patch.x = coords.x;
      }
      dispatch(
        patchDocumentNode({
          nodeId: id,
          patch,
        })
      );
      setEditingTextId(null);
    },
    [dispatch, editingTextId]
  );

  const onTextLiveSize = useCallback(
    (next: { width: number; height: number; left?: number; autoSize?: boolean }) => {
      if (!editingTextId) return;
      const doc = documentRef.current;
      const patch: Record<string, unknown> = {
        width: next.width,
        height: next.height,
      };
      if (next.autoSize != null) {
        patch.attrs = { autoSize: next.autoSize ? 'true' : 'false' };
      }
      if (next.left != null && doc) {
        const coords = sceneToDocumentCoords(doc, next.left, 0);
        patch.x = coords.x;
      }
      dispatch(
        patchDocumentNode({
          nodeId: editingTextId,
          patch,
          skipHistory: true,
        })
      );
    },
    [dispatch, editingTextId]
  );

  const onTextEditCancel = useCallback(() => {
    const id = editingTextId;
    keepSelectAfterTextEditRef.current = null;
    setEditingTextId(null);
    if (!id || !documentRef.current) return;
    const node = documentRef.current.deltaSetLike?.[id];
    const md = String(node?.attrs?.markdown ?? '').trim();
    // Delete empty / freshly placed text that was cancelled.
    if (!md) {
      const next = removeNodesFromDocument(documentRef.current, [id]);
      documentRef.current = next;
      dispatch(setDocument(next));
      dispatch(setSelectedNodeIds([]));
      dispatch(setSelectedNodeId(null));
    } else {
      // Discard edits but keep the node selected (same as blur-to-select).
      dispatch(setSelectedNodeIds([id]));
      dispatch(setSelectedNodeId(id));
    }
  }, [dispatch, editingTextId]);

  // Hide SVG text glyph while the caret editor is open (avoid double text).
  // Native SVGElement has no SVG.js `.opacity()` — use style/attribute.
  useEffect(() => {
    if (!editingTextId) return undefined;
    const applyHidden = (hidden: boolean) => {
      const el = boardRef.current?.nodeEls.get(editingTextId) as SVGElement | undefined;
      if (!el) return false;
      const v = hidden ? '0' : '1';
      el.style.opacity = v;
      el.setAttribute('opacity', v);
      const wrap = el as SVGElement & { opacity?: (n: number) => void };
      if (typeof wrap.opacity === 'function') wrap.opacity(hidden ? 0 : 1);
      return true;
    };
    applyHidden(true);
    // Host remounts on width/height paintToken — keep forcing hide while editing.
    const timer = window.setInterval(() => applyHidden(true), 48);
    return () => {
      window.clearInterval(timer);
      applyHidden(false);
    };
  }, [editingTextId, reloadToken, boardEpoch, boardRef]);

  /**
   * Size an incoming image against what is actually on screen, so the same file
   * lands at a usable size whether the user is zoomed way in or way out.
   */
  // Upload: place immediately at the visible viewport center (not world paper center).
  const autoPlaceSrcRef = useRef<string | null>(null);
  useEffect(() => {
    if (readOnly || !pendingImageSrc) {
      autoPlaceSrcRef.current = null;
      return;
    }
    if (autoPlaceSrcRef.current === pendingImageSrc) return;
    autoPlaceSrcRef.current = pendingImageSrc;

    const view =
      overlayRoot?.getBoundingClientRect() ||
      paperEl?.parentElement?.getBoundingClientRect() ||
      null;
    const center = view && (stageEl || paperEl)
      ? pointerToWorld(
          camera,
          { viewportEl, stageEl, paperEl, artboard },
          view.left + view.width / 2,
          view.top + view.height / 2
        )
      : { x: paperW / 2, y: paperH / 2 };
    placeImageAt(pendingImageSrc, center.x, center.y);
  }, [
    pendingImageSrc,
    paperW,
    paperH,
    paperEl,
    stageEl,
    viewportEl,
    camera,
    overlayRoot,
    artboard,
    placeImageAt,
    readOnly,
  ]);

  const onPencilCommit = useCallback(
    (
      pathD: string,
      box: { left: number; top: number; width: number; height: number },
      meta?: {
        pathPressure?: string;
        brushCategory?: string;
        frameId?: string | null;
      }
    ) => {
      const doc = documentRef.current;
      if (!doc || readOnly) return;
      const origin = sceneToDocumentCoords(doc, box.left, box.top);
      const { id, node } = createShapeNode({
        x: origin.x,
        y: origin.y,
        width: box.width,
        height: box.height,
        shapeType: 'pencil',
        fill: 'transparent',
        stroke: penStrokeColor,
        borderWidth: penStrokeWidth,
        path: pathD,
        closed: false,
        brushStyle: pencilBrushId || DEFAULT_PENCIL_BRUSH_ID,
        opacity: penStrokeOpacity / 100,
      });
      if (meta?.pathPressure) {
        (node.attrs as Record<string, unknown>).pathPressure = meta.pathPressure;
      }
      if (meta?.brushCategory) {
        (node.attrs as Record<string, unknown>).brushCategory = meta.brushCategory;
      }
      const frameId = String(meta?.frameId || '').trim();
      if (frameId && doc.frames?.some((frame) => String(frame.id) === frameId)) {
        (node.attrs as Record<string, unknown>).frameId = frameId;
      }
      (node.attrs as Record<string, unknown>).pressureEnabled = pencilPressureEnabled;
      const inkBrush = findPencilBrush(pencilBrushId || DEFAULT_PENCIL_BRUSH_ID);
      (node.attrs as Record<string, unknown>).pencilFill = inkBrush.fillEnabled !== false;
      (node.attrs as Record<string, unknown>).pencilOutlineWidth =
        Number(inkBrush.outlineStrokeWidth) || 0;
      (node.attrs as Record<string, unknown>).pencilOutlineColor =
        inkBrush.outlineStrokeColor || penStrokeColor;
      const next = bindCreatedNodeToFrame(
        addNodeToDocument(doc, id, node),
        id,
        { left: origin.x, top: origin.y, width: box.width, height: box.height }
      );
      documentRef.current = next;
      dispatch(pushEditorHistory());
      dispatch(setDocumentFromCanvas(next));
      // Stay in pencil mode for continuous strokes; do not auto-select.
      dispatch(setSelectedNodeIds([]));
      dispatch(setSelectedNodeId(null));
      return id;
    },
    [dispatch, readOnly, penStrokeColor, penStrokeWidth, pencilBrushId, penStrokeOpacity, pencilPressureEnabled]
  );

  const onBucketFill = useCallback(
    (nodeId: string) => {
      if (readOnly || !nodeId) return;
      const fill = bucketFillRef.current;
      const fillType = String(fill.fillType || 'solid');
      const attrs: Record<string, unknown> = {
        'fill-color': String(fill.fillColor || '#333333'),
        'fill-type': fillType,
        'fill-opacity': Math.max(0, Math.min(100, Number(fill.fillOpacity) || 100)),
        'fill-enabled': 'true',
        'fill-visible': 'true',
      };
      if (fillType !== 'solid' && fillType !== 'image' && fill.fillGradient) {
        attrs['fill-gradient'] = String(fill.fillGradient);
      } else {
        attrs['fill-gradient'] = undefined;
      }
      if (fillType === 'image') {
        Object.assign(
          attrs,
          serializeFillImageAttrs({
            fillImageSrc: fill.fillImageSrc,
            fillImageFit: fill.fillImageFit,
            fillImageRotate: fill.fillImageRotate,
            fillImageScale: fill.fillImageScale,
            fillImageOffsetX: fill.fillImageOffsetX,
            fillImageOffsetY: fill.fillImageOffsetY,
            ...(fill.fillImageAdjust != null
              ? { fillImageAdjust: parseFillImageAdjust(fill.fillImageAdjust) }
              : {}),
          })
        );
      }
      dispatch(
        patchDocumentNode({
          nodeId,
          patch: { attrs },
        })
      );
    },
    [dispatch, readOnly]
  );

  const onPenCommit = useCallback(
    (
      pathD: string,
      box: { left: number; top: number; width: number; height: number },
      closed: boolean,
      opts?: { replaceNodeId?: string; frameId?: string | null }
    ) => {
      const doc = documentRef.current;
      if (!doc || readOnly) return;
      const origin = sceneToDocumentCoords(doc, box.left, box.top);
      const replaceId = opts?.replaceNodeId;
      if (replaceId && doc.deltaSetLike?.[replaceId]) {
        const prev = doc.deltaSetLike[replaceId];
        const prevType = String(prev?.attrs?.shapeType || 'pen');
        const shapeType = prevType === 'path' ? 'path' : 'pen';
        dispatch(pushEditorHistory());
        dispatch(
          patchDocumentNode({
            nodeId: replaceId,
            patch: {
              x: origin.x,
              y: origin.y,
              width: Math.max(1, box.width),
              height: Math.max(1, box.height),
              attrs: {
                shapeType,
                path: pathD,
                closed: closed ? 'true' : 'false',
                'border-color': penStrokeColor,
                'border-width': penStrokeWidth,
                'fill-color': penFillColor,
                ...(closed ? closedPenFillAttrs(penFillColor) : {}),
              },
            },
          })
        );
        dispatch(setSelectedNodeIds([replaceId]));
        return;
      }
      const { id, node } = createShapeNode({
        x: origin.x,
        y: origin.y,
        width: box.width,
        height: box.height,
        shapeType: 'pen',
        fill: penFillColor,
        stroke: penStrokeColor,
        borderWidth: penStrokeWidth,
        path: pathD,
        closed,
      });
      const frameId = String(opts?.frameId || '').trim();
      if (frameId && doc.frames?.some((frame) => String(frame.id) === frameId)) {
        (node.attrs as Record<string, unknown>).frameId = frameId;
      }
      const next = bindCreatedNodeToFrame(
        addNodeToDocument(doc, id, node),
        id,
        { left: origin.x, top: origin.y, width: box.width, height: box.height }
      );
      documentRef.current = next;
      dispatch(pushEditorHistory());
      dispatch(setDocumentFromCanvas(next));
      // Close / Enter finish — keep pen tool so the next click starts a new path.
      dispatch(setSelectedNodeIds([id]));
    },
    [dispatch, readOnly, penStrokeColor, penFillColor, penStrokeWidth]
  );

  const onPenPathEditCommit = useCallback(
    (payload: {
      nodeId: string;
      pathD: string;
      box: { left: number; top: number; width: number; height: number };
      closed: boolean;
      clearAngle?: boolean;
    }) => {
      const doc = documentRef.current;
      if (!doc || readOnly) return;
      const origin = sceneToDocumentCoords(doc, payload.box.left, payload.box.top);
      const prev = doc.deltaSetLike?.[payload.nodeId];
      const prevType = String(prev?.attrs?.shapeType || 'path');
      const shapeType = prevType === 'pen' ? 'pen' : 'path';
      dispatch(pushEditorHistory());
      dispatch(
        patchDocumentNode({
          nodeId: payload.nodeId,
          patch: {
            x: origin.x,
            y: origin.y,
            width: Math.max(1, payload.box.width),
            height: Math.max(1, payload.box.height),
            attrs: {
              shapeType,
              path: payload.pathD,
              closed: payload.closed ? 'true' : 'false',
              ...(payload.closed
                ? {
                    'fill-enabled': 'true',
                    'fill-visible': 'true',
                  }
                : {}),
              // Baked world path — leaving angle would double-rotate the silhouette.
              ...(payload.clearAngle ? { angle: 0 } : {}),
            },
          },
        })
      );
    },
    [dispatch, readOnly]
  );

  const onPathEditUnionNewShape = useCallback(
    (
      editingId: string,
      addition: {
        pathD: string;
        box: { left: number; top: number; width: number; height: number };
        closed: boolean;
      },
      strokeWidth: number
    ) => {
      const doc = documentRef.current;
      if (!doc || readOnly || !editingId) return;
      const baseNode = doc.deltaSetLike?.[editingId];
      if (!baseNode) return;

      const ink = String(
        baseNode.attrs?.['border-color'] || penStrokeColor || '#333333'
      );
      const sw = Math.max(1, Number(strokeWidth) || penStrokeWidth || 2);
      const baseType = String(baseNode.attrs?.shapeType || 'path');
      const basePath = String(baseNode.attrs?.path || '').trim();
      const baseClosed =
        baseNode.attrs?.closed === true ||
        baseNode.attrs?.closed === 'true' ||
        /\sZ\s*$/i.test(basePath);
      // Open stroke pens must stay stroked siblings — boolean-union turns them into
      // fill-only silhouettes (stroke-enabled=false) and they disappear if fill is clear.
      const baseIsOpenStroke =
        baseType === 'pen' || baseType === 'pencil' || !baseClosed;

      if (!addition.closed || baseIsOpenStroke) {
        const origin = sceneToDocumentCoords(doc, addition.box.left, addition.box.top);
        const { id, node } = createShapeNode({
          x: origin.x,
          y: origin.y,
          width: Math.max(1, addition.box.width),
          height: Math.max(1, addition.box.height),
          shapeType: 'pen',
          fill: 'transparent',
          stroke: ink,
          borderWidth: sw,
          path: addition.pathD,
          closed: addition.closed,
        });
        const next = addNodeToDocument(doc, id, node);
        documentRef.current = next;
        dispatch(pushEditorHistory());
        dispatch(setDocument(next));
        dispatch(setSelectedNodeIds([id]));
        dispatch(setSelectedNodeId(id));
        return;
      }

      const { left: bx, top: by } = nodeLeftTop(doc, baseNode);
      if (!basePath) return;

      const baseBox: ShapeBox = {
        left: bx,
        top: by,
        width: Math.max(1, Number(baseNode.width) || 1),
        height: Math.max(1, Number(baseNode.height) || 1),
        shapeType: 'path',
        path: basePath,
        angle: Number(baseNode.attrs?.angle) || 0,
      };

      const addBox: ShapeBox = {
        left: addition.box.left,
        top: addition.box.top,
        width: addition.box.width,
        height: addition.box.height,
        shapeType: 'path',
        path: addition.pathD,
        angle: 0,
      };

      const { result } = computeShapeBoolean([baseBox, addBox], 'union');
      if (!result?.path) return;

      const fillKeep = String(baseNode.attrs?.['fill-color'] || ink);
      const origin = sceneToDocumentCoords(doc, result.x, result.y);
      dispatch(pushEditorHistory());
      dispatch(
        patchDocumentNode({
          nodeId: editingId,
          patch: {
            x: origin.x,
            y: origin.y,
            width: Math.max(1, result.width),
            height: Math.max(1, result.height),
            attrs: {
              shapeType: 'path',
              path: result.path,
              closed: 'true',
              outlined: 'true',
              // Boolean result is world-baked — drop host angle or the silhouette spins.
              angle: 0,
              'fill-rule': result.fillRule,
              'fill-enabled': 'true',
              'fill-visible': 'true',
              'fill-color': fillKeep === 'transparent' ? ink : fillKeep,
              'fill-type': 'solid',
              'stroke-enabled': 'false',
              'border-width': 0,
            },
          },
        })
      );
      dispatch(setSelectedNodeIds([editingId]));
      dispatch(setSelectedNodeId(editingId));
    },
    [dispatch, readOnly, penStrokeColor, penStrokeWidth]
  );

  const reorderLayer = useCallback(
    (action: 'front' | 'back' | 'forward' | 'backward', ids: string[]) => {
      const doc = documentRef.current;
      if (!doc || !ids.length) return;
      const next = reorderNodesInDocument(doc, ids, action);
      // Reorder only changes z-order — do not bump sceneReloadToken (full remount).
      // Hosts keep their SVG; CSS z-index + DOM order update instead.
      documentRef.current = next;
      dispatch(pushEditorHistory());
      dispatch(setDocumentFromCanvas(next));
    },
    [dispatch]
  );

  const deleteSelected = useCallback(
    (ids: string[]) => {
      if (!ids.length || !documentRef.current) return;
      // Abort in-flight placeholder uploads so finishImageProcess cannot resurrect them.
      ids.forEach((id) => abortNodeUpload(id));
      dispatch(removeDocumentNodes({ nodeIds: ids }));
      // Persist ASAP — refresh must not restore deleted nodes from a stale cloud doc.
      requestProjectFlush();
    },
    [dispatch]
  );

  /**
   * Delete selected nodes and/or artboards in one history step so Undo restores
   * frame + content together (Ctrl+A → Delete must not split into two undos).
   * Upload placeholders are scrubbed from history (not restorable via Undo).
   */
  const deleteCanvasSelection = useCallback(
    (opts?: { nodeIds?: string[]; frameIds?: string[] }) => {
      const doc0 = documentRef.current;
      if (!doc0) return false;
      const nodeIds = opts?.nodeIds ? [...opts.nodeIds] : [...selectedIdsRef.current];
      let frameIds = opts?.frameIds ? [...opts.frameIds] : [...selectedFrameIdsRef.current];
      if (!frameIds.length && !nodeIds.length && activeFrameIdRef.current) {
        frameIds = [activeFrameIdRef.current];
      }
      if (!nodeIds.length && !frameIds.length) return false;

      // A clipped node can have its center outside the frame. Deletion must
      // use visible overlap so all content belonging to the artboard is removed.
      const bound = frameIds.length ? nodeIdsBoundToFrames(doc0, frameIds) : [];
      const allNodes = [...new Set([...nodeIds, ...bound])];
      allNodes.forEach((id) => abortNodeUpload(id));

      dispatch(removeDocumentNodes({ nodeIds: allNodes, frameIds }));
      requestProjectFlush();
      return true;
    },
    [dispatch, t]
  );


  useCanvasContextMenu({
    readOnly,
    viewportEl,
    stageEl,
    paperEl,
    documentRef,
    selectedIdsRef,
    selectedFrameIdsRef,
    activeFrameIdRef,
    hitTest,
    setCtxMenu,
  });

  useChatImageDrop({
    readOnly,
    camera,
    artboard,
    viewportEl,
    stageEl,
    paperEl,
    documentRef,
    imageSizeForViewport,
    finishToSelect,
  });

  const clipboardApiRef = useRef<CanvasClipboardApi | null>(null);

  const runCtxAction = (action: CtxAction) => {
    runCanvasCtxAction(action, {
      getCtxMenu: () => ctxMenu,
      clearCtxMenu: () => setCtxMenu(null),
      selectedIdsRef,
      selectedFrameIdsRef,
      activeFrameIdRef,
      documentRef,
      imagePlaceAtRef,
      imageInputRef,
      clipboardApiRef,
      readOnly: Boolean(readOnly),
      dispatch,
      camera,
      stageEl: stageEl ?? null,
      t,
      onAddToChat: emitAddToChat,
      collabUndo,
      collabRedo,
      deleteCanvasSelection,
      reorderLayer,
    });
  };

  const runCtxActionRef = useRef(runCtxAction);
  runCtxActionRef.current = runCtxAction;

  /** Document x/y so a box of given size is centered on anchor or viewport. */
  const placeOriginForSize = useCallback(
    (
      size: { width: number; height: number },
      anchor?: { x: number; y: number } | null
    ): { x: number; y: number } | null => {
      const doc = documentRef.current;
      if (!doc) return null;
      if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
        const placed = rcbCenterOnPoint({ x: anchor.x, y: anchor.y }, size);
        const origin = sceneToDocumentCoords(doc, placed.left, placed.top);
        const grid = getDocumentGridSize(doc);
        return {
          x: snapCoordToGrid(origin.x, grid),
          y: snapCoordToGrid(origin.y, grid),
        };
      }
      const view =
        overlayRoot?.getBoundingClientRect() ||
        paperEl?.parentElement?.getBoundingClientRect() ||
        null;
      if (view && (stageEl || paperEl)) {
        const center = pointerToWorld(
          camera,
          { viewportEl, stageEl, paperEl, artboard },
          view.left + view.width / 2,
          view.top + view.height / 2
        );
        const placed = rcbCenterOnPoint(center, size);
        const origin = sceneToDocumentCoords(doc, placed.left, placed.top);
        const grid = getDocumentGridSize(doc);
        return {
          x: snapCoordToGrid(origin.x, grid),
          y: snapCoordToGrid(origin.y, grid),
        };
      }
      return { x: 40, y: 40 };
    },
    [artboard, camera, overlayRoot, paperEl, stageEl, viewportEl]
  );

  const getPasteAnchor = useCallback(() => {
    const point = lastPointerClientRef.current;
    if (!point.x && !point.y) return null;
    return pointerToWorld(
      camera,
      { viewportEl, stageEl, paperEl, artboard },
      point.x,
      point.y
    );
  }, [artboard, camera, paperEl, stageEl, viewportEl]);

  const onImageFile = async (file: File | null) => {
    if (!file) return;
    const at = imagePlaceAtRef.current;
    imagePlaceAtRef.current = null;
    let spawnedId = '';
    try {
      const preview = createFilePreviewUrl(file);
      const natural = await measureImageNaturalSize(preview);
      const { width, height } = imageSizeForViewport(natural);
      const origin = placeOriginForSize({ width, height }, at);
      dispatch(
        startImageUploadPlaceholder({
          src: preview,
          width,
          height,
          x: origin?.x,
          y: origin?.y,
          label: '上传中',
          name: file.name?.replace(/\.[^.]+$/, '') || 'Image',
        })
      );
      finishToSelect();
      spawnedId = String(store.getState().editor?.pendingImageProcessId || '');
      await uploadCanvasPlaceholderFile({ dispatch, nodeId: spawnedId, file });
    } catch (err: unknown) {
      if (isUploadAbortError(err)) return;
      revokeNodePreviewSrc(store.getState().editor?.document, spawnedId || undefined);
      dispatch(failImageProcess({ nodeId: spawnedId || undefined }));
      message.error(formatUploadErrorMessage(err, t, '图片上传失败'));
    }
  };

  const onVideoFile = async (file: File | null) => {
    if (!file) return;
    if (warnIfAvBlockedByAnimationWorkbenchFocus(message.warning, t)) return;
    const at = imagePlaceAtRef.current;
    imagePlaceAtRef.current = null;
    try {
      const prepared = await prepareVideoUploadPreview(file);
      const { width, height } = imageSizeForViewport({
        width: prepared.width,
        height: prepared.height,
      });
      const origin = placeOriginForSize({ width, height }, at);
      dispatch(
        startVideoUploadPlaceholder({
          src: prepared.preview,
          poster: prepared.poster,
          width,
          height,
          x: origin?.x,
          y: origin?.y,
          label: '上传中',
          name: prepared.name,
          duration: prepared.duration,
        })
      );
      finishToSelect();
      const spawnedId = String(store.getState().editor?.pendingImageProcessId || '');
      await uploadCanvasPlaceholderFile({
        dispatch,
        nodeId: spawnedId,
        file,
        waitDecode: false,
        extraAttrs: {
          ...(prepared.poster ? { poster: prepared.poster } : {}),
          ...(Number.isFinite(prepared.duration) && prepared.duration > 0
            ? { duration: prepared.duration }
            : {}),
          assetKind: 'video',
        },
      });
    } catch (err: unknown) {
      if (isUploadAbortError(err)) return;
      const failedId = String(store.getState().editor?.pendingImageProcessId || '');
      revokeNodePreviewSrc(store.getState().editor?.document, failedId || undefined);
      dispatch(failImageProcess({ nodeId: failedId || undefined }));
      message.error(formatUploadErrorMessage(err, t, '视频上传失败'));
    }
  };

  const onAudioFile = async (file: File | null) => {
    if (!file) return;
    if (warnIfAvBlockedByAnimationWorkbenchFocus(message.warning, t)) return;
    const at = imagePlaceAtRef.current;
    imagePlaceAtRef.current = null;
    try {
      const preview = createFilePreviewUrl(file);
      const duration = (await probeAudioDuration(preview)) || undefined;
      const { width, height } = fitMediaIntoViewport(
        'audio',
        { ...MEDIA_PLACE_DEFAULT },
        imageSizeForViewport
      );
      const origin = placeOriginForSize({ width, height }, at);
      dispatch(
        startAudioUploadPlaceholder({
          src: preview,
          width,
          height,
          x: origin?.x,
          y: origin?.y,
          label: '上传中',
          name:
            file.name?.replace(/\.[^.]+$/, '') ||
            t('editor.tools.audio', { defaultValue: 'Audio' }),
          duration,
        })
      );
      finishToSelect();
      const spawnedId = String(store.getState().editor?.pendingImageProcessId || '');
      await uploadCanvasPlaceholderFile({
        dispatch,
        nodeId: spawnedId,
        file,
        waitDecode: false,
        extraAttrs: {
          ...(duration ? { duration } : {}),
          assetKind: 'audio',
        },
      });
    } catch (err: unknown) {
      if (isUploadAbortError(err)) return;
      const failedId = String(store.getState().editor?.pendingImageProcessId || '');
      revokeNodePreviewSrc(store.getState().editor?.document, failedId || undefined);
      dispatch(failImageProcess({ nodeId: failedId || undefined }));
      message.error(formatUploadErrorMessage(err, t, '音频上传失败'));
    }
  };

  const onLottiePaste = async (payload: {
    animationData: Record<string, unknown>;
    name?: string;
    anchor?: { x: number; y: number } | null;
  }) => {
    const data = parseLottieAnimationData(payload.animationData);
    if (!data) {
      message.error(t('editor.tools.lottieGenInvalidJson'));
      return;
    }
    const doc = documentRef.current;
    const anchor = payload.anchor ?? null;
    const hitFrameId =
      anchor && doc
        ? findAnimationFrameAtDocPoint(doc, anchor.x, anchor.y)
        : null;
    const targetFrameId =
      hitFrameId ||
      resolveActiveAnimationFrameId(doc, selectedFrameIdsRef.current);
    if (targetFrameId) {
      dispatch(
        importLottieIntoAnimationFrame({
          frameId: targetFrameId,
          animationData: data,
          name: payload.name,
        })
      );
      finishToSelect();
      return;
    }
    // Same as toolstrip: always land in a 动画工作台 (not a free Lottie plate).
    const natW = Math.max(1, Math.round(Number(data.w) || 200));
    const natH = Math.max(1, Math.round(Number(data.h) || 200));
    const { width, height } = imageSizeForViewport({ width: natW, height: natH });
    const origin = placeOriginForSize({ width, height }, anchor);
    dispatch(
      spawnAnimationBoard({
        width,
        height,
        x: origin?.x,
        y: origin?.y,
        name: payload.name || t('editor.tools.animationBoard', { defaultValue: '动画工作台' }),
      })
    );
    const after = store.getState() as any;
    const frameId = String(after?.editor?.selectedFrameIds?.[0] || '').trim();
    if (frameId) {
      dispatch(
        importLottieIntoAnimationFrame({
          frameId,
          animationData: data,
          name: payload.name,
          skipHistory: true,
        })
      );
    }
    finishToSelect();
  };

  const onLottieFile = async (file: File | null) => {
    if (!file) return;
    const at = imagePlaceAtRef.current;
    imagePlaceAtRef.current = null;
    try {
      const text = await file.text();
      const animationData = parseLottieAnimationData(text);
      if (!animationData) throw new Error('invalid lottie');
      await onLottiePaste({
        animationData,
        name: file.name?.replace(/\.json$/i, '') || undefined,
        anchor: at,
      });
    } catch {
      message.error(t('editor.tools.lottieGenInvalidJson'));
    }
  };

  const onMediaFile = (file: File | null) => {
    if (!file) return;
    const mime = (file.type || '').toLowerCase();
    const name = file.name || '';
    if (mime.startsWith('video/')) {
      onVideoFile(file);
      return;
    }
    if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)) {
      onAudioFile(file);
      return;
    }
    if (mime === 'application/json' || mime === 'text/json' || /\.json$/i.test(name)) {
      void onLottieFile(file);
      return;
    }
    onImageFile(file);
  };


  const clipboardApi = useCanvasClipboard({
    readOnly,
    artboardWidth: artboard?.width,
    documentRef,
    selectedIdsRef,
    selectedFrameIdsRef,
    activeFrameIdRef,
    clipboardRef,
    internalClipboardAtRef,
    osClipboardMetaRef,
    imagePlaceAtRef,
    deleteCanvasSelection,
    placeOriginForSize,
    finishToSelect,
    getZoom: () => cameraZoomRef.current,
    onImageFile,
    onVideoFile,
    onAudioFile,
    onLottiePaste,
    getPasteAnchor,
  });
  clipboardApiRef.current = clipboardApi;

  useCanvasHotkeys({
    readOnly,
    activeTool,
    documentRef,
    selectedIdsRef,
    selectedFrameIdsRef,
    activeFrameIdRef,
    canvasAttachPickRef,
    imagePlaceAtRef,
    imageInputRef,
    runCtxActionRef,
    onZoomIn,
    onZoomOut,
    onSelectMixed,
    listNodeIds,
    deleteCanvasSelection,
    reorderLayer,
    copySelected: clipboardApi.copySelected,
    cutSelected: clipboardApi.cutSelected,
    duplicateSelected: clipboardApi.duplicateSelected,
    onAddToChat: emitAddToChat,
  });

  const bgType = parseFillType(document?.backgroundFillType);
  const bgOpacity = Number(document?.backgroundOpacity ?? 100);
  const bgColor = String(document?.backgroundColor || '#ffffff');
  let paperBackground = cssSolidWithOpacity(bgColor, bgOpacity);
  if (bgType === 'image') {
    const src = String(document?.backgroundImageSrc || '');
    if (src) paperBackground = `url(${src}) center / cover no-repeat`;
  } else if (bgType !== 'solid') {
    paperBackground = cssPreviewForGradient(
      {
        ...parseFillGradient(
          document?.backgroundGradient,
          bgType,
          String(document?.backgroundColor || '#3B82F6')
        ),
        type: bgType,
      },
      bgOpacity
    );
  }

  const ids = useMemo(() => {
    if (selectedNodeIds?.length > 0) return selectedNodeIds;
    if (selectedNodeId) return [selectedNodeId];
    return EMPTY_NODE_IDS;
  }, [selectedNodeIds, selectedNodeId]);

  const ctxMenuBusy = useMemo(
    () =>
      ctxMenuTargetHasProcessing({
        document,
        ids,
        selectedFrameIds,
        ctxNodeId: ctxMenu?.nodeId,
        ctxFrameId: ctxMenu?.frameId,
        activeFrameId,
      }),
    [document, ids, selectedFrameIds, ctxMenu?.nodeId, ctxMenu?.frameId, activeFrameId]
  );

  const ctxMenuCapabilities = useMemo(
    () =>
      buildCanvasContextMenuProps({
        document,
        readOnly,
        ids,
        selectedFrameIds,
        ctxMenu,
        activeFrameId,
      }),
    [document, readOnly, ids, selectedFrameIds, ctxMenu, activeFrameId]
  );

  const handleCloseCtxMenu = useCallback(() => setCtxMenu(null), [setCtxMenu]);

  const processingNodeIds = useMemo(
    () => listProcessingNodeIds(document),
    [document]
  );

  const keepVisibleIds = useMemo(() => {
    const out = [...ids, ...processingNodeIds];
    if (editingTextId) out.push(editingTextId);
    if (editingPenId) out.push(editingPenId);
    return out;
  }, [ids, editingTextId, editingPenId, processingNodeIds]);

  /** Editors + selection + processing plates must stay full SVG so SoftGlow /
   * transform preview and hit stay live. */
  const forceFullIds = useMemo(() => {
    const out = [...ids, ...processingNodeIds];
    if (editingTextId) out.push(editingTextId);
    if (editingPenId) out.push(editingPenId);
    return out;
  }, [ids, editingTextId, editingPenId, processingNodeIds]);

  // Path-edit stays open on empty selection (blank click must not dismiss).
  // Only leave when the user selects a *different* node.
  useEffect(() => {
    if (!editingPenId) return;
    if (!ids.length) return;
    if (!ids.includes(editingPenId)) setEditingPenId(null);
  }, [editingPenId, ids]);

  // Outline / toolbar: enter path-edit chrome for a node.
  useEffect(() => {
    const onEnter = (e: Event) => {
      const nodeId = String((e as CustomEvent).detail?.nodeId || '');
      if (!nodeId || readOnly) return;
      setEditingTextId(null);
      setEditingPenId(nodeId);
      dispatch(setSelectedNodeIds([nodeId]));
      dispatch(setActiveTool('select'));
      // Outline / enter path-edit: default to Select (edit anchors), not Pen (draw).
      setPathEditSubtool('select');
      window.dispatchEvent(
        new CustomEvent('resume:path-edit-subtool', { detail: { subtool: 'select' } })
      );
    };
    window.addEventListener('resume:enter-path-edit', onEnter);
    return () => window.removeEventListener('resume:enter-path-edit', onEnter);
  }, [dispatch, readOnly]);

  useEffect(() => {
    const onSub = (e: Event) => {
      const s = (e as CustomEvent).detail?.subtool;
      if (s === 'pen') setPathEditSubtool('pen');
      else if (s === 'add-anchor') setPathEditSubtool('add-anchor');
      else if (s === 'curve') setPathEditSubtool('curve');
      else setPathEditSubtool('select');
    };
    window.addEventListener('resume:path-edit-subtool', onSub);
    return () => window.removeEventListener('resume:path-edit-subtool', onSub);
  }, []);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('resume:path-edit', { detail: { active: Boolean(editingPenId) } })
    );
    return () => {
      if (editingPenId) {
        window.dispatchEvent(new CustomEvent('resume:path-edit', { detail: { active: false } }));
      }
    };
  }, [editingPenId]);

  // Path-edit ink is painted on the overlay canvas; host is forceHidden via
  // RcbShapesLayer (same gate as inline text edit) so the committed SVG does
  // not ghost under the live path.

  // Select / inspect: share preview is readOnly — always allow hit-test + chrome
  // (workspaceMode may briefly lag behind 'dev'). Path-edit owns the pointer
  // (anchors / draft pen) — do not let SelectionFeature clear selection on empty
  // click (that unmounts path-edit and looks like “auto exit”).
  const selectToolActive = activeTool === 'select' || activeTool === 'scale';
  const selectMode = selectToolActive && !editingPenId;
  const shapeMode = !readOnly && activeTool === 'shape';
  const textMode = !readOnly && activeTool === 'text';
  const imageMode = !readOnly && activeTool === 'image';
  const pencilMode = !readOnly && activeTool === 'pencil';
  const penMode = !readOnly && activeTool === 'pen';

  return (
    <div className={embedded ? 'contents' : 'relative rcb-canvas-stage'}>
      <SvgPaper
        paperRef={paperRef}
        hostRef={hostRef}
        width={paperW}
        height={paperH}
        infinite={infinite}
        background={embedded ? 'transparent' : paperBackground}
        className={
          embedded
            ? 'rcb-shapes relative overflow-visible'
            : 'rcb-canvas-paper relative shadow-[0_8px_40px_rgba(15,23,42,0.12)] ring-1 ring-black/5'
        }
      >
        {infinite ? (
          <RcbShapesLayer
            document={document}
            reloadToken={reloadToken}
            documentPatchToken={documentPatchToken}
            lastPatchedNodeIds={lastPatchedNodeIds}
            hiddenNodeId={editingTextId || editingPenId}
            keepVisibleIds={keepVisibleIds}
            forceFullIds={forceFullIds}
            spatialIndex={nodeSpatialIndex}
          />
        ) : null}
        {/* HTML <video>/Lottie live in SVG foreignObject — keep visible during
            transform (same as audio). FO rides previewSvgNodeGeometry with the
            node; hiding globally made unrelated image drags blank every video. */}
        {infinite ? (
          <VideoNodeOverlay
            document={document}
            geometryOverrides={videoLiveGeom}
          />
        ) : null}
        {infinite ? (
          <AnimationNodeOverlay
            document={document}
            geometryOverrides={videoLiveGeom as Record<string, LottieGeomOverride> | null}
          />
        ) : null}
        {infinite ? (
          <AudioNodeOverlay
            document={document}
            // Keep HTML waveform during drag — SVG underlay is plate-only (no poster).
            geometryOverrides={videoLiveGeom as Record<string, AudioGeomOverride> | null}
          />
        ) : null}
        {infinite ? (
          <TextFrameOverlay
            document={document}
            hiddenNodeId={editingTextId}
            selectedNodeIds={ids}
          />
        ) : null}
        {/* Process SoftGlow is owned by RcbShapeHost (node attrs.processStatus). */}
        {/* Scene-space HTML overlays (selection / draw previews). Origin matches SVG. */}
        {/* Above frame/node stackOrder so preview select/hover strokes aren't covered. */}
        {/* Above HostPathChrome (z=1e6) so poly/star/radius knobs receive hits
            over resize hotzones; wrapper is 0×0 + overflow visible, empty areas
            still pass through to chrome / shapes. */}
        <div className="absolute left-0 top-0 z-[1000001] h-0 w-0 overflow-visible">
          <SelectionFeature
            enabled={selectMode && !applyLocked}
            readOnly={readOnly}
            attachPickActive={Boolean(canvasAttachPick)}
            imageToolSessionNodeId={imageToolSessionNodeId}
            document={document}
            selectedNodeIds={ids}
            selectedFrameIds={selectedFrameIds}
            paperEl={paperEl}
            stageEl={stageEl}
            artboard={artboard}
            onSelect={onSelect}
            onGeometryCommit={onGeometryCommit}
            onGeometryPreview={onGeometryPreview}
            onAngleCommit={onAngleCommit}
            onAnglePreview={onAnglePreview}
            hitTest={hitTest}
            hitTestFrame={hitTestFrame}
            onSelectFrame={onSelectFrame}
            onSelectFrames={onSelectFrames}
            onSelectMixed={onSelectMixed}
            getNodeBox={getNodeBox}
            listNodeIds={listNodeIds}
            queryNodeIdsInRect={queryNodeIdsInRect}
            onOpenAgent={onOpenAgent}
            onEditText={(id) => {
              setEditingPenId(null);
              setEditingTextId(id);
            }}
            onEditPenPath={(id) => {
              setEditingTextId(null);
              setEditingPenId(id);
              setPathEditSubtool('select');
              window.dispatchEvent(
                new CustomEvent('resume:path-edit-subtool', { detail: { subtool: 'select' } })
              );
            }}
            suppressChrome={
              Boolean(editingTextId) ||
              Boolean(editingPenId) ||
              cropExpandOpen ||
              imageToolSidePanelOpen ||
              videoToolOpen ||
              audioToolOpen ||
              // Keep chrome while editing radius so the outline can follow rounded corners.
              (shapeStylePanelOpen && shapeStylePanel?.kind !== 'radius')
            }
            onTransformingChange={onGeometryTransformingChange}
            onFrameMoveStart={onFrameMoveStart}
            onFrameMoveEnd={onFrameMoveEnd}
            onFrameMove={onFrameMove}
          />
          <ShapeDrawFeature
            enabled={shapeMode}
            shapeKind={shapeKind || 'rect'}
            artboard={artboard}
            paperEl={paperEl}
            stageEl={stageEl}
            onCreate={onCreateShape}
            hitTestFrame={hitTestFrame}
            // Draw always snaps to the document grid; overlay visibility is separate.
            gridSnap
            gridSize={getDocumentGridSize(document)}
          />
          <TextPlaceFeature
            enabled={textMode}
            artboard={artboard}
            paperEl={paperEl}
            stageEl={stageEl}
            onPlace={onPlaceText}
          />
          <ImagePlaceFeature
            enabled={imageMode}
            artboard={artboard}
            paperEl={paperEl}
            stageEl={stageEl}
            pendingSrc={pendingImageSrc}
            onPlace={placeImageAt}
          />
          <PencilDrawFeature
            enabled={pencilMode}
            artboard={artboard}
            paperEl={paperEl}
            stageEl={stageEl}
            strokeColor={penStrokeColor}
            strokeWidth={penStrokeWidth}
            strokeOpacity={penStrokeOpacity / 100}
            brushId={pencilBrushId}
            pressureEnabled={pencilPressureEnabled}
            onCommit={onPencilCommit}
            hitTestFrame={hitTestFrame}
          />
          <BucketFillFeature
            enabled={!readOnly && activeTool === 'bucket'}
            artboard={artboard}
            paperEl={paperEl}
            stageEl={stageEl}
            fillColor={String(bucketFill.fillColor || '#333333')}
            hitTest={hitTest}
            onFill={onBucketFill}
          />
          <PenDrawFeature
            enabled={penMode && !editingPenId}
            artboard={artboard}
            paperEl={paperEl}
            stageEl={stageEl}
            strokeColor={penStrokeColor}
            strokeWidth={penStrokeWidth}
            gridSnap
            gridSize={getDocumentGridSize(document)}
            onCommit={onPenCommit}
            hitTestFrame={hitTestFrame}
            onCancel={finishToSelect}
            hitTest={hitTest}
            document={document}
            onEditExistingPath={(id) => {
              setEditingTextId(null);
              setEditingPenId(id);
              setPathEditSubtool('select');
              window.dispatchEvent(
                new CustomEvent('resume:path-edit-subtool', { detail: { subtool: 'select' } })
              );
              dispatch(setActiveTool('select'));
            }}
          />
          {editingPenId ? (
            <PenPathEditFeature
              enabled={!readOnly}
              nodeId={editingPenId}
              document={document}
              paperEl={paperEl}
              stageEl={stageEl}
              drawNewShapeMode={pathEditSubtool === 'pen'}
              insertAnchorMode={pathEditSubtool === 'add-anchor'}
              convertPointMode={pathEditSubtool === 'curve'}
              newStrokeColor={penStrokeColor}
              // Path-edit Pen adds geometry to the existing path; it is not
              // the freehand drawing tool and must not inherit its width.
              newStrokeWidth={2}
              gridSnap
              gridSize={getDocumentGridSize(document)}
              onCommitNewShape={({ pathD, box, closed }) => {
                if (!editingPenId) return;
                onPathEditUnionNewShape(editingPenId, { pathD, box, closed }, 2);
              }}
              onCommit={onPenPathEditCommit}
              onExit={() => setEditingPenId(null)}
            />
          ) : null}
        </div>
      </SvgPaper>

      {editingTextId ? (
        <TextInlineEditor
          document={document}
          nodeId={editingTextId}
          onCommit={onTextEditCommit}
          onLiveSize={onTextLiveSize}
          onCancel={onTextEditCancel}
        />
      ) : null}

      <input
        ref={imageInputRef}
        type="file"
        accept={mediaFileAcceptForWorkbenchTimeline(animationTimelineOpen)}
        className="hidden"
        onChange={(e) => {
          onMediaFile(e.target.files?.[0] || null);
          e.target.value = '';
        }}
      />

      <CanvasContextMenu
        menu={ctxMenu}
        hasNode={ctxMenuCapabilities.hasNode}
        canReplace={ctxMenuCapabilities.canReplace}
        canAddToChat={ctxMenuCapabilities.canAddToChat}
        canDelete={ctxMenuCapabilities.canDelete}
        canLayerActions={ctxMenuCapabilities.canLayerActions}
        canExport={ctxMenuCapabilities.canExport}
        canToggleHidden={ctxMenuCapabilities.canToggleHidden}
        canToggleLocked={ctxMenuCapabilities.canToggleLocked}
        canGroup={ctxMenuCapabilities.canGroup}
        canUngroup={ctxMenuCapabilities.canUngroup}
        targetHidden={ctxMenuCapabilities.targetHidden}
        targetLocked={ctxMenuCapabilities.targetLocked}
        exportKind={ctxMenuCapabilities.exportKind}
        canUndo={canUndo}
        canRedo={canRedo}
        canPaste
        canMutateSelection={!ctxMenuBusy}
        modLabel={modLabel}
        onAction={runCtxAction}
        onClose={handleCloseCtxMenu}
      />
    </div>
  );
}

export default memo(SvgCanvas);
