/**
 * Bottom canvas dock for Lottie timeline — layers + keyframe tracks.
 * Slides up like left/right docks; top edge drag resizes height.
 * Scene tabs: Main Scene + precomp assets (Rive-style).
 */
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineBars2,
  HiOutlineChevronDown,
  HiOutlineChevronRight,
  HiOutlinePlus,
  HiOutlineTrash,
  HiOutlineXMark,
} from 'react-icons/hi2';
import { Dropdown } from '@/components/base';
import type { MenuItemType } from '@/components/base/dropdown';
import Tooltip from '@/components/base/tooltip';
import { getAgentDockWidth } from '@/components/editor/panels/AgentDock';
import { getLayerDockWidth } from '@/components/editor/panels/LayerPanel';
import { getLottieHost } from '@/components/editor/nodes/LottieNode/LottieNodeOverlay';
import LottieTransportControls from '@/components/editor/nodes/LottieNode/LottieTransportControls';
import LottieTimelineCanvas, {
  LOTTIE_TIMELINE_ROW_H,
} from '@/components/editor/nodes/LottieNode/LottieTimelineCanvas';
import {
  buildLottieTimelineScenes,
  frameToSec,
  secToFrame,
  snapSecToFrame,
  type LottieTimelineLayer,
  type LottieTimelineScene,
} from '@/components/editor/nodes/LottieNode/lottieTimelineModel';
import {
  moveTransformKeyframe,
  parsePropId,
  readTransformKeyframe,
  removeLayerByInd,
  removeTransformKeyframe,
  reorderLayersByInd,
  setCompWorkArea,
  setLayerName,
  setLayerTimeRange,
  setTransformKeyframeEasing,
  setTransformKeyframeValue,
  upsertTransformKeyframe,
  type LottieEasingPreset,
} from '@/components/editor/nodes/LottieNode/lottieTimelineMutate';
import { registerLottieTimelineHotkeyConsumers } from '@/components/editor/nodes/LottieNode/lottieTimelineHotkeys';
import { resolveLottieFrameId } from '@/components/editor/nodes/LottieNode/resolveLottieFrameId';
import { isLottieFrameHostNode } from '@/components/rcb/scene/document/nodeCapabilities';
import { nodeIdsBoundToFrames } from '@/components/rcb/scene/document/sceneClipboard';
import {
  createShapeNode,
  parseLottieAnimationData,
  serializeLottieAnimationData,
} from '@/components/rcb/scene/document/nodeFactories';
import {
  closeLottieTimelinePanel,
  ensureLottieFrameMedia,
  patchDocumentNode,
  patchDocumentNodes,
  removeDocumentNodes,
  setLottiePlayhead,
  setSelectedFrameIds,
  setSelectedNodeIds,
  spawnCreatedNode,
  updateArtboardFrame,
} from '@/store/modules/editor';
import { cn } from '@/utils/classnames';

const DOCK_HEIGHT_KEY = 'lottie-timeline-dock-height';
const DOCK_MIN_H = 160;
const DOCK_MAX_H = 440;
const DOCK_DEFAULT_H = 240;
/** Gap from side docks only — flush to bottom dock edges (no extra left/right pad). */
const DOCK_EDGE_GAP = 0;
const LAYER_COL_W = 236;
const ROW_H = LOTTIE_TIMELINE_ROW_H;
const KF_EPS_SEC = 1 / 60;
const TIME_ZOOM_MIN = 1;
const TIME_ZOOM_MAX = 4;

type KfClipboard = {
  propKey: string;
  value: number | number[];
  hold?: boolean;
};

let kfClipboard: KfClipboard | null = null;

function clampDockHeight(height: number): number {
  const viewportCap =
    typeof window !== 'undefined'
      ? Math.max(DOCK_MIN_H, Math.round(window.innerHeight * 0.55))
      : DOCK_MAX_H;
  return Math.min(DOCK_MAX_H, viewportCap, Math.max(DOCK_MIN_H, Math.round(height)));
}

function writeDockHeight(height: number) {
  try {
    localStorage.setItem(DOCK_HEIGHT_KEY, String(height));
  } catch {
    /* ignore */
  }
}

export function getLottieTimelineDockHeight(): number {
  try {
    const raw = localStorage.getItem(DOCK_HEIGHT_KEY);
    if (!raw) return DOCK_DEFAULT_H;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DOCK_DEFAULT_H;
    return clampDockHeight(n);
  } catch {
    return DOCK_DEFAULT_H;
  }
}

type FlatRow =
  | { kind: 'layer'; layer: LottieTimelineLayer; expanded: boolean }
  | {
      kind: 'prop';
      layer: LottieTimelineLayer;
      propId: string;
      propKey: string;
      label: string;
      times: number[];
    };

function LottieTimelineDock({
  layersOpen,
  agentOpen,
  workspaceMode,
}: {
  layersOpen: boolean;
  agentOpen: boolean;
  workspaceMode: 'design' | 'dev';
}): ReactNode {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const document = useSelector((s: any) => s.editor.document);
  const panel = useSelector(
    (s: any) => s.editor.lottieTimelinePanel as null | { nodeId: string }
  );
  const playhead = useSelector((s: any) => Number(s.editor.lottiePlayheadSec) || 0);
  const selectedNodeIds = useSelector(
    (s: any) => (s.editor.selectedNodeIds as string[]) || []
  );

  const [dockHeight, setDockHeight] = useState(DOCK_DEFAULT_H);
  const [sceneId, setSceneId] = useState('main');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [dragLayerId, setDragLayerId] = useState<string | null>(null);
  const [dropBeforeLayerId, setDropBeforeLayerId] = useState<string | null>(null);
  const dropBeforeRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [leftInset, setLeftInset] = useState(0);
  const [rightInset, setRightInset] = useState(0);
  const [trimPreview, setTrimPreview] = useState<null | {
    layerId: string;
    inSec: number;
    outSec: number;
  }>(null);
  const [snapLinesSec, setSnapLinesSec] = useState<number[]>([]);
  const [selectedKf, setSelectedKf] = useState<null | { propId: string; timeSec: number }>(
    null
  );
  const [kfGhostSec, setKfGhostSec] = useState<number | null>(null);
  const [timeZoom, setTimeZoom] = useState(1);
  const [valueDraft, setValueDraft] = useState<string[]>([]);
  const resizeDragRef = useRef<{ startY: number; startH: number } | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLElement | null>(null);
  const layerScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollSyncLock = useRef(false);
  const kfDragRef = useRef<{
    propId: string;
    fromSec: number;
    pointerId: number;
  } | null>(null);
  const layerDragRef = useRef<{
    layerId: string;
    layerInd: number;
    sceneNodeId?: string;
    mode: 'move' | 'in' | 'out';
    startClientX: number;
    originIn: number;
    originOut: number;
  } | null>(null);
  const [trackScrollTop, setTrackScrollTop] = useState(0);
  const trimPreviewRef = useRef<null | { layerId: string; inSec: number; outSec: number }>(
    null
  );
  const reorderDragRef = useRef<null | {
    layerId: string;
    pointerId: number;
    startY: number;
  }>(null);

  useEffect(() => {
    setDockHeight(getLottieTimelineDockHeight());
  }, []);

  const nodeId = panel?.nodeId ? String(panel.nodeId) : '';
  const node = nodeId ? document?.deltaSetLike?.[nodeId] : null;
  const open = Boolean(nodeId && node?.key === 'lottie');

  // Keep host animationData in sync with 合成台 children (shapes / images).
  const frameChildrenKey = useMemo(() => {
    if (!open || !document || !node) return '';
    const frameId = resolveLottieFrameId(document, node);
    if (!frameId) return '';
    const ids = nodeIdsBoundToFrames(document, [frameId]).filter((id) => {
      const n = document.deltaSetLike?.[id];
      return n && !isLottieFrameHostNode(n, document) && n.key !== 'lottie';
    });
    return ids
      .map((id) => {
        const n = document.deltaSetLike?.[id];
        if (!n) return id;
        return [
          id,
          n.key,
          Math.round(Number(n.x) || 0),
          Math.round(Number(n.y) || 0),
          Math.round(Number(n.width) || 0),
          Math.round(Number(n.height) || 0),
          String(n.attrs?.src || ''),
          String(n.attrs?.['fill-color'] || ''),
          String(n.attrs?.name || ''),
          String(n.attrs?.angle || ''),
          String(n.attrs?.opacity || ''),
          String(n.attrs?.skewX ?? n.attrs?.skew ?? ''),
          String(n.attrs?.skewAxis ?? n.attrs?.skewY ?? ''),
          String(n.attrs?.cornerRadius || ''),
          String(n.attrs?.anchorPreset || ''),
          String(n.attrs?.blendMode || ''),
          String(n.attrs?.lockAspect || ''),
          String(n.attrs?.lottieInFrame ?? ''),
          String(n.attrs?.lottieOutFrame ?? ''),
        ].join(':');
      })
      .join('|');
  }, [open, document, node]);

  useEffect(() => {
    if (!open || !node || !document) return;
    const frameId = resolveLottieFrameId(document, node);
    if (!frameId) return;
    dispatch(ensureLottieFrameMedia({ frameId }));
  }, [open, frameChildrenKey, dispatch, document, node]);

  const loop = !(
    node?.attrs?.lottieLoop === false ||
    node?.attrs?.lottieLoop === 'false' ||
    node?.attrs?.lottieLoop === 0 ||
    node?.attrs?.lottieLoop === '0'
  );

  const animationData = useMemo(
    () => parseLottieAnimationData(node?.attrs?.animationData),
    [node?.attrs?.animationData]
  );

  const scenes = useMemo(
    () =>
      buildLottieTimelineScenes(animationData, String(node?.attrs?.name || 'Lottie'), {
        includeEmptyProps: true,
      }),
    [animationData, node?.attrs?.name]
  );

  useEffect(() => {
    if (!scenes.length) return;
    if (!scenes.some((s) => s.id === sceneId)) setSceneId(scenes[0].id);
  }, [scenes, sceneId]);

  const activeScene: LottieTimelineScene | null =
    scenes.find((s) => s.id === sceneId) || scenes[0] || null;
  const fps = Math.max(1, activeScene?.fr || 30);
  const workInSec = activeScene ? frameToSec(activeScene.ip, fps) : 0;
  const workOutSec = activeScene
    ? frameToSec(activeScene.op, fps)
    : Math.max(1, workInSec + 1);
  const compDuration = Math.max(0.1, workOutSec - workInSec);
  const [spanSec, setSpanSec] = useState(5);
  const [workAreaPreview, setWorkAreaPreview] = useState<null | {
    inSec: number;
    outSec: number;
  }>(null);
  const workAreaDragRef = useRef<null | {
    edge: 'in' | 'out';
    startClientX: number;
    originIn: number;
    originOut: number;
  }>(null);
  const duration = Math.max(0.1, spanSec);

  useEffect(() => {
    const sync = () => {
      const leftEl = window.document.querySelector(
        '[data-editor-left-dock]'
      ) as HTMLElement | null;
      const rightEl = window.document.querySelector(
        '[data-editor-right-dock]'
      ) as HTMLElement | null;
      setLeftInset(
        layersOpen
          ? Math.round(leftEl?.getBoundingClientRect().width || getLayerDockWidth())
          : 0
      );
      const rightOpen = workspaceMode === 'design' && agentOpen;
      setRightInset(
        rightOpen
          ? Math.round(rightEl?.getBoundingClientRect().width || getAgentDockWidth())
          : 0
      );
    };
    sync();
    const observer = new ResizeObserver(sync);
    const leftEl = window.document.querySelector('[data-editor-left-dock]');
    const rightEl = window.document.querySelector('[data-editor-right-dock]');
    if (leftEl) observer.observe(leftEl);
    if (rightEl) observer.observe(rightEl);
    window.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [layersOpen, agentOpen, workspaceMode]);

  const rows: FlatRow[] = useMemo(() => {
    if (!activeScene) return [];
    const out: FlatRow[] = [];
    for (const layer of activeScene.layers) {
      // Default collapsed so track bars read as solid clips (expand for keyframes).
      const isOpen = expanded[layer.id] === true;
      out.push({ kind: 'layer', layer, expanded: isOpen });
      if (!isOpen) continue;
      for (const prop of layer.props) {
        out.push({
          kind: 'prop',
          layer,
          propId: prop.id,
          propKey: prop.key,
          label: prop.label,
          times: prop.times,
        });
      }
    }
    return out;
  }, [activeScene, expanded]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => layerScrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
  });

  // Mirror canvas selection onto the timeline layer highlight.
  useEffect(() => {
    if (!activeScene) return;
    const nodeId = selectedNodeIds[0];
    if (!nodeId) return;
    const match = activeScene.layers.find((layer) => layer.sceneNodeId === nodeId);
    if (match) setSelectedLayerId(match.id);
  }, [activeScene, selectedNodeIds]);

  const commitAnimation = useCallback(
    (nextAnim: Record<string, unknown> | null) => {
      if (!nextAnim || !nodeId) return;
      const json = serializeLottieAnimationData(nextAnim);
      if (!json) return;
      dispatch(
        patchDocumentNode({
          nodeId,
          patch: { attrs: { animationData: json } },
        })
      );
    },
    [dispatch, nodeId]
  );

  const selectTimelineLayer = useCallback(
    (layer: LottieTimelineLayer) => {
      setSelectedLayerId(layer.id);
      if (layer.sceneNodeId) {
        dispatch(setSelectedFrameIds([]));
        dispatch(setSelectedNodeIds([layer.sceneNodeId]));
      }
    },
    [dispatch]
  );

  const commitLayerRename = useCallback(
    (layer: LottieTimelineLayer, nextName: string) => {
      setRenamingLayerId(null);
      const name = nextName.trim();
      if (!name || name === layer.name) return;
      if (layer.sceneNodeId) {
        dispatch(
          patchDocumentNode({
            nodeId: layer.sceneNodeId,
            patch: { attrs: { name } },
          })
        );
        return;
      }
      if (!animationData || !activeScene) return;
      commitAnimation(
        setLayerName({
          animationData,
          sceneKind: activeScene.kind,
          assetId: activeScene.assetId,
          layerInd: layer.ind,
          name,
        })
      );
    },
    [activeScene, animationData, commitAnimation, dispatch]
  );

  const artboardFrameId = useMemo(() => {
    if (!document || !node) return null;
    return resolveLottieFrameId(document, node);
  }, [document, node]);

  const artboardFrame = useMemo(() => {
    if (!artboardFrameId || !document) return null;
    const frames = Array.isArray(document.frames) ? document.frames : [];
    return frames.find((f: any) => String(f?.id) === artboardFrameId) || null;
  }, [artboardFrameId, document]);

  useEffect(() => {
    const frameSpan = Math.max(0.5, Number(artboardFrame?.durationSec) || 0);
    setSpanSec((prev) => Math.max(prev, workOutSec, frameSpan, workInSec + 0.5, 1));
  }, [workOutSec, workInSec, artboardFrame?.durationSec]);

  const addTimelineTrack = useCallback(() => {
    if (!artboardFrame || !artboardFrameId || !document) return;
    if (activeScene && activeScene.kind !== 'main') return;
    const bound = nodeIdsBoundToFrames(document, [artboardFrameId]).filter((id) => {
      const n = document.deltaSetLike?.[id];
      return n && !isLottieFrameHostNode(n, document) && n.key !== 'lottie';
    });
    let maxOrder = -1;
    for (const id of bound) {
      const o = Number(document.deltaSetLike?.[id]?.attrs?.frameOrder);
      if (Number.isFinite(o)) maxOrder = Math.max(maxOrder, o);
    }
    const sceneFps = Math.max(1, Number(activeScene?.fr) || Number(artboardFrame.fps) || 30);
    const sceneDur = Math.max(
      0.5,
      Number(activeScene?.durationSec) || Number(artboardFrame.durationSec) || 5
    );
    // videoEditor-style: new clip is a short segment from playhead, not full composition.
    const clipSec = Math.min(2, Math.max(0.5, sceneDur * 0.4));
    const inFrame = Math.max(0, Math.round(playhead * sceneFps));
    const outFrame = Math.min(
      Math.round(sceneDur * sceneFps),
      Math.max(inFrame + Math.round(sceneFps * 0.25), inFrame + Math.round(clipSec * sceneFps))
    );
    const w = Math.max(40, Math.round(Math.min(120, Number(artboardFrame.width) * 0.35)));
    const h = Math.max(28, Math.round(Math.min(80, Number(artboardFrame.height) * 0.25)));
    const x = Number(artboardFrame.x) + Math.max(16, (Number(artboardFrame.width) - w) / 2);
    const y = Number(artboardFrame.y) + Math.max(16, (Number(artboardFrame.height) - h) / 2);
    const { id, node: shape } = createShapeNode({
      x,
      y,
      width: w,
      height: h,
      shapeType: 'rect',
      fill: '#3B82F6',
      stroke: 'transparent',
      borderWidth: 0,
    });
    shape.attrs = {
      ...(shape.attrs || {}),
      frameId: artboardFrameId,
      frameOrder: maxOrder + 1,
      name: `Layer ${bound.length + 1}`,
      lockAspect: 'false',
      lottieInFrame: inFrame,
      lottieOutFrame: outFrame,
    };
    dispatch(spawnCreatedNode({ id, node: shape }));
    dispatch(ensureLottieFrameMedia({ frameId: artboardFrameId }));
    dispatch(setSelectedFrameIds([]));
    dispatch(setSelectedNodeIds([id]));
    setSelectedLayerId(null);
  }, [
    activeScene,
    artboardFrame,
    artboardFrameId,
    dispatch,
    document,
    playhead,
  ]);

  const deleteTimelineLayer = useCallback(
    (layer: LottieTimelineLayer) => {
      if (layer.sceneNodeId) {
        dispatch(removeDocumentNodes({ nodeIds: [layer.sceneNodeId] }));
        if (artboardFrameId) dispatch(ensureLottieFrameMedia({ frameId: artboardFrameId }));
      } else if (animationData && activeScene) {
        commitAnimation(
          removeLayerByInd({
            animationData,
            sceneKind: activeScene.kind,
            assetId: activeScene.assetId,
            layerInd: layer.ind,
          })
        );
      }
      if (selectedLayerId === layer.id) setSelectedLayerId(null);
      setSelectedKf(null);
    },
    [
      activeScene,
      animationData,
      artboardFrameId,
      commitAnimation,
      dispatch,
      selectedLayerId,
    ]
  );

  const reorderTimelineLayers = useCallback(
    (fromId: string, beforeId: string | null) => {
      if (!activeScene || fromId === beforeId) return;
      const layers = [...activeScene.layers];
      const fromIdx = layers.findIndex((l) => l.id === fromId);
      if (fromIdx < 0) return;
      const [moved] = layers.splice(fromIdx, 1);
      let toIdx =
        beforeId == null ? layers.length : layers.findIndex((l) => l.id === beforeId);
      if (toIdx < 0) toIdx = layers.length;
      // If removing an item above the insert point, indices already account for splice.
      layers.splice(toIdx, 0, moved);

      if (animationData) {
        commitAnimation(
          reorderLayersByInd({
            animationData,
            sceneKind: activeScene.kind,
            assetId: activeScene.assetId,
            orderedInds: layers.map((l) => l.ind),
          })
        );
      }

      const linked = layers.filter((l) => l.sceneNodeId);
      if (linked.length) {
        // Sync sorts ascending frameOrder then unshifts → highest FO ends top of list.
        const patches = linked.map((l, i) => ({
          nodeId: String(l.sceneNodeId),
          patch: {
            attrs: {
              frameOrder: linked.length - 1 - i,
            },
          },
        }));
        dispatch(patchDocumentNodes({ patches }));
        if (artboardFrameId) dispatch(ensureLottieFrameMedia({ frameId: artboardFrameId }));
      }
      setSelectedLayerId(moved.id);
    },
    [activeScene, animationData, artboardFrameId, commitAnimation, dispatch]
  );

  const beginLayerReorder = useCallback(
    (e: ReactPointerEvent, layerId: string) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      reorderDragRef.current = {
        layerId,
        pointerId: e.pointerId,
        startY: e.clientY,
      };
      dropBeforeRef.current = null;
      setDragLayerId(layerId);
      setDropBeforeLayerId(null);
    },
    []
  );

  const onLayerReorderMove = useCallback(
    (e: ReactPointerEvent) => {
      const drag = reorderDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId || !layerScrollRef.current) return;
      const listTop = layerScrollRef.current.getBoundingClientRect().top;
      const y = e.clientY - listTop + layerScrollRef.current.scrollTop;
      const index = Math.max(0, Math.min(rows.length, Math.floor(y / ROW_H)));
      let beforeId: string | null = null;
      for (let i = index; i < rows.length; i++) {
        const row = rows[i];
        if (row?.kind === 'layer' && row.layer.id !== drag.layerId) {
          beforeId = row.layer.id;
          break;
        }
      }
      dropBeforeRef.current = beforeId;
      setDropBeforeLayerId(beforeId);
    },
    [rows]
  );

  const endLayerReorder = useCallback(
    (e: ReactPointerEvent) => {
      const drag = reorderDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      reorderDragRef.current = null;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const from = drag.layerId;
      const before = dropBeforeRef.current;
      const moved = Math.abs(e.clientY - drag.startY) > 6;
      dropBeforeRef.current = null;
      setDragLayerId(null);
      setDropBeforeLayerId(null);
      if (!moved || !from) return;
      reorderTimelineLayers(from, before);
    },
    [reorderTimelineLayers]
  );

  const seekTo = useCallback(
    (tSec: number, opts?: { pause?: boolean }) => {
      const next = snapSecToFrame(tSec, fps, duration);
      if (opts?.pause !== false) {
        setPlaying(false);
        getLottieHost(nodeId)?.pause();
      }
      dispatch(setLottiePlayhead(next));
      if (!nodeId) return;
      getLottieHost(nodeId)?.seek(next);
    },
    [dispatch, duration, fps, nodeId]
  );

  // Sync playhead from host when the dock opens (don't force t=0).
  useEffect(() => {
    if (!open || !nodeId) return;
    const host = getLottieHost(nodeId);
    if (!host) return;
    const live = host.getCurrentTime();
    if (!Number.isFinite(live)) return;
    dispatch(setLottiePlayhead(snapSecToFrame(live, fps, duration)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open/node only
  }, [open, nodeId]);

  const clientXToSec = useCallback(
    (clientX: number) => {
      const host = canvasHostRef.current;
      if (!host) return 0;
      const scrollEl = host.querySelector(
        '[data-lottie-timeline-scroll]'
      ) as HTMLDivElement | null;
      const box = (scrollEl || host).getBoundingClientRect();
      if (!(box.width > 0)) return 0;
      const contentW = Math.max(1, host.clientWidth) * Math.max(1, timeZoom);
      const x = clientX - box.left + (scrollEl?.scrollLeft || 0);
      const ratio = Math.max(0, Math.min(1, x / contentW));
      return snapSecToFrame(ratio * duration, fps, duration);
    },
    [duration, fps, timeZoom]
  );

  // Drive playhead from the live Lottie host while playing.
  useEffect(() => {
    if (!playing || !open || !nodeId) return;
    const host = getLottieHost(nodeId);
    if (!host) {
      setPlaying(false);
      return;
    }
    if (host.isPaused()) host.play();
    let raf = 0;
    const tick = () => {
      const live = getLottieHost(nodeId);
      if (!live) {
        setPlaying(false);
        return;
      }
      const t = live.getCurrentTime();
      dispatch(setLottiePlayhead(Math.max(0, Math.min(duration, t))));
      if (live.isPaused()) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, open, nodeId, duration, dispatch]);

  const onResizePointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizeDragRef.current = { startY: e.clientY, startH: dockHeight };
    window.document.body.style.cursor = 'row-resize';
  };

  const onResizePointerMove = (e: ReactPointerEvent) => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    setDockHeight(clampDockHeight(drag.startH + (drag.startY - e.clientY)));
  };

  const endResize = (e: ReactPointerEvent) => {
    if (!resizeDragRef.current) return;
    const drag = resizeDragRef.current;
    resizeDragRef.current = null;
    window.document.body.style.cursor = '';
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const next = clampDockHeight(drag.startH + (drag.startY - e.clientY));
    setDockHeight(next);
    writeDockHeight(next);
  };

  const togglePlay = () => {
    if (!nodeId) return;
    const host = getLottieHost(nodeId);
    if (!host) return;
    if (playing || !host.isPaused()) {
      host.pause();
      setPlaying(false);
      dispatch(setLottiePlayhead(snapSecToFrame(host.getCurrentTime(), fps, duration)));
      return;
    }
    const liveIn = workAreaPreview?.inSec ?? workInSec;
    const liveOut = workAreaPreview?.outSec ?? workOutSec;
    if (playhead >= liveOut - 1e-3 || playhead < liveIn - 1e-3) host.seek(liveIn);
    else host.seek(playhead);
    host.play();
    setPlaying(true);
  };
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;

  const deleteSelectedKf = useCallback((): boolean => {
    if (!selectedKf || !animationData || !activeScene) return false;
    const parsed = parsePropId(selectedKf.propId);
    if (!parsed) return false;
    commitAnimation(
      removeTransformKeyframe({
        animationData,
        sceneKind: activeScene.kind,
        assetId: activeScene.assetId,
        layerInd: parsed.layerInd,
        propKey: parsed.propKey,
        frame: secToFrame(selectedKf.timeSec, fps),
      })
    );
    setSelectedKf(null);
    return true;
  }, [selectedKf, animationData, activeScene, commitAnimation, fps]);

  const deleteSelectedTrackOrKf = useCallback((): boolean => {
    if (selectedKf) return deleteSelectedKf();
    if (!selectedLayerId || !activeScene) return false;
    const layer = activeScene.layers.find((l) => l.id === selectedLayerId);
    if (!layer) return false;
    deleteTimelineLayer(layer);
    return true;
  }, [selectedKf, selectedLayerId, activeScene, deleteSelectedKf, deleteTimelineLayer]);

  const copySelectedKf = useCallback((): boolean => {
    if (!selectedKf || !animationData || !activeScene) return false;
    const parsed = parsePropId(selectedKf.propId);
    if (!parsed) return false;
    const payload = readTransformKeyframe({
      animationData,
      sceneKind: activeScene.kind,
      assetId: activeScene.assetId,
      layerInd: parsed.layerInd,
      propKey: parsed.propKey,
      frame: secToFrame(selectedKf.timeSec, fps),
    });
    if (!payload) return false;
    kfClipboard = payload;
    return true;
  }, [selectedKf, animationData, activeScene, fps]);

  const pasteKfAtPlayhead = useCallback((): boolean => {
    if (!kfClipboard || !animationData || !activeScene) return false;
    const targetPropId = selectedKf?.propId;
    if (!targetPropId) return false;
    const parsed = parsePropId(targetPropId);
    if (!parsed) return false;
    // Paste onto the selected track (same prop family when keys match, else selected track).
    const propKey =
      parsed.propKey === kfClipboard.propKey ? parsed.propKey : parsed.propKey;
    const frame = secToFrame(playhead, fps);
    let next = upsertTransformKeyframe({
      animationData,
      sceneKind: activeScene.kind,
      assetId: activeScene.assetId,
      layerInd: parsed.layerInd,
      propKey,
      frame,
      value: kfClipboard.value,
    });
    if (!next) return false;
    if (kfClipboard.hold) {
      next =
        setTransformKeyframeEasing({
          animationData: next,
          sceneKind: activeScene.kind,
          assetId: activeScene.assetId,
          layerInd: parsed.layerInd,
          propKey,
          frame,
          preset: 'hold',
        }) || next;
    }
    commitAnimation(next);
    setSelectedKf({ propId: targetPropId, timeSec: playhead });
    return true;
  }, [
    animationData,
    activeScene,
    selectedKf,
    playhead,
    fps,
    commitAnimation,
  ]);

  useEffect(() => {
    if (!open) return undefined;
    return registerLottieTimelineHotkeyConsumers({
      onDelete: () => deleteSelectedTrackOrKf(),
      onCopy: () => copySelectedKf(),
      onPaste: () => pasteKfAtPlayhead(),
      onSpace: () => {
        togglePlayRef.current();
        return true;
      },
    });
  }, [open, deleteSelectedTrackOrKf, copySelectedKf, pasteKfAtPlayhead]);

  // Keep value inspector in sync with selected keyframe.
  useEffect(() => {
    if (!selectedKf || !animationData || !activeScene) {
      setValueDraft([]);
      return;
    }
    const parsed = parsePropId(selectedKf.propId);
    if (!parsed) {
      setValueDraft([]);
      return;
    }
    const payload = readTransformKeyframe({
      animationData,
      sceneKind: activeScene.kind,
      assetId: activeScene.assetId,
      layerInd: parsed.layerInd,
      propKey: parsed.propKey,
      frame: secToFrame(selectedKf.timeSec, fps),
    });
    if (!payload) {
      setValueDraft([]);
      return;
    }
    const vals = Array.isArray(payload.value) ? payload.value : [payload.value];
    setValueDraft(vals.map((v) => String(Number(v.toFixed(3)))));
  }, [selectedKf, animationData, activeScene, fps, node?.attrs?.animationData]);

  const syncScroll = (source: 'layer' | 'track') => {
    if (scrollSyncLock.current) return;
    scrollSyncLock.current = true;
    if (source === 'layer') {
      const y = layerScrollRef.current?.scrollTop ?? 0;
      setTrackScrollTop(y);
    }
    requestAnimationFrame(() => {
      scrollSyncLock.current = false;
    });
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const dock = dockRef.current;
      if (!dock) return;
      const active = window.document.activeElement;
      const focusedInside = Boolean(active && dock.contains(active));
      if (!focusedInside && !dock.matches(':hover')) return;

      if (e.code === 'Space' || e.key === ' ') {
        // Play/pause is owned by tryConsumeLottieTimelineSpace (canvas capture).
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        const step = e.shiftKey ? 10 : 1;
        seekTo(playhead + (dir * step) / fps, { pause: true });
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        seekTo(0, { pause: true });
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        seekTo(duration, { pause: true });
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedKf) {
        e.preventDefault();
        e.stopPropagation();
        deleteSelectedKf();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'c') {
        if (copySelectedKf()) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        if (pasteKfAtPlayhead()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    // Capture so we win against canvas Space/Delete before bubble handlers.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [
    open,
    playhead,
    fps,
    duration,
    seekTo,
    selectedKf,
    deleteSelectedKf,
    copySelectedKf,
    pasteKfAtPlayhead,
  ]);

  const toggleLoop = () => {
    if (!nodeId) return;
    const next = !loop;
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: { attrs: { lottieLoop: next ? 'true' : 'false' } },
      })
    );
    getLottieHost(nodeId)?.setLoop(next);
  };

  const toggleKeyframeAtPlayhead = (layerInd: number, propKey: string, times: number[]) => {
    if (!animationData || !activeScene) return;
    const frame = secToFrame(playhead, fps);
    const has = times.some((time) => Math.abs(time - playhead) <= Math.max(KF_EPS_SEC, 0.5 / fps));
    const next = has
      ? removeTransformKeyframe({
          animationData,
          sceneKind: activeScene.kind,
          assetId: activeScene.assetId,
          layerInd,
          propKey,
          frame,
        })
      : upsertTransformKeyframe({
          animationData,
          sceneKind: activeScene.kind,
          assetId: activeScene.assetId,
          layerInd,
          propKey,
          frame,
        });
    commitAnimation(next);
  };

  const computeLayerTrim = (
    mode: 'move' | 'in' | 'out',
    originIn: number,
    originOut: number,
    deltaSec: number
  ) => {
    const span = Math.max(1 / fps, originOut - originIn);
    if (mode === 'move') {
      let inSec = snapSecToFrame(originIn + deltaSec, fps, duration);
      let outSec = snapSecToFrame(inSec + span, fps, duration);
      if (outSec - inSec < 1 / fps) outSec = snapSecToFrame(inSec + 1 / fps, fps, duration);
      if (outSec > duration) {
        outSec = duration;
        inSec = snapSecToFrame(Math.max(0, outSec - span), fps, duration);
      }
      if (inSec < 0) {
        inSec = 0;
        outSec = snapSecToFrame(Math.min(duration, span), fps, duration);
      }
      return { inSec, outSec };
    }
    if (mode === 'in') {
      const inSec = snapSecToFrame(
        Math.min(originOut - 1 / fps, Math.max(0, originIn + deltaSec)),
        fps,
        duration
      );
      return { inSec, outSec: originOut };
    }
    const outSec = snapSecToFrame(
      Math.max(originIn + 1 / fps, Math.min(duration, originOut + deltaSec)),
      fps,
      duration
    );
    return { inSec: originIn, outSec };
  };

  const trackWidthPx = useCallback(() => {
    const el = canvasHostRef.current;
    if (!el) return 0;
    const box = el.getBoundingClientRect();
    if (!(box.width > 0)) return 0;
    return box.width * Math.max(1, timeZoom);
  }, [timeZoom]);

  const beginClipDrag = useCallback(
    (
      e: { clientX: number },
      layer: LottieTimelineLayer,
      mode: 'move' | 'in' | 'out'
    ) => {
      selectTimelineLayer(layer);
      setPlaying(false);
      getLottieHost(nodeId)?.pause();
      const dragState = {
        layerId: layer.id,
        layerInd: layer.ind,
        sceneNodeId: layer.sceneNodeId,
        mode,
        startClientX: e.clientX,
        originIn: layer.inSec,
        originOut: layer.outSec,
      };
      layerDragRef.current = dragState;
      const initial = { layerId: layer.id, inSec: layer.inSec, outSec: layer.outSec };
      trimPreviewRef.current = initial;
      setTrimPreview(initial);
      setSnapLinesSec([]);

      const snapThreshold = Math.max(0.05, 2 / Math.max(1, fps));
      const collectSnapPoints = (excludeLayerId: string) => {
        const points: number[] = [0, duration];
        for (const l of activeScene?.layers || []) {
          if (l.id === excludeLayerId) continue;
          points.push(l.inSec, l.outSec);
        }
        return points;
      };
      const snapValue = (raw: number, points: number[]) => {
        let best = raw;
        let min = snapThreshold;
        let line: number | null = null;
        for (const p of points) {
          const d = Math.abs(raw - p);
          if (d < min) {
            min = d;
            best = p;
            line = p;
          }
        }
        return { value: best, line };
      };

      const onMove = (ev: MouseEvent) => {
        const drag = layerDragRef.current;
        if (!drag) return;
        const width = trackWidthPx();
        if (!(width > 0)) return;
        const deltaSec = ((ev.clientX - drag.startClientX) / width) * duration;
        let next = computeLayerTrim(drag.mode, drag.originIn, drag.originOut, deltaSec);
        const points = collectSnapPoints(drag.layerId);
        if (drag.mode === 'in') {
          const s = snapValue(next.inSec, points);
          next = { ...next, inSec: Math.min(next.outSec - 1 / fps, Math.max(0, s.value)) };
          setSnapLinesSec(s.line != null ? [s.line] : []);
        } else if (drag.mode === 'out') {
          const s = snapValue(next.outSec, points);
          next = {
            ...next,
            outSec: Math.max(next.inSec + 1 / fps, Math.min(duration, s.value)),
          };
          setSnapLinesSec(s.line != null ? [s.line] : []);
        } else {
          const sIn = snapValue(next.inSec, points);
          const sOut = snapValue(next.outSec, points);
          if (
            sIn.line != null &&
            (sOut.line == null ||
              Math.abs(sIn.value - next.inSec) <= Math.abs(sOut.value - next.outSec))
          ) {
            const span = next.outSec - next.inSec;
            const inSec = Math.max(0, Math.min(duration - span, sIn.value));
            next = { inSec, outSec: inSec + span };
            setSnapLinesSec([sIn.line]);
          } else if (sOut.line != null) {
            const span = next.outSec - next.inSec;
            const outSec = Math.max(span, Math.min(duration, sOut.value));
            next = { inSec: outSec - span, outSec };
            setSnapLinesSec([sOut.line]);
          } else {
            setSnapLinesSec([]);
          }
        }
        const preview = { layerId: drag.layerId, inSec: next.inSec, outSec: next.outSec };
        trimPreviewRef.current = preview;
        setTrimPreview(preview);
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const drag = layerDragRef.current;
        layerDragRef.current = null;
        setSnapLinesSec([]);
        const preview = trimPreviewRef.current;
        trimPreviewRef.current = null;
        setTrimPreview(null);
        if (!drag || !preview || !animationData || !activeScene) return;
        if (
          Math.abs(preview.inSec - drag.originIn) < 1e-6 &&
          Math.abs(preview.outSec - drag.originOut) < 1e-6
        ) {
          return;
        }
        const inFrame = secToFrame(preview.inSec, fps);
        const outFrame = secToFrame(preview.outSec, fps);
        commitAnimation(
          setLayerTimeRange({
            animationData,
            sceneKind: activeScene.kind,
            assetId: activeScene.assetId,
            layerInd: drag.layerInd,
            inFrame,
            outFrame,
          })
        );
        if (drag.sceneNodeId) {
          dispatch(
            patchDocumentNode({
              nodeId: drag.sceneNodeId,
              patch: {
                attrs: {
                  lottieInFrame: inFrame,
                  lottieOutFrame: outFrame,
                },
              },
            })
          );
        }
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [
      activeScene,
      animationData,
      commitAnimation,
      dispatch,
      duration,
      fps,
      nodeId,
      selectTimelineLayer,
      trackWidthPx,
    ]
  );

  const beginWorkAreaDrag = useCallback(
    (edge: 'in' | 'out', clientX: number) => {
      if (!activeScene || !animationData) return;
      setPlaying(false);
      getLottieHost(nodeId)?.pause();
      const originIn = workInSec;
      const originOut = workOutSec;
      workAreaDragRef.current = {
        edge,
        startClientX: clientX,
        originIn,
        originOut,
      };
      const previewRef = { current: { inSec: originIn, outSec: originOut } };
      setWorkAreaPreview({ inSec: originIn, outSec: originOut });

      const onMove = (ev: MouseEvent) => {
        const drag = workAreaDragRef.current;
        if (!drag) return;
        const width = trackWidthPx();
        if (!(width > 0)) return;
        const deltaSec = ((ev.clientX - drag.startClientX) / width) * duration;
        let inSec = drag.originIn;
        let outSec = drag.originOut;
        if (drag.edge === 'in') {
          inSec = snapSecToFrame(
            Math.min(drag.originOut - 1 / fps, Math.max(0, drag.originIn + deltaSec)),
            fps,
            duration
          );
        } else {
          outSec = snapSecToFrame(
            Math.max(drag.originIn + 1 / fps, drag.originOut + deltaSec),
            fps
          );
          setSpanSec((s) => Math.max(s, outSec + 0.25));
        }
        previewRef.current = { inSec, outSec };
        setWorkAreaPreview({ inSec, outSec });
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        workAreaDragRef.current = null;
        const preview = previewRef.current;
        setWorkAreaPreview(null);
        if (
          Math.abs(preview.inSec - originIn) < 1e-6 &&
          Math.abs(preview.outSec - originOut) < 1e-6
        ) {
          return;
        }
        const inFrame = secToFrame(preview.inSec, fps);
        const outFrame = secToFrame(preview.outSec, fps);
        commitAnimation(
          setCompWorkArea({
            animationData,
            sceneKind: activeScene.kind,
            assetId: activeScene.assetId,
            inFrame,
            outFrame,
          })
        );
        if (activeScene.kind === 'main' && artboardFrameId) {
          dispatch(
            updateArtboardFrame({
              id: artboardFrameId,
              patch: { durationSec: Math.max(0.5, preview.outSec) },
            })
          );
        }
        setSpanSec((s) => Math.max(s, preview.outSec + 0.25));
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [
      activeScene,
      animationData,
      artboardFrameId,
      commitAnimation,
      dispatch,
      duration,
      fps,
      nodeId,
      trackWidthPx,
      workInSec,
      workOutSec,
    ]
  );

  const onKfPointerDown = (
    e: ReactPointerEvent,
    propId: string,
    fromSec: number
  ) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    kfDragRef.current = { propId, fromSec, pointerId: e.pointerId };
    setPlaying(false);
    getLottieHost(nodeId)?.pause();
  };

  const onKfPointerMove = (e: ReactPointerEvent) => {
    const drag = kfDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const next = clientXToSec(e.clientX);
    setKfGhostSec(next);
    dispatch(setLottiePlayhead(next));
  };

  const onKfPointerUp = (e: ReactPointerEvent) => {
    const drag = kfDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    kfDragRef.current = null;
    setKfGhostSec(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!animationData || !activeScene) return;
    const parsed = parsePropId(drag.propId);
    if (!parsed) return;
    const toSec = clientXToSec(e.clientX);
    if (Math.abs(toSec - drag.fromSec) < Math.max(KF_EPS_SEC, 0.5 / fps)) {
      seekTo(drag.fromSec);
      return;
    }
    const next = moveTransformKeyframe({
      animationData,
      sceneKind: activeScene.kind,
      assetId: activeScene.assetId,
      layerInd: parsed.layerInd,
      propKey: parsed.propKey,
      fromFrame: secToFrame(drag.fromSec, fps),
      toFrame: secToFrame(toSec, fps),
    });
    commitAnimation(next);
    seekTo(toSec);
  };

  if (!open || !activeScene) return null;

  const plateName = String(node?.attrs?.name || 'Lottie');

  return (
    <aside
      ref={dockRef}
      tabIndex={0}
      data-editor-bottom-dock=""
      data-lottie-timeline-dock=""
      style={{
        left: leftInset + DOCK_EDGE_GAP,
        right: rightInset + DOCK_EDGE_GAP,
        height: dockHeight,
      }}
      className="pointer-events-auto absolute bottom-0 z-[28] flex flex-col overflow-hidden border-t border-[var(--line)] bg-[var(--surface)] shadow-[0_-8px_28px_rgba(12,12,13,0.12)] outline-none"
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('editor.lottieTimeline.resize', { defaultValue: '调整时间轴高度' })}
        aria-valuemin={DOCK_MIN_H}
        aria-valuemax={DOCK_MAX_H}
        aria-valuenow={dockHeight}
        className="absolute inset-x-0 top-0 z-20 h-1.5 cursor-row-resize touch-none hover:bg-[var(--accent)]/25 active:bg-[var(--accent)]/40"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onDoubleClick={() => {
          setDockHeight(DOCK_DEFAULT_H);
          writeDockHeight(DOCK_DEFAULT_H);
        }}
      />

      <div className="relative flex h-9 shrink-0 items-center border-b border-[var(--line)] px-1">
        <div className="z-[1] flex min-w-0 flex-1 items-end gap-0.5 self-stretch overflow-x-auto pt-1">
          {scenes.map((scene) => {
            const active = scene.id === activeScene.id;
            return (
              <button
                key={scene.id}
                type="button"
                className={cn(
                  'shrink-0 border-b-2 px-2.5 pb-1.5 text-[12px] font-medium transition-colors',
                  active
                    ? 'border-[var(--brand)] text-[var(--ink)]'
                    : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)]'
                )}
                onClick={() => {
                  setSceneId(scene.id);
                  setPlaying(false);
                  setSelectedKf(null);
                  getLottieHost(nodeId)?.pause();
                }}
              >
                {scene.kind === 'main'
                  ? t('editor.lottieTimeline.mainScene', { defaultValue: 'Main Scene' })
                  : scene.label}
              </button>
            );
          })}
        </div>

        {/* Dead-center transport (Rive-style) */}
        <div className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center">
          <div className="pointer-events-auto flex items-center gap-1 rounded-md bg-[var(--surface)]/90 px-1 backdrop-blur-[2px]">
            <span className="hidden max-w-[7rem] truncate text-[11px] text-[var(--muted)] sm:inline">
              {plateName}
            </span>
            <span className="tabular-nums text-[11px] text-[var(--muted)]">{fps}fps</span>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
              title={t('editor.lottieTimeline.zoomOut', { defaultValue: '缩小时间轴' })}
              aria-label={t('editor.lottieTimeline.zoomOut', { defaultValue: '缩小时间轴' })}
              onClick={() =>
                setTimeZoom((z) => Math.max(TIME_ZOOM_MIN, Math.round((z - 0.5) * 2) / 2))
              }
            >
              −
            </button>
            <span className="min-w-[2rem] text-center text-[10px] tabular-nums text-[var(--muted)]">
              {Math.round(timeZoom * 100)}%
            </span>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
              title={t('editor.lottieTimeline.zoomIn', { defaultValue: '放大时间轴' })}
              aria-label={t('editor.lottieTimeline.zoomIn', { defaultValue: '放大时间轴' })}
              onClick={() =>
                setTimeZoom((z) => Math.min(TIME_ZOOM_MAX, Math.round((z + 0.5) * 2) / 2))
              }
            >
              +
            </button>
            <LottieTransportControls
              playing={playing}
              loop={loop}
              onPlayPause={togglePlay}
              onStepFrame={(dir) => seekTo(playhead + dir / fps, { pause: true })}
              onSeekEdge={(toEnd) =>
                seekTo(toEnd ? workOutSec : workInSec, { pause: true })
              }
              onToggleLoop={toggleLoop}
            />
            <span className="min-w-[5.5rem] tabular-nums text-[11px] text-[var(--muted)]">
              f{Math.round(secToFrame(playhead, fps))}/
              {Math.round(secToFrame(workOutSec, fps))}
            </span>
          </div>
        </div>

        <div className="z-[1] ml-auto flex shrink-0 items-center gap-1">
          {selectedKf && valueDraft.length ? (
            <div className="flex items-center gap-0.5">
              {valueDraft.map((raw, i) => (
                <input
                  key={`${selectedKf.propId}-${i}`}
                  type="text"
                  inputMode="decimal"
                  className="h-7 w-12 rounded-md border border-[var(--line)] bg-[var(--surface)] px-1 text-center text-[11px] tabular-nums text-[var(--ink)] outline-none focus:border-[var(--brand)]"
                  value={raw}
                  aria-label={t('editor.lottieTimeline.kfValue', {
                    defaultValue: '关键帧数值',
                  })}
                  onChange={(ev) => {
                    const next = [...valueDraft];
                    next[i] = ev.target.value;
                    setValueDraft(next);
                  }}
                  onBlur={() => {
                    if (!animationData || !activeScene || !selectedKf) return;
                    const parsed = parsePropId(selectedKf.propId);
                    if (!parsed) return;
                    const nums = valueDraft.map((s) => Number(s));
                    if (nums.some((n) => !Number.isFinite(n))) return;
                    const value = nums.length === 1 ? nums[0] : nums;
                    commitAnimation(
                      setTransformKeyframeValue({
                        animationData,
                        sceneKind: activeScene.kind,
                        assetId: activeScene.assetId,
                        layerInd: parsed.layerInd,
                        propKey: parsed.propKey,
                        frame: secToFrame(selectedKf.timeSec, fps),
                        value,
                      })
                    );
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur();
                  }}
                />
              ))}
            </div>
          ) : null}
          {selectedKf ? (
            <Dropdown
              trigger="click"
              placement="top"
              strategy="fixed"
              floatingClassName="z-[520]"
              referenceClassName="inline-flex"
              items={
                [
                  { key: 'linear', label: 'Linear' },
                  { key: 'ease', label: 'Ease' },
                  { key: 'easeIn', label: 'Ease In' },
                  { key: 'easeOut', label: 'Ease Out' },
                  { key: 'hold', label: 'Hold' },
                ] as MenuItemType[]
              }
              onClick={(key) => {
                if (!animationData || !activeScene || !selectedKf) return;
                const parsed = parsePropId(selectedKf.propId);
                if (!parsed) return;
                commitAnimation(
                  setTransformKeyframeEasing({
                    animationData,
                    sceneKind: activeScene.kind,
                    assetId: activeScene.assetId,
                    layerInd: parsed.layerInd,
                    propKey: parsed.propKey,
                    frame: secToFrame(selectedKf.timeSec, fps),
                    preset: String(key) as LottieEasingPreset,
                  })
                );
              }}
            >
              <button
                type="button"
                className="inline-flex h-7 items-center rounded-md px-2 text-[11px] text-[var(--ink)] hover:bg-[var(--accent-soft)]"
              >
                {t('editor.lottieTimeline.easing', { defaultValue: '缓动' })}
              </button>
            </Dropdown>
          ) : null}
          <span className="hidden min-w-[4.5rem] tabular-nums text-[11px] text-[var(--muted)] sm:inline">
            {playhead.toFixed(1)}s / {compDuration.toFixed(1)}s
          </span>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
            aria-label={t('editor.closePanel', { defaultValue: '关闭' })}
            onClick={() => {
              setPlaying(false);
              getLottieHost(nodeId)?.pause();
              dispatch(closeLottieTimelinePanel());
            }}
          >
            <HiOutlineXMark className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {activeScene.kind === 'precomp' ? (
        <div className="shrink-0 border-b border-[var(--line)] bg-[var(--canvas)]/50 px-3 py-1 text-[11px] text-[var(--muted)]">
          {t('editor.lottieTimeline.precompHint', {
            defaultValue:
              '预合成：可编辑图层入出点与关键帧；播放头仍驱动主时间线预览',
          })}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div
          className="flex shrink-0 flex-col border-r border-[var(--line)]"
          style={{ width: LAYER_COL_W }}
        >
          <div
            className="flex shrink-0 items-center gap-1 border-b border-[var(--line)] px-1 text-[11px] font-medium text-[var(--muted)]"
            style={{ height: ROW_H }}
          >
            <span className="min-w-0 flex-1 truncate">
              {t('editor.layers', { defaultValue: '图层' })}
            </span>
            <Tooltip
              tip={t('editor.lottieTimeline.addTrack', { defaultValue: '添加轨道' })}
              placement="top"
            >
              <button
                type="button"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--canvas)] hover:text-[var(--ink)] disabled:opacity-40"
                aria-label={t('editor.lottieTimeline.addTrack', { defaultValue: '添加轨道' })}
                disabled={!artboardFrameId || (activeScene?.kind === 'precomp')}
                onClick={addTimelineTrack}
              >
                <HiOutlinePlus className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </Tooltip>
            <Tooltip
              tip={t('editor.lottieTimeline.deleteTrack', { defaultValue: '删除选中轨道' })}
              placement="top"
            >
              <button
                type="button"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--canvas)] hover:text-[var(--ink)] disabled:opacity-40"
                aria-label={t('editor.lottieTimeline.deleteTrack', {
                  defaultValue: '删除选中轨道',
                })}
                disabled={!selectedLayerId}
                onClick={() => {
                  if (!selectedLayerId || !activeScene) return;
                  const layer = activeScene.layers.find((l) => l.id === selectedLayerId);
                  if (layer) deleteTimelineLayer(layer);
                }}
              >
                <HiOutlineTrash className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </Tooltip>
          </div>
                    <div
            ref={layerScrollRef}
            className="min-h-0 flex-1 overflow-y-auto"
            onScroll={() => syncScroll('layer')}
          >
            {rows.length === 0 ? (
              <div className="px-1 py-4 text-[12px] text-[var(--muted)]">
                {t('editor.lottieTimeline.empty', {
                  defaultValue: '当前合成没有图层',
                })}
              </div>
            ) : (
              <div
                className="relative w-full"
                style={{ height: rowVirtualizer.getTotalSize() }}
              >
                {rowVirtualizer.getVirtualItems().map((vRow) => {
                  const row = rows[vRow.index];
                  if (!row) return null;
                  if (row.kind === 'layer') {
                    const selected = selectedLayerId === row.layer.id;
                    const renaming = renamingLayerId === row.layer.id;
                    const dropBefore = dropBeforeLayerId === row.layer.id;
                    return (
                      <div
                        key={row.layer.id}
                        className={cn(
                          'absolute left-0 right-0 flex items-center gap-0.5 border-b border-[var(--line)]/60 px-0.5',
                          selected && 'bg-[var(--accent-soft)]',
                          dragLayerId === row.layer.id && 'opacity-50'
                        )}
                        style={{ height: ROW_H, transform: `translateY(${vRow.start}px)` }}
                      >
                        {dropBefore ? (
                          <span className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-0.5 bg-[#EA580C]" />
                        ) : null}
                        <button
                          type="button"
                          className="inline-flex h-6 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-[var(--muted)] active:cursor-grabbing"
                          aria-label={t('editor.lottieTimeline.reorder', {
                            defaultValue: '拖拽重排',
                          })}
                          onPointerDown={(e) => beginLayerReorder(e, row.layer.id)}
                          onPointerMove={onLayerReorderMove}
                          onPointerUp={endLayerReorder}
                          onPointerCancel={endLayerReorder}
                        >
                          <HiOutlineBars2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-6 w-5 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--canvas)]"
                          aria-label={row.expanded ? '折叠' : '展开'}
                          onClick={() =>
                            setExpanded((prev) => ({
                              ...prev,
                              [row.layer.id]: prev[row.layer.id] !== true,
                            }))
                          }
                        >
                          {row.expanded ? (
                            <HiOutlineChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <HiOutlineChevronRight className="h-3.5 w-3.5" />
                          )}
                        </button>
                        {renaming ? (
                          <input
                            autoFocus
                            className="min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--canvas)] px-1 text-[12px] text-[var(--ink)] outline-none"
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onBlur={() => commitLayerRename(row.layer, renameDraft)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitLayerRename(row.layer, renameDraft);
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setRenamingLayerId(null);
                              }
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate text-left text-[12px] text-[var(--ink)]"
                            onClick={() => selectTimelineLayer(row.layer)}
                            onDoubleClick={() => {
                              setRenamingLayerId(row.layer.id);
                              setRenameDraft(row.layer.name);
                            }}
                            title={t('editor.lottieTimeline.renameHint', {
                              defaultValue: '单击选中画布图层，双击重命名',
                            })}
                          >
                            {row.layer.name}
                          </button>
                        )}
                      </div>
                    );
                  }
                  const atPlayhead = row.times.some(
                    (time) => Math.abs(time - playhead) <= KF_EPS_SEC
                  );
                  return (
                    <div
                      key={`${row.layer.id}-${row.propId}`}
                      className="absolute left-0 right-0 flex items-center gap-1 border-b border-[var(--line)]/40 pl-7 pr-1 text-[11px] text-[var(--muted)]"
                      style={{ height: ROW_H, transform: `translateY(${vRow.start}px)` }}
                    >
                      <span className="min-w-0 flex-1 truncate">{row.label}</span>
                      <Tooltip
                        tip={
                          atPlayhead
                            ? t('editor.lottieTimeline.removeKf', {
                                defaultValue: '删除播放头处关键帧',
                              })
                            : t('editor.lottieTimeline.addKf', {
                                defaultValue: '在播放头添加关键帧',
                              })
                        }
                        placement="top"
                      >
                        <button
                          type="button"
                          className={cn(
                            'inline-flex h-5 w-5 shrink-0 items-center justify-center',
                            atPlayhead ? 'text-[var(--brand)]' : 'text-[var(--muted)]/70'
                          )}
                          onClick={() =>
                            toggleKeyframeAtPlayhead(row.layer.ind, row.propKey, row.times)
                          }
                        >
                          <span
                            className={cn(
                              'h-2 w-2 rotate-45 border',
                              atPlayhead
                                ? 'border-[var(--brand)] bg-[var(--brand)]'
                                : 'border-current bg-transparent'
                            )}
                          />
                        </button>
                      </Tooltip>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div ref={canvasHostRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <LottieTimelineCanvas
            rows={rows}
            duration={duration}
            fps={fps}
            playhead={playhead}
            workInSec={workInSec}
            workOutSec={workOutSec}
            workAreaPreview={workAreaPreview}
            selectedLayerId={selectedLayerId}
            selectedKf={selectedKf}
            trimPreview={trimPreview}
            snapLinesSec={snapLinesSec}
            timeZoom={timeZoom}
            scrollTop={trackScrollTop}
            onScrollTop={(y) => {
              setTrackScrollTop(y);
              if (scrollSyncLock.current) return;
              scrollSyncLock.current = true;
              if (layerScrollRef.current) layerScrollRef.current.scrollTop = y;
              requestAnimationFrame(() => {
                scrollSyncLock.current = false;
              });
            }}
            onSeek={(sec) => seekTo(sec, { pause: true })}
            onSelectLayer={selectTimelineLayer}
            onBeginClipDrag={beginClipDrag}
            onBeginWorkAreaDrag={beginWorkAreaDrag}
            onSelectKf={(propId, timeSec) => setSelectedKf({ propId, timeSec })}
            onKfPointerDown={onKfPointerDown}
            onToggleKfAt={(layerInd, propKey, times, atSec) => {
              seekTo(atSec, { pause: true });
              toggleKeyframeAtPlayhead(layerInd, propKey, times);
            }}
            onTimeZoomDelta={(delta) =>
              setTimeZoom((z) =>
                Math.max(TIME_ZOOM_MIN, Math.min(TIME_ZOOM_MAX, Math.round((z + delta) * 2) / 2))
              )
            }
          />
        </div>

      </div>
    </aside>
  );
}

export default memo(LottieTimelineDock);
