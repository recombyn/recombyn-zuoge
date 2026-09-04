/**
 * Bottom canvas dock for Lottie timeline ? layers + keyframe tracks.
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
import { useSelector } from '@/store';
import {
  useEditorDocumentOnCommit,
  useSelectedNodeIds,
} from '@/store/editorSelectors';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineBars2,
  HiOutlineChevronDown,
  HiOutlineChevronRight,
  HiOutlineMinus,
  HiOutlinePlus,
  HiOutlineTrash,
  HiOutlineXMark,
} from 'react-icons/hi2';
import Tooltip from '@/components/base/tooltip';
import { getAgentDockWidth } from '@/components/editor/panels/AgentDock';
import { getLayerDockWidth } from '@/components/editor/panels/LayerPanel';
import { getLottieHost, syncFrameNestedLotLottieHosts } from '@/components/editor/nodes/AnimationNode/AnimationNodeOverlay';
import AnimationTransportControls from '@/components/editor/nodes/AnimationNode/AnimationTransportControls';
import AnimationTimelineCanvas, {
  LOTTIE_TIMELINE_ROW_H,
  LOTTIE_TIMELINE_TIME_PAD_X,
} from '@/components/editor/nodes/AnimationNode/AnimationTimelineCanvas';
import AnimationKeyframePopover from '@/components/editor/nodes/AnimationNode/AnimationKeyframePopover';
import { translateLottiePropLabel } from '@/components/editor/nodes/AnimationNode/animationPropI18n';
import AnimationTimelineContextMenu, {
  type LottieTimelineCtxAction,
  type AnimationTimelineContextMenuState,
  type LottieTimelineCtxTarget,
} from '@/components/editor/nodes/AnimationNode/AnimationTimelineContextMenu';
import {
  extractPrecompAssetJson,
  linkedLotNodeIdFromAsset,
} from '@/components/editor/nodes/AnimationNode/animationPrecompEditModel';
import {
  buildLottieTimelineScenes,
  frameToSec,
  secToFrame,
  snapSecToFrame,
  type LottieTimelineLayer,
  type LottieTimelineScene,
} from '@/components/editor/nodes/AnimationNode/animationTimelineModel';
import {
  appendEmptyTrackLayer,
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
  liveSceneValueForTransformProp,
  type LottieEasingPreset,
} from '@/components/editor/nodes/AnimationNode/animationTimelineMutate';
import { registerLottieTimelineHotkeyConsumers } from '@/components/editor/nodes/AnimationNode/animationTimelineHotkeys';
import {
  useAnimationPlayheadSec,
  useAnimationPlaying,
} from '@/components/editor/nodes/AnimationNode/animationTransport';
import { resolveAnimationFrameId } from '@/components/editor/nodes/AnimationNode/resolveAnimationFrameId';
import {
  liveValueContextFromLink,
  resolveAnimationLayerLink,
} from '@/components/editor/nodes/AnimationNode/animationAutoKey';
import { buildScenePosePatchesFromAnimation } from '@/components/editor/nodes/AnimationNode/animationScenePoseSync';
import { animationHasPlayableContent } from '@/components/editor/nodes/AnimationNode/animationFrameSync';
import { isPrecompEditSessionNode } from '@/components/editor/nodes/AnimationNode/animationPrecompSession';
import { isAnimationFrameHostNode } from '@/components/rcb/scene/document/nodeCapabilities';
import { nodeIdsBoundToFrames } from '@/components/rcb/scene/document/sceneClipboard';
import {
  parseLottieAnimationData,
  serializeLottieAnimationData,
} from '@/components/rcb/scene/document/nodeFactories';
import {
  enrichTimelineScenesWithPuppet,
  PUPPET_TIMELINE_PROP_KEY,
} from '@/components/editor/nodes/ImageNode/puppet/puppetTimeline';
import {
  readPuppetPins,
  readPuppetTrack,
  upsertPuppetTrackKeyframe,
} from '@/components/editor/nodes/ImageNode/puppet/puppetModel';
import {
  closeLottieTimelinePanel,
  ensureAnimationFrameMedia,
  enterLottiePrecompEdit,
  exitLottiePrecompEdit,
  patchDocumentNode,
  patchDocumentNodes,
  removeDocumentNodes,
  setLottiePlayhead,
  setLottiePlaying,
  setLottiePrecompSelectedLayer,
  setSelectedFrameIds,
  setSelectedNodeIds,
  updateArtboardFrame,
} from '@/store/modules/editor';
import store from '@/store';
import { cn } from '@/utils/classnames';
import { RCB_SYNC_NESTED_LOT_HOSTS } from '@/components/editor/sceneEvents';
import { logPrecompTabArtboardDump } from '@/components/editor/nodes/AnimationNode/precompTabArtboardDump';

const DOCK_HEIGHT_KEY = 'lottie-timeline-dock-height';
const DOCK_MIN_H = 160;
const DOCK_MAX_H = 440;
const DOCK_DEFAULT_H = 240;
/** Gap from side docks only ? flush to bottom dock edges (no extra left/right pad). */
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

export function getAnimationTimelineDockHeight(): number {
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

function AnimationTimelineDock({
  layersOpen,
  agentOpen,
  workspaceMode,
}: {
  layersOpen: boolean;
  agentOpen: boolean;
  workspaceMode: 'design' | 'dev';
}): ReactNode {
  const { t } = useTranslation();
  const document = useEditorDocumentOnCommit();
  const panel = useSelector(
    (s: any) => s.editor.lottieTimelinePanel as null | { nodeId: string }
  );
  const playhead = useAnimationPlayheadSec();
  const playing = useAnimationPlaying();
  const selectedNodeIds = useSelectedNodeIds();
  const precompEdit = useSelector(
    (s: any) =>
      s.editor.lottiePrecompEdit as null | { hostNodeId: string; assetId: string }
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
  const [kfAnchor, setKfAnchor] = useState<null | { x: number; y: number }>(null);
  const [kfPopoverOpen, setKfPopoverOpen] = useState(false);
  const [timelineCtxMenu, setTimelineCtxMenu] =
    useState<AnimationTimelineContextMenuState | null>(null);
  const [kfClipboardTick, setKfClipboardTick] = useState(0);
  const [kfHold, setKfHold] = useState(false);
  const [kfGhost, setKfGhost] = useState<null | {
    propId: string;
    fromSec: number;
    timeSec: number;
  }>(null);
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
    setDockHeight(getAnimationTimelineDockHeight());
  }, []);

  const nodeId = panel?.nodeId ? String(panel.nodeId) : '';
  const node = nodeId ? document?.deltaSetLike?.[nodeId] : null;
  const open = Boolean(nodeId && node?.key === 'lottie');

  // Stale panel (deleted host / wrong id) left tools lifted with no dock.
  useEffect(() => {
    if (!panel?.nodeId) return;
    if (open) return;
    closeLottieTimelinePanel();
  }, [panel?.nodeId, open]);

  // Key for timeline scene enrichment (not a sync trigger).
  const frameChildrenKey = useMemo(() => {
    if (!open || !document || !node) return '';
    const frameId = resolveAnimationFrameId(document, node);
    if (!frameId) return '';
    const ids = nodeIdsBoundToFrames(document, [frameId]).filter((id) => {
      const n = document.deltaSetLike?.[id];
      return (
        n &&
        !isAnimationFrameHostNode(n, document) &&
        !isPrecompEditSessionNode(n)
      );
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
          String(n.attrs?.puppetEnabled || ''),
          String(n.attrs?.puppetDensity || ''),
          JSON.stringify(n.attrs?.puppetPins || null),
          JSON.stringify(n.attrs?.puppetTrack || null),
        ].join(':');
      })
      .join('|');
  }, [open, document, node]);

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
      enrichTimelineScenesWithPuppet(
        buildLottieTimelineScenes(animationData, String(node?.attrs?.name || 'Lottie'), {
          includeEmptyProps: true,
        }),
        document
      ),
    [animationData, node?.attrs?.name, document, frameChildrenKey]
  );

  const activeScene: LottieTimelineScene | null =
    scenes.find((s) => s.id === sceneId) || scenes[0] || null;

  const syncNestedLotsOnMainScene = useCallback(
    (timeSec: number, shouldPlay: boolean, sceneKind: 'main' | 'precomp' = 'main') => {
      if (!document || !nodeId || precompEdit?.assetId) return;
      if (sceneKind !== 'main') return;
      syncFrameNestedLotLottieHosts({
        document,
        frameHostId: nodeId,
        timeSec,
        playing: shouldPlay,
      });
    },
    [document, nodeId, precompEdit?.assetId]
  );

  // Nested LOT remount after leaving precomp — event only (no precompEdit watcher).
  useEffect(() => {
    let cancelled = false;
    const onSync = (e: Event) => {
      const detail = (e as CustomEvent<{ frameHostId?: string; timeSec?: number }>).detail;
      const editor = (store.getState() as { editor?: any }).editor;
      if (editor?.lottiePrecompEdit?.assetId) return;
      const hostId = String(detail?.frameHostId || editor?.lottieTimelinePanel?.nodeId || '').trim();
      const doc = editor?.document;
      if (!hostId || !doc) return;
      let tries = 0;
      const syncLots = () => {
        if (cancelled) return;
        const latest = (store.getState() as { editor?: any }).editor;
        if (latest?.lottiePrecompEdit?.assetId) return;
        const latestDoc = latest?.document || doc;
        const timeSec =
          Number(detail?.timeSec) || Number(latest?.lottiePlayheadSec) || 0;
        syncFrameNestedLotLottieHosts({
          document: latestDoc,
          frameHostId: hostId,
          timeSec,
          playing: false,
        });
        const frameId = resolveAnimationFrameId(
          latestDoc,
          latestDoc.deltaSetLike?.[hostId]
        );
        let needsRetry = false;
        if (frameId) {
          for (const [id, n] of Object.entries(latestDoc.deltaSetLike || {})) {
            if (!n || id === 'ROOT' || (n as any).key !== 'lottie') continue;
            if (isAnimationFrameHostNode(n as any, latestDoc)) continue;
            if (String((n as any).attrs?.frameId || '').trim() !== frameId) continue;
            if ((n as any).attrs?.hidden === true || (n as any).attrs?.hidden === 'true') {
              continue;
            }
            if (!getLottieHost(id)) needsRetry = true;
          }
        }
        if (needsRetry && tries++ < 24) window.requestAnimationFrame(syncLots);
      };
      window.requestAnimationFrame(syncLots);
    };
    window.addEventListener(RCB_SYNC_NESTED_LOT_HOSTS, onSync);
    return () => {
      cancelled = true;
      window.removeEventListener(RCB_SYNC_NESTED_LOT_HOSTS, onSync);
    };
  }, []);

  useEffect(() => {
    const onExpand = (e: Event) => {
      const detail = (e as CustomEvent<{ layerInd?: number }>).detail;
      const ind = Number(detail?.layerInd);
      if (!Number.isFinite(ind) || !activeScene) return;
      const layer = activeScene.layers.find((l) => l.ind === ind);
      if (!layer) return;
      setExpanded((prev) => ({ ...prev, [layer.id]: true }));
    };
    window.addEventListener('lottie-timeline-expand-layer', onExpand);
    return () => window.removeEventListener('lottie-timeline-expand-layer', onExpand);
  }, [activeScene]);

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
    edge: 'in' | 'out';
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

  // Mirror canvas selection onto the timeline. Nested Lottie plates keep their
  // transform tracks on the main scene — do not auto-drill into precomp (that
  // left the plate uneditable with an empty precomp scene selected).
  const timelineSelRef = useRef<string | null>(null);
  useEffect(() => {
    const selId = selectedNodeIds[0] || null;
    timelineSelRef.current = selId;
    if (!activeScene) {
      setSelectedLayerId(null);
      return;
    }
    if (!selId || !document) {
      setSelectedLayerId(null);
      return;
    }
    const match = activeScene.layers.find((layer) => layer.sceneNodeId === selId);
    setSelectedLayerId(match ? match.id : null);
  }, [activeScene, document, selectedNodeIds]);

  const commitAnimation = useCallback(
    (nextAnim: Record<string, unknown> | null) => {
      if (!nextAnim || !nodeId) return;
      const json = serializeLottieAnimationData(nextAnim);
      if (!json) return;
      patchDocumentNode({
          nodeId,
          patch: { attrs: { animationData: json } },
        });
      // LOT tab edits host JSON — mirror into the nested lot node so — —preview stays in sync.
      if (activeScene?.kind === 'precomp' && activeScene.assetId) {
        const lotId = linkedLotNodeIdFromAsset(activeScene.assetId);
        const childJson = extractPrecompAssetJson(json, activeScene.assetId);
        if (lotId && childJson) {
          patchDocumentNode({
              nodeId: lotId,
              patch: { attrs: { animationData: childJson } },
            });
        }
      }
    },
    [activeScene?.assetId, activeScene?.kind, nodeId]
  );

  const selectTimelineLayer = useCallback(
    (layer: LottieTimelineLayer) => {
      setSelectedLayerId(layer.id);
      if (playing) {
        setLottiePlaying({ playing: false, hostNodeId: nodeId });
        getLottieHost(nodeId)?.pause();
      }
      setSelectedFrameIds([]);
      if (layer.sceneNodeId) {
        setSelectedNodeIds([layer.sceneNodeId]);
      } else {
        // Clip-only / unlinked layer — clear canvas chrome so timeline and stage agree.
        setSelectedNodeIds([]);
      }
    },
    [nodeId, playing]
  );

  const commitLayerRename = useCallback(
    (layer: LottieTimelineLayer, nextName: string) => {
      setRenamingLayerId(null);
      const name = nextName.trim();
      if (!name || name === layer.name) return;
      if (layer.sceneNodeId) {
        patchDocumentNode({
            nodeId: layer.sceneNodeId,
            patch: { attrs: { name } },
          });
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
    [activeScene, animationData, commitAnimation]
  );

  const artboardFrameId = useMemo(() => {
    if (!document || !node) return null;
    return resolveAnimationFrameId(document, node);
  }, [document, node]);

  const artboardFrame = useMemo(() => {
    if (!artboardFrameId || !document) return null;
    const frames = Array.isArray(document.frames) ? document.frames : [];
    return frames.find((f: any) => String(f?.id) === artboardFrameId) || null;
  }, [artboardFrameId, document]);

  useEffect(() => {
    const frameSpan = Math.max(0.5, Number(artboardFrame?.durationSec) || 0);
    // Follow work area — must shrink after FPS changes, not only grow.
    const target = Math.max(workOutSec, frameSpan, workInSec + 0.5, 1);
    setSpanSec(target);
  }, [workOutSec, workInSec, artboardFrame?.durationSec]);

  const addTimelineTrack = useCallback(() => {
    if (!animationData || !activeScene) return;
    if (activeScene.kind !== 'main') return;
    const sceneFps = Math.max(1, Number(activeScene.fr) || 30);
    const sceneDur = Math.max(0.5, Number(activeScene.durationSec) || 5);
    // Short clip from playhead — empty null layer, no canvas shape.
    const clipSec = Math.min(2, Math.max(0.5, sceneDur * 0.4));
    const inFrame = Math.max(0, Math.round(playhead * sceneFps));
    const outFrame = Math.min(
      Math.round(sceneDur * sceneFps),
      Math.max(inFrame + Math.round(sceneFps * 0.25), inFrame + Math.round(clipSec * sceneFps))
    );
    const name = `Layer ${activeScene.layers.length + 1}`;
    const created = appendEmptyTrackLayer({
      animationData,
      sceneKind: activeScene.kind,
      assetId: activeScene.assetId,
      name,
      inFrame,
      outFrame,
    });
    if (!created) return;
    commitAnimation(created.animationData);
    setSelectedFrameIds([]);
    setSelectedNodeIds([]);
    setSelectedLayerId(`layer-${created.layerInd}-${created.name}`);
    setSelectedKf(null);
    setKfPopoverOpen(false);
    setKfAnchor(null);
  }, [activeScene, animationData, commitAnimation, playhead]);

  const deleteTimelineLayer = useCallback(
    (layer: LottieTimelineLayer) => {
      if (layer.sceneNodeId) {
        removeDocumentNodes({ nodeIds: [layer.sceneNodeId] });
        if (artboardFrameId) ensureAnimationFrameMedia({ frameId: artboardFrameId });
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
      setKfPopoverOpen(false);
      setKfAnchor(null);
    },
    [
      activeScene,
      animationData,
      artboardFrameId,
      commitAnimation, selectedLayerId,
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
        // Sync sorts ascending frameOrder then unshifts — highest FO ends top of list.
        const patches = linked.map((l, i) => ({
          nodeId: String(l.sceneNodeId),
          patch: {
            attrs: {
              frameOrder: linked.length - 1 - i,
            },
          },
        }));
        patchDocumentNodes({ patches });
        if (artboardFrameId) ensureAnimationFrameMedia({ frameId: artboardFrameId });
      }
      setSelectedLayerId(moved.id);
    },
    [activeScene, animationData, artboardFrameId, commitAnimation]
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
        setLottiePlaying({ playing: false, hostNodeId: nodeId });
        getLottieHost(nodeId)?.pause();
      }
      setLottiePlayhead(next);
      if (!nodeId) return;
      getLottieHost(nodeId)?.seek(next);
      syncNestedLotsOnMainScene(next, false);
    },
    [duration, fps, nodeId, syncNestedLotsOnMainScene]
  );

  // Enter timeline at t=0 — do not adopt leftover host/autoplay time.
  // Keep lottiePlaying if open requested play (frame/host toolbar).
  useEffect(() => {
    if (!open || !nodeId) return;
    // Capture at open transition (same tick as openLottieTimelinePanel play flag).
    const wantPlay = playing;
    const host = getLottieHost(nodeId);
    host?.seek(0);
    setLottiePlayhead(0);
    if (wantPlay) {
      host?.playFrom(0);
    } else {
      setLottiePlaying({ playing: false, hostNodeId: nodeId });
      host?.pause();
    }
    syncNestedLotsOnMainScene(0, wantPlay);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open/node only; playing sampled at enter
  }, [open, nodeId]);

  const playheadRef = useRef(playhead);
  // While playing, ref holds continuous time (must not reset from snapped store).
  useEffect(() => {
    if (playing) playheadRef.current = playhead;
    // Seed only when play starts — not on every snapped tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [playing]);
  useEffect(() => {
    if (!playing) playheadRef.current = playhead;
  }, [playhead, playing]);
  const loopRef = useRef(loop);
  loopRef.current = loop;

  // Advance playhead while playing. Prefer live lottie-web time when the host
  // is mounted; otherwise drive a wall-clock playhead so workbench layers still
  // scrub via AnimationPlayheadSceneSync (host ink is hidden for frame hosts).
  useEffect(() => {
    if (!playing || !open || !nodeId) return;
    let raf = 0;
    let lastTs = performance.now();
    let missingHost = 0;
    const tick = (now: number) => {
      const liveIn = workAreaPreview?.inSec ?? workInSec;
      const liveOut = workAreaPreview?.outSec ?? workOutSec;
      const host = getLottieHost(nodeId);
      let t: number;
      if (host && !host.isPaused()) {
        missingHost = 0;
        lastTs = now;
        t = host.getCurrentTime();
      } else {
        const speed = Math.max(0.05, Number(host?.getSpeed?.()) || 1);
        const dt = Math.max(0, (now - lastTs) / 1000) * speed;
        lastTs = now;
        // Accumulate continuous time — never write snapped UI time back into the
        // ref or we stall one frame before workOut (snap — +dt — snap loop).
        t = playheadRef.current + dt;
        if (host) {
          // Host remounted paused (JSON sync) — nudge it back into play.
          if (missingHost < 8) {
            host.playFrom(t);
            missingHost += 1;
          } else {
            host.seek(t);
          }
        } else {
          missingHost = 0;
        }
      }

      if (t >= liveOut - 1e-3) {
        if (loopRef.current) {
          t = liveIn;
          host?.playFrom(t);
          playheadRef.current = t;
          setLottiePlayhead(snapSecToFrame(t, fps, duration));
          raf = requestAnimationFrame(tick);
          return;
        }
        // Non-loop: sit on the work-area out edge (not the last inclusive frame).
        // Keep playingHostId — clearing it used to make SceneSync seek(0).
        playheadRef.current = liveOut;
        setLottiePlayhead(liveOut);
        host?.seek(liveOut);
        host?.pause();
        setLottiePlaying({ playing: false, hostNodeId: nodeId });
        return;
      }

      playheadRef.current = t;
      setLottiePlayhead(
          snapSecToFrame(Math.max(liveIn, Math.min(duration, t)), fps, duration)
        );
      syncNestedLotsOnMainScene(t, true);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [
    playing,
    open,
    nodeId,
    duration,
    fps, workAreaPreview?.inSec,
    workAreaPreview?.outSec,
    workInSec,
    workOutSec,
    syncNestedLotsOnMainScene,
  ]);

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
      const innerW = Math.max(1, contentW - LOTTIE_TIMELINE_TIME_PAD_X * 2);
      const x = clientX - box.left + (scrollEl?.scrollLeft || 0);
      const ratio = Math.max(0, Math.min(1, (x - LOTTIE_TIMELINE_TIME_PAD_X) / innerW));
      return snapSecToFrame(ratio * duration, fps, duration);
    },
    [duration, fps, timeZoom]
  );

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
    if (!nodeId || !animationData) return;
    // Trust React transport state only — leftover host autoplay used to make
    // "play" clicks take the pause branch while the icon still showed play.
    if (playing) {
      const host = getLottieHost(nodeId);
      host?.pause();
      syncNestedLotsOnMainScene(host?.getCurrentTime() ?? playhead, false);
      setLottiePlaying({ playing: false, hostNodeId: nodeId });
      if (host) {
        setLottiePlayhead(snapSecToFrame(host.getCurrentTime(), fps, duration));
      }
      return;
    }
    const liveIn = workAreaPreview?.inSec ?? workInSec;
    const liveOut = workAreaPreview?.outSec ?? workOutSec;
    const startAt =
      playhead >= liveOut - 1e-3 || playhead < liveIn - 1e-3 ? liveIn : playhead;
    const snapped = snapSecToFrame(startAt, fps, duration);
    setLottiePlayhead(snapped);
    playheadRef.current = snapped;
    // Best-effort host; wall-clock RAF keeps the playhead moving either way.
    getLottieHost(nodeId)?.playFrom(snapped);
    syncNestedLotsOnMainScene(snapped, true);
    setLottiePlaying({ playing: true, hostNodeId: nodeId });
  };
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;

  const deleteSelectedKf = useCallback((): boolean => {
    if (!selectedKf || !activeScene) return false;
    const parsed = parsePropId(selectedKf.propId);
    if (!parsed) return false;
    const frame = secToFrame(selectedKf.timeSec, fps);

    if (parsed.propKey === PUPPET_TIMELINE_PROP_KEY) {
      const layer = activeScene.layers.find((l) => l.ind === parsed.layerInd);
      const sceneNodeId = layer?.sceneNodeId;
      if (!sceneNodeId || !document) return false;
      const sceneNode = document.deltaSetLike?.[sceneNodeId];
      if (!sceneNode) return false;
      const attrs = (sceneNode.attrs || {}) as Record<string, unknown>;
      const nextTrack = readPuppetTrack(attrs).filter((k) => k.f !== frame);
      patchDocumentNode({
          nodeId: sceneNodeId,
          patch: { attrs: { puppetTrack: nextTrack } },
        });
      setSelectedKf(null);
      setKfPopoverOpen(false);
      setKfAnchor(null);
      return true;
    }

    if (!animationData) return false;
    commitAnimation(
      removeTransformKeyframe({
        animationData,
        sceneKind: activeScene.kind,
        assetId: activeScene.assetId,
        layerInd: parsed.layerInd,
        propKey: parsed.propKey,
        frame,
      })
    );
    setSelectedKf(null);
    setKfPopoverOpen(false);
    setKfAnchor(null);
    return true;
  }, [selectedKf, animationData, activeScene, commitAnimation, fps, document]);

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
    if (parsed.propKey === PUPPET_TIMELINE_PROP_KEY) return false;
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
    setKfClipboardTick((n) => n + 1);
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
      setKfHold(false);
      return;
    }
    const parsed = parsePropId(selectedKf.propId);
    if (!parsed) {
      setValueDraft([]);
      setKfHold(false);
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
      setKfHold(false);
      return;
    }
    const vals = Array.isArray(payload.value) ? payload.value : [payload.value];
    setValueDraft(vals.map((v) => String(Number(v.toFixed(3)))));
    setKfHold(Boolean(payload.hold));
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
    patchDocumentNode({
        nodeId,
        patch: { attrs: { lottieLoop: next ? 'true' : 'false' } },
      });
    getLottieHost(nodeId)?.setLoop(next);
  };

  const toggleKeyframeAtPlayhead = (
    layerInd: number,
    propKey: string,
    times: number[],
    atSec?: number
  ) => {
    if (!activeScene) return;
    const t =
      typeof atSec === 'number' && Number.isFinite(atSec) ? Math.max(0, atSec) : playhead;
    const frame = secToFrame(t, fps);
    const has = times.some((time) => Math.abs(time - t) <= Math.max(KF_EPS_SEC, 0.5 / fps));
    const layer = activeScene.layers.find((l) => l.ind === layerInd);

    if (propKey === PUPPET_TIMELINE_PROP_KEY) {
      const sceneNodeId = layer?.sceneNodeId;
      if (!sceneNodeId || !document) return;
      const sceneNode = document.deltaSetLike?.[sceneNodeId];
      if (!sceneNode || sceneNode.key !== 'image') return;
      const attrs = (sceneNode.attrs || {}) as Record<string, unknown>;
      const pins = readPuppetPins(attrs);
      const track = readPuppetTrack(attrs);
      const nextTrack = has
        ? track.filter((k) => k.f !== frame)
        : upsertPuppetTrackKeyframe(track, frame, pins);
      patchDocumentNode({
          nodeId: sceneNodeId,
          patch: {
            attrs: {
              puppetEnabled: true,
              puppetPins: pins,
              puppetTrack: nextTrack,
            },
          },
        });
      return;
    }

    if (!animationData) return;
    const sceneNode = layer?.sceneNodeId
      ? document?.deltaSetLike?.[layer.sceneNodeId]
      : null;
    const link = layer?.sceneNodeId
      ? resolveAnimationLayerLink(document, layer.sceneNodeId)
      : null;
    const liveValue = liveSceneValueForTransformProp(
      sceneNode,
      propKey,
      link ? liveValueContextFromLink(link) : undefined
    );
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
          ...(liveValue !== undefined ? { value: liveValue } : {}),
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
    const contentW = box.width * Math.max(1, timeZoom);
    return Math.max(1, contentW - LOTTIE_TIMELINE_TIME_PAD_X * 2);
  }, [timeZoom]);

  const beginClipDrag = useCallback(
    (
      e: { clientX: number },
      layer: LottieTimelineLayer,
      mode: 'move' | 'in' | 'out'
    ) => {
      selectTimelineLayer(layer);
      setLottiePlaying({ playing: false, hostNodeId: nodeId });
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

      let raf = 0;
      let pendingSnapLine: number | null = null;
      const flushTrimPreview = () => {
        raf = 0;
        const preview = trimPreviewRef.current;
        if (!preview) return;
        setTrimPreview({ ...preview });
        setSnapLinesSec(pendingSnapLine != null ? [pendingSnapLine] : []);
      };
      const scheduleTrimPreview = () => {
        if (raf) return;
        raf = window.requestAnimationFrame(flushTrimPreview);
      };

      const onMove = (ev: MouseEvent) => {
        const drag = layerDragRef.current;
        if (!drag) return;
        const width = trackWidthPx();
        if (!(width > 0)) return;
        const deltaSec = ((ev.clientX - drag.startClientX) / width) * duration;
        let next = computeLayerTrim(drag.mode, drag.originIn, drag.originOut, deltaSec);
        const points = collectSnapPoints(drag.layerId);
        let snapLine: number | null = null;
        if (drag.mode === 'in') {
          const s = snapValue(next.inSec, points);
          next = { ...next, inSec: Math.min(next.outSec - 1 / fps, Math.max(0, s.value)) };
          snapLine = s.line;
        } else if (drag.mode === 'out') {
          const s = snapValue(next.outSec, points);
          next = {
            ...next,
            outSec: Math.max(next.inSec + 1 / fps, Math.min(duration, s.value)),
          };
          snapLine = s.line;
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
            snapLine = sIn.line;
          } else if (sOut.line != null) {
            const span = next.outSec - next.inSec;
            const outSec = Math.max(span, Math.min(duration, sOut.value));
            next = { inSec: outSec - span, outSec };
            snapLine = sOut.line;
          }
        }
        const preview = { layerId: drag.layerId, inSec: next.inSec, outSec: next.outSec };
        const prev = trimPreviewRef.current;
        if (
          prev &&
          Math.abs(prev.inSec - preview.inSec) < 1e-9 &&
          Math.abs(prev.outSec - preview.outSec) < 1e-9
        ) {
          return;
        }
        trimPreviewRef.current = preview;
        pendingSnapLine = snapLine;
        scheduleTrimPreview();
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (raf) window.cancelAnimationFrame(raf);
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
          patchDocumentNode({
              nodeId: drag.sceneNodeId,
              patch: {
                attrs: {
                  lottieInFrame: inFrame,
                  lottieOutFrame: outFrame,
                },
              },
            });
        }
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [
      activeScene,
      animationData,
      commitAnimation, duration,
      fps,
      nodeId,
      selectTimelineLayer,
      trackWidthPx,
    ]
  );

  const beginWorkAreaDrag = useCallback(
    (edge: 'in' | 'out', clientX: number) => {
      if (!activeScene || !animationData) return;
      setLottiePlaying({ playing: false, hostNodeId: nodeId });
      getLottieHost(nodeId)?.pause();
      const originIn = workInSec;
      const originOut = workOutSec;
      workAreaDragRef.current = {
        edge,
        startClientX: clientX,
        originIn,
        originOut,
      };
      const previewRef = { current: { inSec: originIn, outSec: originOut, edge } };
      let raf = 0;
      const flushPreview = () => {
        raf = 0;
        const p = previewRef.current;
        setWorkAreaPreview({ inSec: p.inSec, outSec: p.outSec, edge: p.edge });
      };
      const schedulePreview = () => {
        if (raf) return;
        raf = window.requestAnimationFrame(flushPreview);
      };
      setWorkAreaPreview({ inSec: originIn, outSec: originOut, edge });

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
        }
        const prev = previewRef.current;
        if (
          Math.abs(prev.inSec - inSec) < 1e-9 &&
          Math.abs(prev.outSec - outSec) < 1e-9
        ) {
          return;
        }
        previewRef.current = { inSec, outSec, edge: drag.edge };
        schedulePreview();
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (raf) window.cancelAnimationFrame(raf);
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
          updateArtboardFrame({
              id: artboardFrameId,
              patch: { durationSec: Math.max(0.5, preview.outSec) },
            });
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
      commitAnimation, duration,
      fps,
      nodeId,
      trackWidthPx,
      workInSec,
      workOutSec,
    ]
  );

  const openKfPopoverAtRef = useRef<
    (clientX: number, clientY: number, propId: string, timeSec: number) => void
  >(() => {});

  const openKfPopoverAt = useCallback(
    (clientX: number, clientY: number, propId: string, timeSec: number) => {
      const parsed = parsePropId(propId);
      setSelectedKf({ propId, timeSec });
      // Puppet keys store pin snapshots — no numeric Bodymovin inspector.
      if (parsed?.propKey === PUPPET_TIMELINE_PROP_KEY) {
        setKfPopoverOpen(false);
        setKfAnchor(null);
        setTimelineCtxMenu(null);
        setLottiePlaying({ playing: false, hostNodeId: nodeId });
        getLottieHost(nodeId)?.pause();
        return;
      }
      setKfAnchor({ x: clientX, y: clientY });
      setKfPopoverOpen(true);
      setTimelineCtxMenu(null);
      setLottiePlaying({ playing: false, hostNodeId: nodeId });
      getLottieHost(nodeId)?.pause();
      // Do not seek — clicking / editing a keyframe must not move the playhead.
    },
    [nodeId]
  );
  openKfPopoverAtRef.current = openKfPopoverAt;

  const onKfPointerDown = useCallback(
    (e: ReactPointerEvent, propId: string, fromSec: number) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      setKfPopoverOpen(false);
      setKfAnchor(null);
      setSelectedKf({ propId, timeSec: fromSec });
      setLottiePlaying({ playing: false, hostNodeId: nodeId });
      getLottieHost(nodeId)?.pause();
      const pointerId = e.pointerId;
      const downX = e.clientX;
      const downY = e.clientY;
      kfDragRef.current = { propId, fromSec, pointerId };
      setKfGhost({ propId, fromSec, timeSec: fromSec });

      const onMove = (ev: PointerEvent) => {
        const drag = kfDragRef.current;
        if (!drag || drag.pointerId !== ev.pointerId) return;
        const next = clientXToSec(ev.clientX);
        setKfGhost({ propId: drag.propId, fromSec: drag.fromSec, timeSec: next });
        setSelectedKf({ propId: drag.propId, timeSec: next });
      };

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        const drag = kfDragRef.current;
        kfDragRef.current = null;
        setKfGhost(null);
        if (!drag || !activeScene) return;
        const parsed = parsePropId(drag.propId);
        if (!parsed) return;
        const toSec = clientXToSec(ev.clientX);
        if (Math.abs(toSec - drag.fromSec) < Math.max(KF_EPS_SEC, 0.5 / fps)) {
          // Click (no drag): open inspector without moving the playhead.
          const layer = activeScene.layers.find((l) => l.ind === parsed.layerInd);
          if (layer) selectTimelineLayer(layer);
          openKfPopoverAtRef.current(downX, downY, drag.propId, drag.fromSec);
          return;
        }
        if (parsed.propKey === PUPPET_TIMELINE_PROP_KEY) {
          const layer = activeScene.layers.find((l) => l.ind === parsed.layerInd);
          const sceneNodeId = layer?.sceneNodeId;
          if (!sceneNodeId || !document) return;
          const sceneNode = document.deltaSetLike?.[sceneNodeId];
          if (!sceneNode) return;
          const attrs = (sceneNode.attrs || {}) as Record<string, unknown>;
          const fromFrame = secToFrame(drag.fromSec, fps);
          const toFrame = secToFrame(toSec, fps);
          const track = readPuppetTrack(attrs);
          const hit = track.find((k) => k.f === fromFrame);
          if (!hit) return;
          const without = track.filter((k) => k.f !== fromFrame && k.f !== toFrame);
          const nextTrack = upsertPuppetTrackKeyframe(without, toFrame, hit.pins);
          patchDocumentNode({
              nodeId: sceneNodeId,
              patch: { attrs: { puppetTrack: nextTrack } },
            });
          setSelectedKf({ propId: drag.propId, timeSec: toSec });
          return;
        }
        if (!animationData) return;
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
        setSelectedKf({ propId: drag.propId, timeSec: toSec });
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [
      activeScene,
      animationData,
      clientXToSec,
      commitAnimation, document,
      fps,
      nodeId,
      selectTimelineLayer,
    ]
  );

  const openTimelineCtxMenu = useCallback(
    (clientX: number, clientY: number, target: LottieTimelineCtxTarget) => {
      setTimelineCtxMenu({ clientX, clientY, target });
      setKfPopoverOpen(false);
      if (target.kind === 'kf') {
        setSelectedKf({ propId: target.propId, timeSec: target.timeSec });
        setSelectedLayerId(
          activeScene?.layers.find((l) => l.ind === target.layerInd)?.id || null
        );
      } else if (target.kind === 'prop') {
        setSelectedKf(null);
        setSelectedLayerId(
          activeScene?.layers.find((l) => l.ind === target.layerInd)?.id || null
        );
      } else if (target.kind === 'layer') {
        setSelectedKf(null);
        setSelectedLayerId(target.layerId);
      }
      setLottiePlaying({ playing: false, hostNodeId: nodeId });
      getLottieHost(nodeId)?.pause();
    },
    [activeScene, nodeId]
  );

  const onTracksContextMenu = useCallback(
    (
      clientX: number,
      clientY: number,
      hit: {
        kind: 'kf' | 'prop' | 'layer' | 'clip' | 'row' | 'empty';
        propId?: string;
        propKey?: string;
        layerId?: string;
        layerInd?: number;
        timeSec?: number;
        times?: number[];
        sec?: number;
      }
    ) => {
      if (hit.kind === 'kf' && hit.propId && hit.propKey && hit.layerId != null && hit.layerInd != null && hit.timeSec != null) {
        openTimelineCtxMenu(clientX, clientY, {
          kind: 'kf',
          propId: hit.propId,
          propKey: hit.propKey,
          layerId: hit.layerId,
          layerInd: hit.layerInd,
          timeSec: hit.timeSec,
          times: hit.times || [],
        });
        return;
      }
      if (hit.kind === 'prop' && hit.propId && hit.propKey && hit.layerId && hit.layerInd != null) {
        openTimelineCtxMenu(clientX, clientY, {
          kind: 'prop',
          propId: hit.propId,
          propKey: hit.propKey,
          layerId: hit.layerId,
          layerInd: hit.layerInd,
          times: hit.times || [],
        });
        return;
      }
      if ((hit.kind === 'layer' || hit.kind === 'clip' || hit.kind === 'row') && hit.layerId && hit.layerInd != null) {
        openTimelineCtxMenu(clientX, clientY, {
          kind: 'layer',
          layerId: hit.layerId,
          layerInd: hit.layerInd,
        });
        return;
      }
      openTimelineCtxMenu(clientX, clientY, { kind: 'empty' });
    },
    [openTimelineCtxMenu]
  );

  const onTimelineCtxAction = useCallback(
    (action: LottieTimelineCtxAction) => {
      const target = timelineCtxMenu?.target;
      if (!target) return;
      const layerId =
        target.kind === 'empty' ? null : target.kind === 'layer' ? target.layerId : target.layerId;
      const layer = layerId
        ? activeScene?.layers.find((l) => l.id === layerId)
        : null;

      if (action === 'editKf' && target.kind === 'kf' && timelineCtxMenu) {
        openKfPopoverAt(
          timelineCtxMenu.clientX,
          timelineCtxMenu.clientY,
          target.propId,
          target.timeSec
        );
        return;
      }
      if (action === 'addKf' && (target.kind === 'prop' || target.kind === 'kf')) {
        seekTo(playhead, { pause: true });
        toggleKeyframeAtPlayhead(target.layerInd, target.propKey, target.times);
        return;
      }
      if (action === 'removeKf' && target.kind === 'kf') {
        setSelectedKf({ propId: target.propId, timeSec: target.timeSec });
        // defer to next tick so selectedKf is set for deleteSelectedKf — call mutate directly
        if (!animationData || !activeScene) return;
        const parsed = parsePropId(target.propId);
        if (!parsed) return;
        commitAnimation(
          removeTransformKeyframe({
            animationData,
            sceneKind: activeScene.kind,
            assetId: activeScene.assetId,
            layerInd: parsed.layerInd,
            propKey: parsed.propKey,
            frame: secToFrame(target.timeSec, fps),
          })
        );
        setSelectedKf(null);
        return;
      }
      if (action === 'showAllKfs' && layer) {
        setExpanded((prev) => ({ ...prev, [layer.id]: true }));
        return;
      }
      if (action === 'copy' && target.kind === 'kf') {
        setSelectedKf({ propId: target.propId, timeSec: target.timeSec });
        if (!animationData || !activeScene) return;
        const parsed = parsePropId(target.propId);
        if (!parsed) return;
        const payload = readTransformKeyframe({
          animationData,
          sceneKind: activeScene.kind,
          assetId: activeScene.assetId,
          layerInd: parsed.layerInd,
          propKey: parsed.propKey,
          frame: secToFrame(target.timeSec, fps),
        });
        if (!payload) return;
        kfClipboard = payload;
        setKfClipboardTick((n) => n + 1);
        return;
      }
      if (action === 'paste' && (target.kind === 'prop' || target.kind === 'kf')) {
        if (!kfClipboard || !animationData || !activeScene) return;
        const frame = secToFrame(playhead, fps);
        let next = upsertTransformKeyframe({
          animationData,
          sceneKind: activeScene.kind,
          assetId: activeScene.assetId,
          layerInd: target.layerInd,
          propKey: target.propKey,
          frame,
          value: kfClipboard.value,
        });
        if (!next) return;
        if (kfClipboard.hold) {
          next =
            setTransformKeyframeEasing({
              animationData: next,
              sceneKind: activeScene.kind,
              assetId: activeScene.assetId,
              layerInd: target.layerInd,
              propKey: target.propKey,
              frame,
              preset: 'hold',
            }) || next;
        }
        commitAnimation(next);
        setSelectedKf({ propId: target.propId, timeSec: playhead });
        return;
      }
      if (action === 'rename' && layer) {
        setRenamingLayerId(layer.id);
        setRenameDraft(layer.name);
        return;
      }
      if (action === 'delete') {
        if (target.kind === 'kf') {
          if (!animationData || !activeScene) return;
          const parsed = parsePropId(target.propId);
          if (!parsed) return;
          commitAnimation(
            removeTransformKeyframe({
              animationData,
              sceneKind: activeScene.kind,
              assetId: activeScene.assetId,
              layerInd: parsed.layerInd,
              propKey: parsed.propKey,
              frame: secToFrame(target.timeSec, fps),
            })
          );
          setSelectedKf(null);
          return;
        }
        if (layer) deleteTimelineLayer(layer);
      }
    },
    [
      timelineCtxMenu,
      activeScene,
      animationData,
      commitAnimation,
      fps,
      playhead,
      seekTo,
      openKfPopoverAt,
      deleteTimelineLayer,
    ]
  );

  const clearSelectedKf = useCallback(() => {
    setSelectedKf(null);
    setKfAnchor(null);
    setKfPopoverOpen(false);
    setValueDraft([]);
    setKfHold(false);
  }, []);

  const commitSelectedKfValues = useCallback(
    (override?: string[]) => {
      if (!animationData || !activeScene || !selectedKf) return;
      const parsed = parsePropId(selectedKf.propId);
      if (!parsed) return;
      const draft = override ?? valueDraft;
      const nums = draft.map((s) => Number(s));
      if (nums.some((n) => !Number.isFinite(n))) return;
      const value = nums.length === 1 ? nums[0]! : nums;
      const nextAnim = setTransformKeyframeValue({
        animationData,
        sceneKind: activeScene.kind,
        assetId: activeScene.assetId,
        layerInd: parsed.layerInd,
        propKey: parsed.propKey,
        frame: secToFrame(selectedKf.timeSec, fps),
        value,
      });
      commitAnimation(nextAnim);
      // When the playhead sits on this keyframe, bake the new pose into the
      // scene node so the selection chrome / anchor marker follow immediately.
      const nearPlayhead =
        Math.abs(playhead - selectedKf.timeSec) <= Math.max(KF_EPS_SEC, 0.5 / fps);
      if (!nearPlayhead || !nextAnim || !document || !artboardFrame) return;
      const plate = {
        left: Number(artboardFrame.x) || 0,
        top: Number(artboardFrame.y) || 0,
        width: Math.max(1, Number(artboardFrame.width) || 1),
        height: Math.max(1, Number(artboardFrame.height) || 1),
      };
      const poses = buildScenePosePatchesFromAnimation({
        document,
        animationData: nextAnim,
        playheadSec: selectedKf.timeSec,
        layerInds: [parsed.layerInd],
        plate,
      });
      if (!poses.length) return;
      patchDocumentNodes({
          patches: poses.map((p) => ({
            nodeId: p.nodeId,
            patch: {
              x: p.x,
              y: p.y,
              width: p.width,
              height: p.height,
              attrs: p.attrs,
            },
          })),
        });
    },
    [
      activeScene,
      animationData,
      artboardFrame,
      commitAnimation, document,
      fps,
      playhead,
      selectedKf,
      valueDraft,
    ]
  );

  const commitSelectedKfChannel = useCallback(
    (index: number, n: number) => {
      if (!selectedKf) return;
      const next = [...valueDraft];
      next[index] = String(Math.round(n * 1000) / 1000);
      setValueDraft(next);
      commitSelectedKfValues(next);
    },
    [commitSelectedKfValues, selectedKf, valueDraft]
  );

  const applySelectedKfEasing = useCallback(
    (preset: LottieEasingPreset) => {
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
          preset,
        })
      );
      setKfHold(preset === 'hold');
    },
    [activeScene, animationData, commitAnimation, fps, selectedKf]
  );

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
        aria-label={t('editor.lottieTimeline.resize')}
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
                  setLottiePlaying({ playing: false, hostNodeId: nodeId });
                  setSelectedKf(null);
                  setKfPopoverOpen(false);
                  setKfAnchor(null);
                  getLottieHost(nodeId)?.pause();
                  if (scene.kind === 'precomp' && scene.assetId) {
                    setSceneId(scene.id);
                    setSelectedLayerId(null);
                    setSelectedNodeIds([]);
                    // LOT tab = materialize insides + resize workbench to the plate.
                    const firstInd = scene.layers[0]?.ind;
                    logPrecompTabArtboardDump('tab→precomp:before', {
                      hostNodeId: nodeId,
                      assetId: scene.assetId,
                    });
                    enterLottiePrecompEdit({
                        hostNodeId: nodeId,
                        assetId: scene.assetId,
                        selectedLayerInd: Number.isFinite(firstInd) ? firstInd : null,
                      });
                  } else {
                    // — — flush LOT session + restore workbench before switching tabs.
                    logPrecompTabArtboardDump('tab→main:before', {
                      hostNodeId: nodeId,
                    });
                    exitLottiePrecompEdit();
                    setSceneId(scene.id);
                    setLottiePrecompSelectedLayer(null);
                    setSelectedNodeIds([]);
                  }
                }}
              >
                {scene.kind === 'main'
                  ? t('editor.lottieTimeline.mainScene')
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
              title={t('editor.lottieTimeline.zoomOut')}
              aria-label={t('editor.lottieTimeline.zoomOut')}
              onClick={() =>
                setTimeZoom((z) => Math.max(TIME_ZOOM_MIN, Math.round((z - 0.5) * 2) / 2))
              }
            >
              <HiOutlineMinus className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <span className="min-w-[2rem] text-center text-[10px] tabular-nums text-[var(--muted)]">
              {Math.round(timeZoom * 100)}%
            </span>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
              title={t('editor.lottieTimeline.zoomIn')}
              aria-label={t('editor.lottieTimeline.zoomIn')}
              onClick={() =>
                setTimeZoom((z) => Math.min(TIME_ZOOM_MAX, Math.round((z + 0.5) * 2) / 2))
              }
            >
              <HiOutlinePlus className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <AnimationTransportControls
              playing={playing}
              loop={loop}
              ready={animationHasPlayableContent(animationData)}
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
          <span className="hidden min-w-[4.5rem] tabular-nums text-[11px] text-[var(--muted)] sm:inline">
            {playhead.toFixed(1)}s / {compDuration.toFixed(1)}s
          </span>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
            aria-label={t('editor.closePanel')}
            onClick={() => {
              setLottiePlaying({ playing: false, hostNodeId: nodeId });
              const host = getLottieHost(nodeId);
              host?.pause();
              host?.seek(0);
              exitLottiePrecompEdit();
              closeLottieTimelinePanel();
            }}
          >
            <HiOutlineXMark className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className="flex shrink-0 flex-col border-r border-[var(--line)]"
          style={{ width: LAYER_COL_W }}
        >
          <div
            className="flex shrink-0 items-center gap-1 border-b border-[var(--line)] pl-[15px] pr-1 text-[11px] font-medium text-[var(--muted)]"
            style={{ height: ROW_H }}
          >
            <span className="min-w-0 flex-1 truncate">
              {t('editor.layers')}
            </span>
            <Tooltip
              tip={t('editor.lottieTimeline.addTrack')}
              placement="top"
            >
              <button
                type="button"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--canvas)] hover:text-[var(--ink)] disabled:opacity-40"
                aria-label={t('editor.lottieTimeline.addTrack')}
                disabled={!animationData || activeScene?.kind === 'precomp'}
                onClick={addTimelineTrack}
              >
                <HiOutlinePlus className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </Tooltip>
            <Tooltip
              tip={t('editor.lottieTimeline.deleteTrack')}
              placement="top"
            >
              <button
                type="button"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--canvas)] hover:text-[var(--ink)] disabled:opacity-40"
                aria-label={t('editor.lottieTimeline.deleteTrack')}
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
              <div className="px-[15px] py-4 text-[12px] text-[var(--muted)]">
                {t('editor.lottieTimeline.empty')}
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
                          'absolute left-0 right-0 flex items-center gap-0.5 border-b border-[color-mix(in_srgb,var(--ink)_8%,transparent)] pl-[15px] pr-0.5',
                          selected && 'bg-[var(--accent-soft)]',
                          dragLayerId === row.layer.id && 'opacity-50'
                        )}
                        style={{ height: ROW_H, transform: `translateY(${vRow.start}px)` }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          openTimelineCtxMenu(e.clientX, e.clientY, {
                            kind: 'layer',
                            layerId: row.layer.id,
                            layerInd: row.layer.ind,
                          });
                        }}
                      >
                        {dropBefore ? (
                          <span className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-0.5 bg-[#EA580C]" />
                        ) : null}
                        <button
                          type="button"
                          className="inline-flex h-6 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-[var(--muted)] active:cursor-grabbing"
                          aria-label={t('editor.lottieTimeline.reorder')}
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
                          aria-label={
                            row.expanded
                              ? t('editor.lottieTimeline.collapseLayer')
                              : t('editor.lottieTimeline.expandLayer')
                          }
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
                            title={t('editor.lottieTimeline.renameHint')}
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
                      className="absolute left-0 right-0 flex items-center gap-1 border-b border-[color-mix(in_srgb,var(--ink)_6%,transparent)] pl-[calc(15px+1.75rem)] pr-1 text-[11px] text-[var(--muted)]"
                      style={{ height: ROW_H, transform: `translateY(${vRow.start}px)` }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        openTimelineCtxMenu(e.clientX, e.clientY, {
                          kind: 'prop',
                          propId: row.propId,
                          propKey: row.propKey,
                          layerId: row.layer.id,
                          layerInd: row.layer.ind,
                          times: row.times,
                        });
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {translateLottiePropLabel(t, row.propKey, row.label)}
                      </span>
                      <Tooltip
                        tip={
                          atPlayhead
                            ? t('editor.lottieTimeline.removeKf')
                            : t('editor.lottieTimeline.addKf')
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
          <AnimationTimelineCanvas
            rows={rows}
            duration={duration}
            fps={fps}
            playhead={playhead}
            workInSec={workInSec}
            workOutSec={workOutSec}
            workAreaPreview={workAreaPreview}
            selectedLayerId={selectedLayerId}
            selectedKf={selectedKf}
            kfGhost={kfGhost}
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
            onSeek={(sec) => {
              clearSelectedKf();
              seekTo(sec, { pause: true });
            }}
            onSelectLayer={(layer) => {
              clearSelectedKf();
              selectTimelineLayer(layer);
            }}
            onBeginClipDrag={(e, layer, mode) => {
              clearSelectedKf();
              beginClipDrag(e, layer, mode);
            }}
            onBeginWorkAreaDrag={(edge, clientX) => {
              clearSelectedKf();
              beginWorkAreaDrag(edge, clientX);
            }}
            onSelectKf={(propId, timeSec) => {
              setSelectedKf({ propId, timeSec });
              setKfPopoverOpen(false);
              setKfAnchor(null);
            }}
            onKfPointerDown={onKfPointerDown}
            onTracksContextMenu={onTracksContextMenu}
            onToggleKfAt={(layerInd, propKey, times, atSec) => {
              toggleKeyframeAtPlayhead(layerInd, propKey, times, atSec);
            }}
            onTimeZoomDelta={(delta) =>
              setTimeZoom((z) =>
                Math.max(TIME_ZOOM_MIN, Math.min(TIME_ZOOM_MAX, Math.round((z + delta) * 2) / 2))
              )
            }
          />
        </div>

      </div>

      <AnimationTimelineContextMenu
        menu={timelineCtxMenu}
        canPaste={kfClipboardTick > 0 && Boolean(kfClipboard)}
        onAction={onTimelineCtxAction}
        onClose={() => setTimelineCtxMenu(null)}
      />

      {kfPopoverOpen && selectedKf && kfAnchor && !kfGhost ? (
        <AnimationKeyframePopover
          open
          anchor={kfAnchor}
          propKey={parsePropId(selectedKf.propId)?.propKey || ''}
          propLabel={
            (() => {
              const row = rows.find(
                (r) => r.kind === 'prop' && r.propId === selectedKf.propId
              );
              if (!(row && row.kind === 'prop')) return undefined;
              return translateLottiePropLabel(t, row.propKey, row.label);
            })()
          }
          timeSec={selectedKf.timeSec}
          fps={fps}
          valueDraft={valueDraft}
          hold={kfHold}
          onChangeDraft={setValueDraft}
          onCommitValues={commitSelectedKfValues}
          onCommitChannel={commitSelectedKfChannel}
          onEasing={applySelectedKfEasing}
          onDelete={() => {
            deleteSelectedKf();
            clearSelectedKf();
          }}
          onClose={clearSelectedKf}
        />
      ) : null}
    </aside>
  );
}

export default memo(AnimationTimelineDock);
