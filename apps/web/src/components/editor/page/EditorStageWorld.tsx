import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  RcbCanvas,
  RcbSvgDefs,
  FrameDrawFeature,
  FrameMoveFeature,
  HtmlArtboardFrame,
  getSharedNodeEls,
  getSharedSceneSpatialRuntime,
  shapeHostRevealsOverflow,
  type RcbCamera as CanvasCamera,
} from '@/components/rcb';
import type { SceneDocument, SceneNode } from '@/components/rcb/sceneNode';
import SvgCanvas from '@/components/editor/canvas/SvgCanvas';
import ImageProcessWatcher from '@/components/editor/nodes/ImageNode/ImageProcessWatcher';
import UploadJobWatcher from '@/components/editor/nodes/shared/UploadJobWatcher';
import GeneratorJobRecoveryHost from '@/components/editor/nodes/shared/GeneratorJobRecoveryHost';
import CropExpandSessionHost from '@/components/editor/nodes/ImageNode/cropExpand/CropExpandSessionHost';
import UpscaleSessionHost from '@/components/editor/nodes/ImageNode/UpscaleSessionHost';
import { CommercialEditorHosts } from '@/commercial/editorHosts';
import ImageQuickEditSessionHost from '@/components/editor/nodes/ImageNode/ImageQuickEditSessionHost';
import MarkPinHost from '@/components/editor/nodes/ImageNode/mark/MarkPinHost';
import ImageToolPanelHost from '@/components/editor/nodes/ImageNode/toolPanels/ImageToolPanelHost';
import ShapeStylePanelHost from '@/components/editor/nodes/ShapeNode/ShapeStylePanelHost';
import VideoTrimSessionHost from '@/components/editor/nodes/VideoNode/VideoTrimSessionHost';
import LottieComposeSessionHost from '@/components/editor/nodes/LottieNode/LottieComposeSessionHost';
import AudioTrimSessionHost from '@/components/editor/nodes/AudioNode/AudioTrimSessionHost';
import AudioSpeedSessionHost from '@/components/editor/nodes/AudioNode/AudioSpeedSessionHost';
import MeshHandlesOverlay from '@/components/editor/nodes/ShapeNode/MeshHandlesOverlay';
import FrameContextToolbar from '@/components/editor/nodes/FrameNode/FrameContextToolbar';
import FrameMultiSelectionToolbar from '@/components/editor/nodes/FrameNode/FrameMultiSelectionToolbar';
import type { ArtboardFrame } from '@/components/rcb/frames/types';
import type { FillPanelValue } from '@/components/editor/panels/FillPanel';
import {
  stackZIndex,
} from '@/components/rcb/scene/document/sceneDocument';
import {
  smartSnapThreshold,
  type SmartGuideLine,
} from '@/components/rcb/selection/alignGuides';
import {
  computeMovedUnion,
  smartGuideTargetsForDrag,
} from '@/components/rcb/selection/selectionLogic';
import { unionOfBoxes } from '@/components/rcb/selection/resizeGeometry';
import { frameSelId } from '@/components/rcb/selection/frameSelectionIds';
import SmartGuidesOverlay from '@/components/rcb/selection/chrome/SmartGuidesOverlay';
import {
  getNodeBoxFromDoc,
  listNodeIdsFromDoc,
} from '@/components/editor/canvas/canvasSession';
import {
  parseFillGradient,
  serializeFillGradient,
  type FillGradient,
} from '@/components/rcb/scene/document/sceneFill';
import {
  addArtboardFrame,
  renameArtboardFrame,
  setActiveFrameId,
  setFrameChromeMode,
  setActiveTool,
  setCanvasMeta,
  setSelectedNodeIds,
  setDocumentFromCanvas,
  pushEditorHistory,
  clearCanvasAttachPick,
  setPendingCanvasAttach,
  type AiOperationState,
} from '@/store/modules/editor';
import { nodeIdsBoundToFrames } from '@/components/rcb/scene/document/sceneClipboard';
import { canvasFillToDocumentMeta } from './EditorBottomHud';
import type { RootState } from '@/store';
import { nodeLeftTop, previewSvgNodeGeometry } from '@/components/rcb/scene/paint/sceneToSvg';
import { rcbCameraCssZoom } from '@/components/rcb/core/math';
import { syncFrameContentClip } from '@/components/rcb/frames/frameContentClip';
import {
  bindUnownedNodesToFrames,
  shouldCoMoveNodeWithFrames,
} from '@/components/rcb/frames/frameNodeBinding';
import { previewArtboardFrameGeometry } from '@/components/rcb/frames/HtmlArtboardFrame';

const EDITOR_PAN_BLOCK_SELECTOR = [
  '[data-scene-node-id]',
  '[data-sel-box]',
  '[data-sel-handle]',
  '[data-frame-label]',
  '[data-image-label]',
  '[data-frame-toolbar]',
  '[data-sel-toolbar]',
  '[data-ctx-menu]',
  '[data-crop-expand-overlay]',
  '[data-crop-expand-toolbar]',
  '[data-image-tool-panel]',
  '[data-gradient-handles]',
  '[data-mesh-handles]',
  '[data-fill-image-handles]',
  '[data-shape-style-panel]',
  '[data-video-playback-bar]',
  '[data-video-trim-toolbar]',
  '[data-audio-playback-bar]',
  '[data-audio-trim-toolbar]',
  '[data-audio-speed-toolbar]',
  '[data-mark-pin-overlay]',
  '[data-mark-prompt]',
].join(',');

function isEditableFocusTarget(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  return (
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || Boolean(el.isContentEditable)
  );
}

/** Blur stage inputs when pointer lands on the canvas chrome (not the field itself). */
function blurStageEditableOnPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
  const active = window.document.activeElement as HTMLElement | null;
  if (
    !active ||
    active === e.currentTarget ||
    !e.currentTarget.contains(active) ||
    !isEditableFocusTarget(active)
  ) {
    return;
  }
  active.blur();
}

function aiNodeWorldBox(
  document: SceneDocument,
  nodeId: string | null | undefined
): { left: number; top: number; width: number; height: number } | null {
  const id = String(nodeId || '').trim();
  if (!id || id === 'ROOT') return null;
  const node = document.deltaSetLike?.[id] as SceneNode | undefined;
  if (!node) return null;
  const { left, top } = nodeLeftTop(document, node);
  return {
    left,
    top,
    width: Math.max(1, Number(node.width) || 1),
    height: Math.max(1, Number(node.height) || 1),
  };
}

function frameShowsAiOverlay(
  frame: ArtboardFrame,
  aiOp: AiOperationState | null
): boolean {
  if (!aiOp?.active) return String(frame.processStatus || '') === 'running';
  const fid = String(aiOp.frameId || '').trim();
  return Boolean(fid) && fid === frame.id;
}

function frameUnionBox(frames: ArtboardFrame[]) {
  if (!frames.length) return null;
  const left = Math.min(...frames.map((frame) => Number(frame.x) || 0));
  const top = Math.min(...frames.map((frame) => Number(frame.y) || 0));
  const right = Math.max(
    ...frames.map(
      (frame) => (Number(frame.x) || 0) + Math.max(1, Number(frame.width) || 1)
    )
  );
  const bottom = Math.max(
    ...frames.map(
      (frame) => (Number(frame.y) || 0) + Math.max(1, Number(frame.height) || 1)
    )
  );
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function boxesIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function nodeBox(node: SceneNode) {
  return {
    x: Number(node.x) || 0,
    y: Number(node.y) || 0,
    width: Math.max(1, Number(node.width) || 1),
    height: Math.max(1, Number(node.height) || 1),
  };
}

function frameBox(frame: ArtboardFrame) {
  return {
    x: Number(frame.x) || 0,
    y: Number(frame.y) || 0,
    width: Math.max(1, Number(frame.width) || 1),
    height: Math.max(1, Number(frame.height) || 1),
  };
}

/** Nodes that visually sit inside moved frames — co-move + exclude from smart guides. */
function nodeIdsOverlappingFrames(
  doc: SceneDocument,
  movedFrames: Array<{ id: string; startX: number; startY: number; width: number; height: number }>
) {
  const movedFrameIds = new Set(movedFrames.map((frame) => frame.id));
  const frameBoxes = movedFrames.map((frame) => ({
    id: frame.id,
    box: {
      x: frame.startX,
      y: frame.startY,
      width: frame.width,
      height: frame.height,
    },
  }));
  const out: string[] = [];
  for (const [nodeId, node] of Object.entries(doc.deltaSetLike || {})) {
    if (!node || nodeId === 'ROOT') continue;
    const box = nodeBox(node);
    const nodeRect = { left: box.x, top: box.y, width: box.width, height: box.height };
    const matched = frameBoxes.some(({ box: fb }) =>
      shouldCoMoveNodeWithFrames(node, nodeRect, movedFrameIds, {
        left: fb.x,
        top: fb.y,
        width: fb.width,
        height: fb.height,
      })
    );
    if (matched) out.push(nodeId);
  }
  return out;
}

/** Node highlight / operation label / AI cursor — world overlay, not SceneDocument. */
function AiOperationNodeChrome({
  box,
  caption,
  zoom,
}: {
  box: { left: number; top: number; width: number; height: number };
  caption?: string;
  zoom: number;
}) {
  const inv = 1 / Math.max(0.05, zoom);
  return (
    <>
      <div
        data-ai-op-outline
        className="pointer-events-none absolute z-[42] border-[1.5px] border-[#3b82f6]"
        style={{
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
        }}
        aria-hidden
      />
      <div
        data-ai-op-cursor
        className="pointer-events-none absolute z-[43] h-2.5 w-2.5 rounded-full bg-[#3b82f6] shadow-[0_0_0_3px_rgba(59,130,246,0.28)]"
        style={{
          left: box.left + box.width,
          top: box.top + box.height,
          transform: `translate(-50%, -50%) scale(${inv})`,
          transformOrigin: 'center',
        }}
        aria-hidden
      />
      {caption ? (
        <div
          data-ai-op-label
          className="pointer-events-none absolute z-[43] whitespace-nowrap rounded-full bg-[rgba(37,99,235,0.88)] px-2 py-0.5 text-[10px] font-medium leading-none text-white"
          style={{
            left: box.left + box.width / 2,
            top: box.top - 6 * inv,
            transform: `translate(-50%, -100%) scale(${inv})`,
            transformOrigin: 'center bottom',
          }}
        >
          {caption}
        </div>
      ) : null}
    </>
  );
}

function canvasDiffuseMeshGradient(
  fill: FillPanelValue
): FillGradient & { type: 'diffuse' } {
  return {
    ...parseFillGradient(fill.fillGradient, 'diffuse', fill.fillColor),
    type: 'diffuse',
  };
}

/** Per-frame label handlers — undefined in inspect/dev so chrome stays inert.
 *  During composer「从画布选择」, skip drag-move so a title click only attaches. */
function frameLabelInteractionProps(
  frameId: string,
  isDevMode: boolean,
  handlers: {
    onSelectFrame: (id: string, opts?: { chrome?: 'soft' | 'full' }) => void;
    onRenameFrame: (id: string, name: string, options?: { skipHistory?: boolean }) => void;
    onMoveFrame: (
      id: string,
      x: number,
      y: number,
      opts?: { skipGrid?: boolean; axisLock?: 'h' | 'v' }
    ) => void;
    onFrameMoveStart: (id: string) => void;
    onFrameMoveEnd: () => void;
  },
  attachPickActive = false
) {
  if (isDevMode) {
    return {
      onSelect: undefined as undefined,
      onRename: undefined as undefined,
      onMove: undefined as undefined,
      onMoveStart: undefined as undefined,
      onMoveEnd: undefined as undefined,
    };
  }
  return {
    // Title click always promotes to full chrome (toolbar + handles + drag).
    // In attach-pick mode this completes `frame:<id>` via onSelectFrame.
    onSelect: () => handlers.onSelectFrame(frameId, { chrome: 'full' }),
    onRename: (name: string, options?: { skipHistory?: boolean }) =>
      handlers.onRenameFrame(frameId, name, options),
    onMove: attachPickActive
      ? undefined
      : (x: number, y: number, opts?: { skipGrid?: boolean; axisLock?: 'h' | 'v' }) =>
          handlers.onMoveFrame(frameId, x, y, opts),
    onMoveStart: attachPickActive
      ? undefined
      : () => {
          handlers.onSelectFrame(frameId, { chrome: 'full' });
          handlers.onFrameMoveStart(frameId);
        },
    onMoveEnd: attachPickActive ? undefined : handlers.onFrameMoveEnd,
  };
}

type Props = {
  document: SceneDocument;
  worldBounds: { x: number; y: number; width: number; height: number };
  worldSurface: { x: number; y: number; width: number; height: number };
  camera: CanvasCamera;
  onCameraChange: (camera: CanvasCamera) => void;
  panMode: boolean;
  frameMode: boolean;
  stageBackground?: string;
  stageRef: RefObject<HTMLDivElement | null>;
  onViewportEl: (el: HTMLElement | null) => void;
  stageEl: HTMLElement | null;
  canvasCursor?: string;
  gridSize: number;
  isDevMode: boolean;
  isMobileViewport: boolean;
  activeTool: string;
  canvasDocument: SceneDocument;
  sceneReloadToken: number;
  documentPatchToken: number;
  lastPatchedNodeIds: string[];
  lastPatchTransformOnly: boolean;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  selectedFrameIds: string[];
  frames: ArtboardFrame[];
  selectedFrames: ArtboardFrame[];
  activeFrame: ArtboardFrame | null;
  canvasFillValue: FillPanelValue;
  canvasBgOpen: boolean;
  canvasMeshSelectedIndex: number;
  setCanvasMeshSelectedIndex: (v: number) => void;
  canvasMeshShowGuides: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCanvasReady: () => void;
  onOpenAgent: (opts?: { prompt?: string }) => void;
  onAddToChat: (target: string | string[]) => void;
};

/** Infinite canvas world: artboards, SvgCanvas, frame draw/move, style hosts. */
function EditorStageWorld({
  document,
  worldBounds,
  worldSurface,
  camera,
  onCameraChange,
  panMode,
  frameMode,
  stageBackground,
  stageRef,
  onViewportEl,
  stageEl,
  canvasCursor,
  gridSize,
  isDevMode,
  isMobileViewport,
  activeTool,
  canvasDocument,
  sceneReloadToken,
  documentPatchToken,
  lastPatchedNodeIds,
  lastPatchTransformOnly,
  selectedNodeId,
  selectedNodeIds,
  selectedFrameIds,
  frames,
  selectedFrames,
  activeFrame,
  canvasFillValue,
  canvasBgOpen,
  canvasMeshSelectedIndex,
  setCanvasMeshSelectedIndex,
  canvasMeshShowGuides,
  onZoomIn,
  onZoomOut,
  onCanvasReady,
  onOpenAgent,
  onAddToChat,
}: Props) {
  const dispatch = useDispatch();
  const aiOperationState = useSelector(
    (state: RootState) => state.editor.aiOperationState
  );
  const canvasApplyLock = useSelector(
    (state: RootState) => (state.editor.canvasApplyLock || 0) as number
  );
  const frameChromeMode = useSelector(
    (state: RootState) => state.editor.frameChromeMode as 'soft' | 'full'
  );
  const activeFrameId = useSelector(
    (state: RootState) => state.editor.document?.activeFrameId as string | null
  );
  const canvasAttachPick = useSelector(
    (state: RootState) =>
      state.editor.canvasAttachPick as null | { target: string; accept?: 'image' | 'media' }
  );
  const attachPickActive = Boolean(canvasAttachPick?.target);
  const onAddToChatRef = useRef(onAddToChat);
  onAddToChatRef.current = onAddToChat;
  const [movingFrameId, setMovingFrameId] = useState<string | null>(null);
  const [frameSmartGuides, setFrameSmartGuides] = useState<SmartGuideLine[]>([]);
  const [selectionTransforming, setSelectionTransforming] = useState(false);
  const frameDragRef = useRef<{
    frames: Array<{
      id: string;
      startX: number;
      startY: number;
      width: number;
      height: number;
    }>;
    childOrigins: Array<{ nodeId: string; x: number; y: number; width: number; height: number }>;
  } | null>(null);
  const frameMoveDocumentRef = useRef<SceneDocument | null>(document);

  const onCommitFrame = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      dispatch(addArtboardFrame(rect));
      dispatch(setActiveTool('select'));
      dispatch(setSelectedNodeIds([]));
    },
    [dispatch]
  );

  const onMoveFrame = useCallback(
    (id: string, x: number, y: number, opts?: { skipGrid?: boolean; axisLock?: 'h' | 'v' }) => {
      const frame = frames.find((f) => f.id === id);
      const dragState = frameDragRef.current;
      const dragged = dragState?.frames.find((item) => item.id === id);
      if (!frame && !dragged) return;
      const baseFrame = frame || frames.find((item) => item.id === dragged?.id);
      if (!baseFrame) return;

      const movedFrames =
        dragState?.frames ||
        [
          {
            id,
            startX: Number(baseFrame.x) || 0,
            startY: Number(baseFrame.y) || 0,
            width: Math.max(1, Number(baseFrame.width) || 1),
            height: Math.max(1, Number(baseFrame.height) || 1),
          },
        ];
      const primary = dragged ?? movedFrames[0];
      const baseX = primary.startX;
      const baseY = primary.startY;
      const rawDx = x - baseX;
      const rawDy = y - baseY;

      const movedFrameIds = new Set(movedFrames.map((item) => item.id));
      const threshold = smartSnapThreshold(camera.zoom);
      const movedChildIds = new Set([
        ...nodeIdsBoundToFrames(document, [...movedFrameIds]),
        ...(dragState?.childOrigins.map((item) => item.nodeId) ?? []),
      ]);
      const excludeIds = new Set<string>([
        ...movedChildIds,
        ...[...movedFrameIds, id].flatMap((frameId) => [frameId, frameSelId(frameId)]),
      ]);

      const origins = movedFrames.map((item) => ({
        nodeId: frameSelId(item.id),
        box: {
          left: item.startX,
          top: item.startY,
          width: item.width,
          height: item.height,
        },
      }));
      const startUnion =
        unionOfBoxes(origins.map((item) => item.box)) ?? origins[0].box;
      const listNodeIds = () => listNodeIdsFromDoc(document);
      const getNodeBox = (nodeId: string) => getNodeBoxFromDoc(document, nodeId);

      const { sdx, sdy, guides } = computeMovedUnion({
        union: startUnion,
        origins,
        document,
        dx: rawDx,
        dy: rawDy,
        disableSnap: false,
        gridSize: opts?.skipGrid ? 0 : gridSize,
        axisLock: opts?.axisLock,
        targets: smartGuideTargetsForDrag({
          document,
          listNodeIds,
          getNodeBox,
          excludeIds,
          nearBox: {
            left: startUnion.left + rawDx,
            top: startUnion.top + rawDy,
            width: startUnion.width,
            height: startUnion.height,
          },
          threshold,
          queryNodeIdsInRect: (area) =>
            listNodeIds().filter((nodeId) => {
              const box = getNodeBox(nodeId);
              if (!box) return false;
              const right = box.left + box.width;
              const bottom = box.top + box.height;
              return !(
                right < area.left ||
                box.left > area.left + area.width ||
                bottom < area.top ||
                box.top > area.top + area.height
              );
            }),
        }),
        threshold,
      });

      setFrameSmartGuides(guides);
      const dx = Math.round(sdx);
      const dy = Math.round(sdy);
      let childPatches: Array<{
        nodeId: string;
        patch: { x: number; y: number };
      }> = [];
      if (dx !== 0 || dy !== 0) {
        const origins = dragState?.childOrigins || [];
        childPatches = origins.map(({ nodeId, x, y }) => ({
          nodeId,
          patch: { x: x + dx, y: y + dy },
        }));
        const previewFrames = frames.map((item) => {
          const moved = movedFrames.find((entry) => entry.id === item.id);
          if (!moved) return item;
          return { ...item, x: moved.startX + dx, y: moved.startY + dy };
        });
        const previewDocument = { ...document, frames: previewFrames };
        const sharedNodeEls = getSharedNodeEls();
        const nodeEls = sharedNodeEls instanceof Map
          ? sharedNodeEls
          : new Map<string, SVGElement>();
        for (const origin of origins) {
          const node = document.deltaSetLike?.[origin.nodeId];
          const el = nodeEls.get(origin.nodeId);
          if (!node || !el) continue;
          const left = origin.x + dx;
          const top = origin.y + dy;
          previewSvgNodeGeometry(nodeEls, origin.nodeId, {
            left,
            top,
            width: origin.width,
            height: origin.height,
          });
          const previewNode = { ...node, x: left, y: top };
          if (el.ownerSVGElement) {
            syncFrameContentClip(el.ownerSVGElement, el, previewDocument, previewNode, {
              zoom: camera.zoom,
              revealOverflow: shapeHostRevealsOverflow(origin.nodeId),
            });
          }
        }
        // Re-evaluate clipping for every mounted node against the preview frame
        // position. Otherwise overflow appears only after pointer-up/remount.
        for (const [nodeId, el] of nodeEls.entries()) {
          const node = document.deltaSetLike?.[nodeId];
          if (!node || !el.ownerSVGElement) continue;
          const moved = childPatches.find((patch) => patch.nodeId === nodeId)?.patch;
          const previewNode = moved ? { ...node, ...moved } : node;
          syncFrameContentClip(el.ownerSVGElement, el, previewDocument, previewNode, {
            zoom: camera.zoom,
            revealOverflow: shapeHostRevealsOverflow(nodeId),
          });
        }
        for (const moved of movedFrames) {
          previewArtboardFrameGeometry({
            id: moved.id,
            x: moved.startX + dx,
            y: moved.startY + dy,
            width: moved.width,
            height: moved.height,
          });
        }
      }
      const nextDelta = { ...(document.deltaSetLike || {}) };
      for (const item of childPatches) {
        const node = nextDelta[item.nodeId];
        if (node) nextDelta[item.nodeId] = { ...node, ...item.patch };
      }
      const nextDocument = {
        ...document,
        deltaSetLike: nextDelta,
        frames: frames.map((item) => {
          const moved = movedFrames.find((entry) => entry.id === item.id);
          if (!moved) return item;
          return { ...item, x: moved.startX + dx, y: moved.startY + dy };
        }),
      };
      frameMoveDocumentRef.current = nextDocument;
      const spatial = getSharedSceneSpatialRuntime();
      if (spatial && childPatches.length) {
        spatial.patchNodes(
          nextDocument,
          childPatches.map((item) => item.nodeId)
        );
      }
      dispatch(setDocumentFromCanvas(nextDocument));
    },
    [camera.zoom, dispatch, document, frames, gridSize]
  );

  const onFrameMoveStart = useCallback(
    (frameId: string) => {
      const frameIds = selectedFrameIds.includes(frameId) ? selectedFrameIds : [frameId];
      const movedFrames = frames
        .filter((item) => frameIds.includes(item.id))
        .map((item) => ({
          id: item.id,
          startX: Number(item.x) || 0,
          startY: Number(item.y) || 0,
          width: Math.max(1, Number(item.width) || 1),
          height: Math.max(1, Number(item.height) || 1),
      }));
      if (movedFrames.length) {
        frameMoveDocumentRef.current = document;
        setFrameSmartGuides([]);
        const boundNodeIds = nodeIdsBoundToFrames(document, frameIds);
        const interiorNodeIds = nodeIdsOverlappingFrames(document, movedFrames);
        const coMoveIds = [...new Set([...boundNodeIds, ...interiorNodeIds])];
        const childOrigins = coMoveIds
          .map((nodeId) => {
            const node = document.deltaSetLike?.[nodeId];
            if (!node) return null;
            return {
              nodeId,
              x: Number(node.x) || 0,
              y: Number(node.y) || 0,
              width: Math.max(1, Number(node.width) || 1),
              height: Math.max(1, Number(node.height) || 1),
            };
          })
          .filter(Boolean) as Array<{
            nodeId: string;
            x: number;
            y: number;
            width: number;
            height: number;
          }>;
        frameDragRef.current = {
          frames: movedFrames,
          childOrigins,
        };
      }
      setMovingFrameId(frameId);
      dispatch(pushEditorHistory());
    },
    [dispatch, document, frames, selectedFrameIds]
  );

  const onFrameMoveEnd = useCallback(() => {
    const frameIds = frameDragRef.current?.frames.map((item) => item.id) || [];
    if (frameIds.length) {
      const liveDocument = frameMoveDocumentRef.current || document;
      const next = bindUnownedNodesToFrames(liveDocument, frameIds);
      if (next !== liveDocument) {
        dispatch(setDocumentFromCanvas(next));
      }
    }
    frameDragRef.current = null;
    frameMoveDocumentRef.current = document;
    setFrameSmartGuides([]);
    setMovingFrameId(null);
  }, [dispatch, document]);

  const onSelectFrame = useCallback(
    (id: string, opts?: { chrome?: 'soft' | 'full' }) => {
      // Mirror SvgCanvas.onSelectFrame — title label must complete attach-pick.
      // Without this, clicking a vector artboard title only shows chrome while
      //「从画布选择」stays armed and nothing lands in the composer.
      const pick = canvasAttachPick;
      if (pick?.target) {
        const payload = `frame:${id}`;
        if (pick.target === 'agent') {
          onAddToChatRef.current?.(payload);
        } else {
          dispatch(setPendingCanvasAttach({ target: pick.target, payload }));
        }
        dispatch(clearCanvasAttachPick());
        return;
      }
      dispatch(setActiveFrameId(id));
      dispatch(setFrameChromeMode(opts?.chrome === 'soft' ? 'soft' : 'full'));
    },
    [dispatch, canvasAttachPick]
  );

  const onRenameFrame = useCallback(
    (id: string, name: string, options?: { skipHistory?: boolean }) => {
      dispatch(renameArtboardFrame({ id, name, skipHistory: options?.skipHistory }));
    },
    [dispatch]
  );

  const onCanvasDiffuseMeshChange = useCallback(
    (next: FillGradient) => {
      dispatch(
        setCanvasMeta(
          canvasFillToDocumentMeta(
            {
              ...canvasFillValue,
              fillType: 'diffuse',
              fillGradient: serializeFillGradient(next),
              fillColor: next.meshPoints?.[0]?.color || canvasFillValue.fillColor,
            },
            false
          )
        )
      );
    },
    [canvasFillValue, dispatch]
  );

  const selectedFrameBox = useMemo(() => frameUnionBox(selectedFrames), [selectedFrames]);

  if (isMobileViewport || !document) return null;

  const showCanvasDiffuseMesh =
    canvasBgOpen && canvasFillValue.fillType === 'diffuse';
  const showFrameToolbar =
    !isDevMode &&
    canvasApplyLock <= 0 &&
    frameChromeMode === 'full' &&
    selectedFrames.length >= 1 &&
    selectedNodeIds.length === 0 &&
    Boolean(selectedFrameBox) &&
    !selectedFrames.some((frame) => frame.id === movingFrameId) &&
    !selectionTransforming;
  const showMultiFrameToolbar = showFrameToolbar && selectedFrames.length > 1;
  const aiNodeBox = aiOperationState?.active
    ? aiNodeWorldBox(document, aiOperationState.nodeId)
    : null;
  const aiNodeCaption = aiOperationState?.label || undefined;

  return (
    <div
      className="relative min-h-0 flex-1"
      onPointerDown={blurStageEditableOnPointerDown}
    >
      <RcbCanvas
        artboard={worldBounds}
        camera={camera}
        onCameraChange={onCameraChange}
        panMode={panMode}
        emptyDragPans={canvasApplyLock > 0}
        panBlockSelector={EDITOR_PAN_BLOCK_SELECTOR}
        background={stageBackground}
        stageRef={stageRef}
        onViewportEl={onViewportEl}
        cursor={canvasCursor}
        defs={<RcbSvgDefs />}
        gridSize={gridSize}
      >
        {frames.map((frame) =>
          frame.hidden ? null : (
            <HtmlArtboardFrame
              key={`body-${frame.id}`}
              frame={frame}
              zIndex={stackZIndex(document, 'frame', frame.id)}
              selected={
                !isDevMode &&
                frameChromeMode === 'full' &&
                selectedFrameIds.includes(frame.id)
              }
              highlighted={
                !isDevMode &&
                frameChromeMode === 'soft' &&
                (activeFrameId === frame.id || selectedFrameIds.includes(frame.id))
              }
              layer="body"
              aiGenerating={frameShowsAiOverlay(frame, aiOperationState)}
            />
          )
        )}

        <SvgCanvas
          document={canvasDocument}
          reloadToken={sceneReloadToken}
          documentPatchToken={documentPatchToken}
          lastPatchedNodeIds={lastPatchedNodeIds}
          lastPatchTransformOnly={lastPatchTransformOnly}
          selectedNodeId={selectedNodeId}
          selectedNodeIds={selectedNodeIds}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onReady={onCanvasReady}
          onTransformingChange={setSelectionTransforming}
          onFrameMoveStart={onFrameMoveStart}
          onFrameMoveEnd={onFrameMoveEnd}
          onFrameMove={onMoveFrame}
          embedded
          stageEl={stageEl}
          onOpenAgent={onOpenAgent}
          onAddToChat={onAddToChat}
        />

        {frames.map((frame) =>
          frame.hidden ? null : (
            <HtmlArtboardFrame
              key={`process-${frame.id}`}
              frame={frame}
              layer="process"
              aiGenerating={frameShowsAiOverlay(frame, aiOperationState)}
              aiProcessLabel={
                frameShowsAiOverlay(frame, aiOperationState)
                  ? aiOperationState?.label || frame.processLabel
                  : undefined
              }
            />
          )
        )}

        {aiNodeBox ? (
          <AiOperationNodeChrome
            box={aiNodeBox}
            caption={aiNodeCaption}
            zoom={rcbCameraCssZoom(camera)}
          />
        ) : null}

        <SmartGuidesOverlay guides={frameSmartGuides} />

        <ImageProcessWatcher />
        <UploadJobWatcher />
        <GeneratorJobRecoveryHost />
        <ImageToolPanelHost document={document} hidden={selectionTransforming} />
        <ShapeStylePanelHost document={document} hidden={selectionTransforming} />
        <CropExpandSessionHost document={document} hidden={selectionTransforming} />
        <UpscaleSessionHost document={document} hidden={selectionTransforming} />
        <CommercialEditorHosts document={document} selectionTransforming={selectionTransforming} />
        <ImageQuickEditSessionHost document={document} hidden={selectionTransforming} />
        <MarkPinHost document={document} hidden={selectionTransforming} />
        <VideoTrimSessionHost document={document} hidden={selectionTransforming} />
        <LottieComposeSessionHost document={document} hidden={selectionTransforming} />
        <AudioTrimSessionHost document={document} hidden={selectionTransforming} />
        <AudioSpeedSessionHost document={document} hidden={selectionTransforming} />

        {showCanvasDiffuseMesh ? (
          <MeshHandlesOverlay
            box={{
              left: 0,
              top: 0,
              width: worldSurface.width,
              height: worldSurface.height,
            }}
            gradient={canvasDiffuseMeshGradient(canvasFillValue)}
            selectedIndex={canvasMeshSelectedIndex}
            showGuides={canvasMeshShowGuides}
            onActivePointChange={setCanvasMeshSelectedIndex}
            onChange={onCanvasDiffuseMeshChange}
          />
        ) : null}

        {frames.map((frame) =>
          frame.hidden ? null : (
            <HtmlArtboardFrame
              key={`label-${frame.id}`}
              frame={frame}
              selected={
                !isDevMode &&
                frameChromeMode === 'full' &&
                selectedFrameIds.includes(frame.id)
              }
              highlighted={
                !isDevMode &&
                frameChromeMode === 'soft' &&
                (activeFrameId === frame.id || selectedFrameIds.includes(frame.id))
              }
              hideTitle={
                isDevMode ||
                movingFrameId === frame.id ||
                (selectionTransforming &&
                  frameChromeMode === 'full' &&
                  selectedFrameIds.includes(frame.id))
              }
              {...frameLabelInteractionProps(
                frame.id,
                isDevMode,
                {
                  onSelectFrame,
                  onRenameFrame,
                  onMoveFrame,
                  onFrameMoveStart,
                  onFrameMoveEnd,
                },
                attachPickActive
              )}
              layer="label"
            />
          )
        )}

        {showMultiFrameToolbar && selectedFrameBox ? (
          <FrameMultiSelectionToolbar frames={selectedFrames} box={selectedFrameBox} />
        ) : null}

        {showFrameToolbar && !showMultiFrameToolbar && activeFrame && selectedFrameBox ? (
          <FrameContextToolbar
            frame={activeFrame}
            box={selectedFrameBox}
          />
        ) : null}

        <FrameMoveFeature
          enabled={!isDevMode && activeTool === 'select' && !panMode}
          frames={frames}
          camera={camera}
          stageEl={stageEl}
          onSelectFrame={onSelectFrame}
          onMove={onMoveFrame}
          onMoveStart={onFrameMoveStart}
          onMoveEnd={onFrameMoveEnd}
        />

        <FrameDrawFeature
          enabled={!isDevMode && frameMode}
          stageEl={stageEl}
          onCommit={onCommitFrame}
          gridSnap
          gridSize={gridSize}
        />
      </RcbCanvas>
    </div>
  );
}

export default memo(EditorStageWorld);
