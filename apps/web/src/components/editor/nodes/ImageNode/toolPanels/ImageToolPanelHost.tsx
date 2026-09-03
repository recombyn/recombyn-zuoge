import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, memo } from 'react';
import { useSelector } from '@/store';
import { useSelectedNodeId, useSelectedNodeIds } from '@/store/editorSelectors';
import { useTranslation } from 'react-i18next';
import { message } from '@/components/base';
import { getHttpErrorMessage } from '@/service/client';
import {
  closeImageToolPanel,
  patchDocumentNode,
  pushEditorHistory,
  startImageProcess,
  type ImageToolPanelKind,
  isImageToolExternalSessionKind,
  isNodeLayerToolPanelKind,
  shouldClearImageToolPanelOnSelect,
} from '@/store/modules/editor';
import { isImageProcessRunning } from '@/components/rcb/scene/document/nodeCapabilities';
import { buildNodeAdjustFilterCss } from '@/components/rcb/scene/document/sceneFill';
import { nodeLeftTop } from '@/components/rcb/scene/paint/sceneToSvg';
import { toolbarBoxForSelection } from '@/components/rcb/selection/selectionLogic';
import {
  RcbOverlayPortal,
  useRcbCamera,
  useRcbDevicePixelRatio,
  rcbSceneToScreen,
} from '@/components/rcb';
import {
  layerOpacityToPct,
  parseLayerOpacity,
  type BlendModeId,
} from '@/components/rcb/selection/chrome/BlendModeControl';
import EraserMaskOverlay, { type EraserMaskOverlayHandle } from './EraserMaskOverlay';
import EraserToolPanel from './EraserToolPanel';
import MattingHintOverlay, {
  type MattingBrushMode,
  type MattingHintOverlayHandle,
} from './MattingHintOverlay';
import RemoveBgToolPanel from './RemoveBgToolPanel';
import { defaultBrushSize } from './maskBrushUtils';
import { startEraserFromMask } from './eraserSession';
import { startRemoveBgFromMasks } from './removeBgSession';
import OpacityToolPanel from './OpacityToolPanel';
import PuppetToolPanel from './PuppetToolPanel';
import MultiAngleToolPanel from './MultiAngleToolPanel';
import AdjustToolPanel, {
  parseAdjustValues,
  type AdjustValues,
} from './AdjustToolPanel';
import ReplaceTextToolPanel from './ReplaceTextToolPanel';
import EffectsToolPanel, { EFFECTS_RESET } from './EffectsToolPanel';
import BlendModeToolPanel from './BlendModeToolPanel';
import {
  PUPPET_DENSITY_DEFAULT,
  readPuppetDensity,
  readPuppetTrack,
} from '@/components/editor/nodes/ImageNode/puppet/puppetModel';
import { requestPuppetWarpApply } from '@/components/editor/nodes/ImageNode/puppet/puppetWarpApplyEvent';
import { resolveAnimationFrameId } from '@/components/editor/nodes/AnimationNode/resolveAnimationFrameId';
import type { SceneDocument, SceneNode, SceneNodeInput } from '@/components/rcb/sceneNode';

/** Dock Eraser / Replace text / — to the image's top-right (not the selection toolbar). */
function panelStyleRight(
  camera: { x: number; y: number; zoom: number },
  box: { left: number; top: number; width: number; height: number },
  dpr?: number
): CSSProperties {
  const gap = 16 / Math.max(0.05, camera.zoom);
  // Top edge of the image, just outside the right edge — same as Eraser card.
  const { x, y } = rcbSceneToScreen(
    camera,
    box.left + box.width + gap,
    box.top,
    dpr
  );
  return {
    position: 'absolute',
    left: x,
    top: y,
    zIndex: 40,
  };
}

function isLineOrArrow(node: SceneNodeInput): boolean {
  const t = String(node?.attrs?.shapeType || '');
  return t === 'line' || t === 'arrow';
}

function nodeBox(
  document: SceneDocument,
  node: SceneNodeInput
): { left: number; top: number; width: number; height: number } | null {
  if (!node) return null;
  const { left, top } = nodeLeftTop(document, node);
  const box = {
    left,
    top,
    width: Math.max(1, Number(node.width) || 1),
    height: Math.max(1, Number(node.height) || 1),
  };
  // Line/arrow store a fat hit AABB. Dock blend/effects to the shaft AABB
  // (same as the selection toolbar) so the panel sits at the visual top-right.
  return (
    toolbarBoxForSelection(box, {
      lineChrome: isLineOrArrow(node),
      node,
    }) || box
  );
}

/** Host for image tool panels positioned relative to the source image. */
function ImageToolPanelHost({
  document,
  hidden = false,
}: {
  document: SceneDocument;
  /** Hide docked side panel while selection is transforming (drag/resize). */
  hidden?: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const camera = useRcbCamera();
  const dpr = useRcbDevicePixelRatio();
  const panel = useSelector((s: any) => s.editor.imageToolPanel as null | {
    nodeId: string;
    kind: ImageToolPanelKind;
  });
  const timelineOpen = useSelector((s: any) => Boolean(s.editor.lottieTimelinePanel));
  const selectedNodeId = useSelectedNodeId();
  const selectedNodeIds = useSelectedNodeIds();
  const effectiveSelectedId =
    selectedNodeId ||
    (selectedNodeIds.length === 1 ? String(selectedNodeIds[0]) : null);

  const [brushSize, setBrushSize] = useState(96);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [eraseBusy, setEraseBusy] = useState(false);
  const [mattingBrushMode, setMattingBrushMode] = useState<MattingBrushMode>('include');
  const [mattingBusy, setMattingBusy] = useState(false);
  const maskRef = useRef<EraserMaskOverlayHandle>(null);
  const mattingMaskRef = useRef<MattingHintOverlayHandle>(null);
  const adjustHistoryPushedRef = useRef(false);
  const adjustBaselineRef = useRef<{ cssFilter: string; adjustValues: unknown } | null>(null);
  const liveHistoryPushedRef = useRef(false);

  useEffect(() => {
    if (!panel) return;
    // Stay open when the panel's node is still in the selection (multi or single).
    const stillSelected =
      (effectiveSelectedId != null && effectiveSelectedId === panel.nodeId) ||
      selectedNodeIds.includes(panel.nodeId);
    if (!stillSelected && shouldClearImageToolPanelOnSelect(panel, effectiveSelectedId)) {
      closeImageToolPanel();
      return;
    }
    const node = document?.deltaSetLike?.[panel.nodeId];
    if (
      isImageProcessRunning(node) &&
      !isImageToolExternalSessionKind(panel.kind) &&
      panel.kind !== 'puppet'
    ) {
      closeImageToolPanel();
    }
  }, [effectiveSelectedId, selectedNodeIds, panel, document]);

  useEffect(() => {
    if (!panel) return;
    // Crop / expand / flipRotate / media quick-edit are owned outside this host.
    if (isImageToolExternalSessionKind(panel.kind)) return;
    const node = document?.deltaSetLike?.[panel.nodeId];
    if (!node) {
      closeImageToolPanel();
      return;
    }
    if (!isNodeLayerToolPanelKind(panel.kind) && node.key !== 'image') {
      closeImageToolPanel();
      return;
    }
    // Puppet is workbench-only (needs timeline / playhead sampling).
    if (panel.kind === 'puppet' && !resolveAnimationFrameId(document, node)) {
      closeImageToolPanel();
    }
  }, [document, panel]);

  useEffect(() => {
    if (!panel?.nodeId) return;
    if (panel.kind !== 'eraser' && panel.kind !== 'removeBg') return;

    const node = document?.deltaSetLike?.[panel.nodeId];
    const boxNow = nodeBox(document, node);
    if (!boxNow) return;

    setBrushSize(defaultBrushSize(boxNow));
    setHasStrokes(false);

    if (panel.kind === 'eraser') {
      setEraseBusy(false);
      maskRef.current?.clear();
      return;
    }

    setMattingBusy(false);
    setMattingBrushMode('include');
    mattingMaskRef.current?.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel?.kind, panel?.nodeId]);

  // Snapshot adjust attrs once when the panel opens (for cancel restore).
  useEffect(() => {
    if (panel?.kind !== 'adjust' || !panel.nodeId) {
      adjustHistoryPushedRef.current = false;
      adjustBaselineRef.current = null;
      return;
    }
    const node = document?.deltaSetLike?.[panel.nodeId];
    adjustHistoryPushedRef.current = false;
    adjustBaselineRef.current = {
      cssFilter: String(node?.attrs?.cssFilter || '').trim(),
      adjustValues: node?.attrs?.adjustValues ?? null,
    };
    // Only re-snapshot when opening / switching image — not on every doc patch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel?.kind, panel?.nodeId]);

  useEffect(() => {
    if (
      panel?.kind !== 'effects' &&
      panel?.kind !== 'blendMode' &&
      panel?.kind !== 'opacity' &&
      panel?.kind !== 'puppet'
    ) {
      return;
    }
    liveHistoryPushedRef.current = false;
  }, [panel?.kind, panel?.nodeId]);

  const box = useMemo(() => {
    if (!panel) return null;
    return nodeBox(document, document?.deltaSetLike?.[panel.nodeId]);
  }, [document, panel]);

  if (!panel || !box) return null;
  // Flip/rotate + Chat quick-edit use the selection floating toolbar; crop/expand use on-canvas frame.
  if (isImageToolExternalSessionKind(panel.kind)) {
    return null;
  }

  const close = () => closeImageToolPanel();

  const runProcess = (kind: ImageToolPanelKind, label: string, size?: {
    targetWidth?: number;
    targetHeight?: number;
  }) => {
    startImageProcess({
        sourceId: panel.nodeId,
        kind,
        label,
        targetWidth: size?.targetWidth,
        targetHeight: size?.targetHeight,
      });
    close();
  };

  const style = panelStyleRight(camera, box, dpr);

  const writeAdjustAttrs = (opts: AdjustValues, mode: 'preview' | 'commit') => {
    const node = document?.deltaSetLike?.[panel.nodeId];
    const filter = buildNodeAdjustFilterCss(opts);
    const cssFilter = filter === 'none' ? '' : filter;
    const adjustValues = JSON.stringify(opts);
    if (mode === 'preview') {
      if (!adjustHistoryPushedRef.current) {
        adjustHistoryPushedRef.current = true;
        pushEditorHistory();
      }
      patchDocumentNode({
          nodeId: panel.nodeId,
          skipHistory: true,
          patch: {
            attrs: {
              ...(node?.attrs || {}),
              cssFilter,
              adjustValues,
            },
          },
        });
      return;
    }
    const skipHistory = adjustHistoryPushedRef.current;
    adjustHistoryPushedRef.current = false;
    patchDocumentNode({
        nodeId: panel.nodeId,
        skipHistory,
        patch: {
          attrs: {
            ...(node?.attrs || {}),
            cssFilter,
            adjustValues,
          },
        },
      });
  };

  const writeAttrPatch = (patch: Record<string, unknown>, mode: 'preview' | 'commit') => {
    const node = document?.deltaSetLike?.[panel.nodeId];
    if (mode === 'preview' && !liveHistoryPushedRef.current) {
      liveHistoryPushedRef.current = true;
      pushEditorHistory();
    }
    const skipHistory =
      mode === 'preview' || (mode === 'commit' && liveHistoryPushedRef.current);
    if (mode === 'commit') liveHistoryPushedRef.current = false;
    patchDocumentNode({
        nodeId: panel.nodeId,
        skipHistory,
        patch: {
          attrs: {
            ...(node?.attrs || {}),
            ...patch,
          },
        },
      });
  };

  const closeLiveAttrPanel = () => {
    if (
      liveHistoryPushedRef.current &&
      (panel.kind === 'opacity' ||
        panel.kind === 'effects' ||
        panel.kind === 'blendMode' ||
        panel.kind === 'puppet')
    ) {
      liveHistoryPushedRef.current = false;
    }
    close();
  };

  let body: ReactNode = null;
  switch (panel.kind) {
    case 'opacity': {
      const node = document?.deltaSetLike?.[panel.nodeId];
      body = (
        <OpacityToolPanel
          opacityPct={layerOpacityToPct(parseLayerOpacity(node?.attrs?.opacity, 1))}
          onOpacityPctChange={(v) =>
            writeAttrPatch({ opacity: Math.min(1, Math.max(0, Math.round(v) / 100)) }, 'preview')
          }
          onReset={() => writeAttrPatch({ opacity: 1 }, 'preview')}
          onClose={closeLiveAttrPanel}
        />
      );
      break;
    }
    case 'puppet': {
      const node = document?.deltaSetLike?.[panel.nodeId];
      const attrs = (node?.attrs || {}) as Record<string, unknown>;
      body = (
        <PuppetToolPanel
          density={readPuppetDensity(attrs)}
          keyframeCount={readPuppetTrack(attrs).length}
          timelineOpen={timelineOpen}
          onDensityChange={(v) => {
            writeAttrPatch(
              { puppetEnabled: true, puppetDensity: Math.round(v) },
              'preview'
            );
            requestPuppetWarpApply();
          }}
          onReset={() => {
            writeAttrPatch(
              { puppetEnabled: true, puppetDensity: PUPPET_DENSITY_DEFAULT },
              'preview'
            );
            requestPuppetWarpApply();
          }}
          onClose={closeLiveAttrPanel}
        />
      );
      break;
    }
    case 'eraser':
      body = (
        <EraserToolPanel
          brushSize={brushSize}
          onBrushSizeChange={setBrushSize}
          hasStrokes={hasStrokes}
          confirmBusy={eraseBusy}
          onReset={() => {
            setBrushSize(defaultBrushSize(box));
            maskRef.current?.clear();
            setHasStrokes(false);
          }}
          onCancel={close}
          onConfirm={async () => {
            if (!hasStrokes || eraseBusy) return;
            const sourceId = panel.nodeId;
            const node = document?.deltaSetLike?.[sourceId];
            const src = String(node?.attrs?.src || '');
            if (!src) {
              message.error(t('editor.imageToolbar.imageNotFound'));
              return;
            }
            setEraseBusy(true);
            try {
              const eraseMask = await maskRef.current?.exportMask();
              if (!eraseMask) {
                message.error(t('editor.imageToolbar.eraserNoImage'));
                return;
              }
              await startEraserFromMask({
                eraseMask,
                sourceId,
                label: t('editor.imageToolbar.processingEraser'),
                onSpawned: close,
              });
            } catch (err: unknown) {
              const raw = getHttpErrorMessage(err, '');
              const msg =
                /failed to fetch|networkerror|load failed/i.test(raw)
                  ? t('agent.apiDown')
                  : raw || t('editor.imageToolbar.eraserFailed');
              message.error(msg);
            } finally {
              setEraseBusy(false);
            }
          }}
        />
      );
      break;
    case 'removeBg':
      body = (
        <RemoveBgToolPanel
          brushSize={brushSize}
          onBrushSizeChange={setBrushSize}
          brushMode={mattingBrushMode}
          onBrushModeChange={setMattingBrushMode}
          hasStrokes={hasStrokes}
          confirmBusy={mattingBusy}
          onReset={() => {
            setBrushSize(defaultBrushSize(box));
            mattingMaskRef.current?.clear();
            setHasStrokes(false);
          }}
          onCancel={close}
          onConfirm={async () => {
            if (mattingBusy) return;
            const sourceId = panel.nodeId;
            const node = document?.deltaSetLike?.[sourceId];
            const src = String(node?.attrs?.src || '');
            if (!src) {
              message.error(t('editor.imageToolbar.imageNotFound'));
              return;
            }
            setMattingBusy(true);
            try {
              await startRemoveBgFromMasks({
                maskRef: mattingMaskRef.current,
                sourceId,
                label: t('editor.imageToolbar.processingRemoveBg'),
                onSpawned: close,
              });
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : '';
              message.error(msg || '抠图准备失败');
            } finally {
              setMattingBusy(false);
            }
          }}
        />
      );
      break;
    case 'multiAngle': {
      const node = document?.deltaSetLike?.[panel.nodeId];
      body = (
        <MultiAngleToolPanel
          imageSrc={String(node?.attrs?.src || '') || undefined}
          onCancel={close}
          onConfirm={(opts) => {
            startImageProcess({
                sourceId: panel.nodeId,
                kind: 'multiAngle',
                label: '多角度生成中',
                meta: {
                  rotate: opts.rotate,
                  tilt: opts.tilt,
                  zoom: opts.zoom,
                  mode: opts.mode,
                },
              });
            close();
          }}
        />
      );
      break;
    }
    case 'adjust': {
      const node = document?.deltaSetLike?.[panel.nodeId];
      const saved = parseAdjustValues(
        adjustBaselineRef.current?.adjustValues ?? node?.attrs?.adjustValues
      );
      body = (
        <AdjustToolPanel
          key={`${panel.nodeId}-adjust`}
          initialValues={saved}
          onChange={(opts) => writeAdjustAttrs(opts, 'preview')}
          onCancel={() => {
            const baseline = adjustBaselineRef.current;
            const n = document?.deltaSetLike?.[panel.nodeId];
            patchDocumentNode({
                nodeId: panel.nodeId,
                skipHistory: true,
                patch: {
                  attrs: {
                    ...(n?.attrs || {}),
                    cssFilter: baseline?.cssFilter ?? '',
                    adjustValues: baseline?.adjustValues ?? null,
                  },
                },
              });
            close();
          }}
          onConfirm={(opts) => {
            writeAdjustAttrs(opts, 'commit');
            close();
          }}
        />
      );
      break;
    }
    case 'effects': {
      const node = document?.deltaSetLike?.[panel.nodeId];
      body = (
        <EffectsToolPanel
          key={`${panel.nodeId}-effects`}
          attrs={node?.attrs}
          onChange={(patch) => writeAttrPatch(patch, 'preview')}
          onReset={() => writeAttrPatch(EFFECTS_RESET, 'preview')}
          onClose={closeLiveAttrPanel}
        />
      );
      break;
    }
    case 'blendMode': {
      const node = document?.deltaSetLike?.[panel.nodeId];
      body = (
        <BlendModeToolPanel
          key={`${panel.nodeId}-blendMode`}
          blendMode={node?.attrs?.blendMode}
          onChange={(mode: BlendModeId) => writeAttrPatch({ blendMode: mode }, 'preview')}
          onReset={() => writeAttrPatch({ blendMode: 'normal' }, 'preview')}
          onClose={closeLiveAttrPanel}
        />
      );
      break;
    }
    case 'replaceText': {
      const node = document?.deltaSetLike?.[panel.nodeId];
      const initialOriginal = String(
        node?.attrs?.letteringText || node?.attrs?.replaceTextOriginal || ''
      ).trim();
      body = (
        <ReplaceTextToolPanel
          key={`${panel.nodeId}-replaceText`}
          initialOriginal={initialOriginal}
          onCancel={close}
          onConfirm={(opts) => {
            startImageProcess({
                sourceId: panel.nodeId,
                kind: 'replaceText',
                label: t('editor.imageToolbar.processingReplaceText'),
                meta: {
                  originalText: opts.originalText,
                  newText: opts.newText,
                },
              });
            close();
          }}
        />
      );
      break;
    }
    default:
      break;
  }

  return (
    <>
      {panel.kind === 'eraser' ? (
        <EraserMaskOverlay
          ref={maskRef}
          imageBox={box}
          brushSize={brushSize}
          onDirtyChange={setHasStrokes}
        />
      ) : null}
      {panel.kind === 'removeBg' ? (
        <MattingHintOverlay
          ref={mattingMaskRef}
          imageBox={box}
          brushSize={brushSize}
          brushMode={mattingBrushMode}
          onDirtyChange={setHasStrokes}
        />
      ) : null}
      <RcbOverlayPortal>
        <div
          className="pointer-events-auto"
          style={{
            ...style,
            ...(hidden
              ? { visibility: 'hidden' as const, pointerEvents: 'none' as const }
              : null),
          }}
          aria-hidden={hidden}
          data-image-tool-panel
          onPointerDown={(e) => {
            // Stop bubble so canvas selection/pan does not run; do not use capture —
            // capture stopPropagation blocks panel internals (e.g. angle-editor drag).
            e.stopPropagation();
          }}
          onWheel={(e) => {
            e.stopPropagation();
          }}
        >
          {body}
        </div>
      </RcbOverlayPortal>
    </>
  );
}

export default memo(ImageToolPanelHost);
