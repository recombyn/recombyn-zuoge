import { useEffect, useMemo, useState, type CSSProperties, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from '@/store';
import {
  RcbOverlayPortal,
  useRcbCamera,
  rcbSceneToScreen,
} from '@/components/rcb';
import {
  isImageGeneratorNode
} from '@/components/rcb/scene/document/nodeCapabilities';
import {
  listImageVariantUrls,
  promptForImageSrc,
  applyVariantPromptPatch,
} from '@/components/rcb/scene/document/mediaLifecycle';
import { detachImageVariant, patchDocumentNode } from '@/store/modules/editor';
import { cn } from '@/utils/classnames';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import {
  setImageVariantsExpanded,
  useImageVariantsExpandedNodeId,
} from '@/components/editor/nodes/ImageNode/imageVariantsExpand';
const EDGE_PAD = 10;
const EXPAND_GAP = 12;
/** Two action pills side-by-side at 1× — used to fit within the tile width. */
const ACTION_ROW_REF_W = 168;
/** Shrink badge / action chrome when the on-screen tile is smaller than this. */
const UI_SCALE_REF_PX = 128;

type SceneBox = { left: number; top: number; width: number; height: number };

function variantStackUiScale(stageW: number, stageH: number): number {
  const w = Math.max(1, stageW);
  const h = Math.max(1, stageH);
  const minSide = Math.min(w, h);
  const bySide =
    minSide >= UI_SCALE_REF_PX ? 1 : Math.max(0.28, minSide / UI_SCALE_REF_PX);
  const innerW = Math.max(1, w - EDGE_PAD * 2);
  const byWidth = Math.min(1, innerW / ACTION_ROW_REF_W);
  return Math.min(bySide, byWidth);
}

function variantActionLayout(uiScale: number): {
  pad: number;
  btnH: number;
  fontPx: number;
  px: number;
  stack: boolean;
} {
  const pad = Math.max(4, Math.round(8 * uiScale));
  const btnH = Math.max(18, Math.round(28 * uiScale));
  const fontPx = Math.max(9, Math.round(11 * uiScale));
  const px = Math.max(4, Math.round(8 * uiScale));
  return { pad, btnH, fontPx, px, stack: uiScale < 0.55 };
}

/** Full-size alt tiles — 2×2 grid around main (main = bottom-left cell). */
function surroundAltLayout(
  main: { left: number; top: number; width: number; height: number },
  count: number,
  gap = EXPAND_GAP
) {
  if (count <= 0) return [];
  const w = main.width;
  const h = main.height;
  const slots = [
    { left: main.left, top: main.top - h - gap, width: w, height: h },
    { left: main.left + w + gap, top: main.top - h - gap, width: w, height: h },
    { left: main.left + w + gap, top: main.top, width: w, height: h },
  ];
  return slots.slice(0, count);
}

/**
 * Multi-gen stack: top-right “N张图—count + expand tiles.
 * Positioned from the same scene box as selection chrome so controls never overlap.
 */
function ImageVariantsOverlay({
  document,
  nodeId,
  box,
  angle = 0,
  imageHovered = false,
  hidden,
  readOnly,
}: {
  document: SceneDocument;
  nodeId: string;
  /** Scene-space image box (same as SelectionFeature chrome). */
  box: SceneBox;
  angle?: number;
  imageHovered?: boolean;
  hidden?: boolean;
  readOnly?: boolean;
}): ReactNode {
  const { t } = useTranslation();  const camera = useRcbCamera();
  const [barHovered, setBarHovered] = useState(false);
  const expandedNodeId = useImageVariantsExpandedNodeId();
  const expanded = expandedNodeId === nodeId;

  const nodeFromStore = useSelector(
    (state: { editor?: { document?: SceneDocument } }) =>
      nodeId ? state.editor?.document?.deltaSetLike?.[nodeId] : null
  );
  const node = nodeFromStore || (nodeId ? document?.deltaSetLike?.[nodeId] : null);
  const urls = useMemo(() => (node ? listImageVariantUrls(node) : []), [node]);
  const mainSrc = String(node?.attrs?.src || '').trim();
  const alts = useMemo(() => urls.filter((u) => u !== mainSrc), [urls, mainSrc]);
  const canShow =
    !hidden &&
    !readOnly &&
    Boolean(node) &&
    Boolean(nodeId) &&
    node?.key === 'image' &&
    (!isImageGeneratorNode(node) || Boolean(mainSrc)) &&
    urls.length > 1 &&
    String(node?.attrs?.processStatus || '') !== 'running';

  useEffect(() => {
    if (expandedNodeId && expandedNodeId !== nodeId) return;
    if (!expanded) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImageVariantsExpanded(null);
    };
    window.addEventListener('keydown', onKey);
    let removePointer: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      const onPointer = (e: PointerEvent) => {
        const el = e.target as HTMLElement | null;
        if (el?.closest?.('[data-image-variants]')) return;
        setImageVariantsExpanded(null);
      };
      window.addEventListener('pointerdown', onPointer, true);
      removePointer = () => window.removeEventListener('pointerdown', onPointer, true);
    }, 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
      removePointer?.();
    };
  }, [expanded, expandedNodeId, nodeId]);

  if (!canShow || !node || !nodeId) return null;

  const tl = rcbSceneToScreen(camera, box.left, box.top);
  const br = rcbSceneToScreen(camera, box.left + box.width, box.top + box.height);
  const stageBox = {
    left: Math.min(tl.x, br.x),
    top: Math.min(tl.y, br.y),
    width: Math.abs(br.x - tl.x),
    height: Math.abs(br.y - tl.y),
  };
  const count = urls.length;
  const uiScale = variantStackUiScale(stageBox.width, stageBox.height);
  const edgePad = EDGE_PAD * uiScale;
  const gapScene = EXPAND_GAP * uiScale;
  const actions = variantActionLayout(uiScale);
  const altLayout = surroundAltLayout(stageBox, alts.length, gapScene);
  const visible = urls.length > 1 || imageHovered || barHovered || expanded;

  const frameStyle: CSSProperties = {
    position: 'absolute',
    left: stageBox.left,
    top: stageBox.top,
    width: stageBox.width,
    height: stageBox.height,
    transform: Math.abs(angle) > 0.001 ? `rotate(${angle}deg)` : undefined,
    transformOrigin: 'center center',
  };

  const setMain = (url: string) => {
    if (!nodeId || url === mainSrc) return;
    const attrs = { ...(node.attrs || {}) } as Record<string, unknown>;
    attrs.src = url;
    const prompt = promptForImageSrc(node.attrs, url);
    applyVariantPromptPatch(attrs, url, prompt);
    patchDocumentNode({
        nodeId,
        patch: { attrs },
      });
  };

  const detach = (url: string) => {
    if (!nodeId) return;
    detachImageVariant({
        nodeId,
        url,
        name: t('editor.tools.imageDetachedName'),
      });
    setImageVariantsExpanded(null);
  };

  const toggleExpanded = () => {
    setImageVariantsExpanded(expanded ? null : nodeId);
  };

  return (
    <RcbOverlayPortal>
      <div
        data-image-variants
        data-sel-toolbar
        data-scene-node-id={nodeId}
        className="pointer-events-none"
      >
        {/* Corner count — hover-visible; replace lives in the context menu */}
        <div className="pointer-events-none absolute z-[36]" style={frameStyle}>
          <div
            data-image-variants-bar
            data-image-node-id={nodeId}
            className={cn(
              'absolute flex items-center gap-1 transition-opacity duration-150',
              visible
                ? 'pointer-events-auto opacity-100'
                : 'pointer-events-none opacity-0'
            )}
            style={{
              right: edgePad,
              top: edgePad,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerEnter={() => setBarHovered(true)}
            onPointerLeave={() => setBarHovered(false)}
          >
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={
                expanded
                  ? t('editor.tools.imageStackCollapse')
                  : t('editor.tools.imageStackExpand', { count })
              }
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded();
              }}
              className={cn(
                'inline-flex items-center justify-center whitespace-nowrap rounded-[3px] font-semibold leading-none text-white shadow-[0_2px_8px_rgba(15,23,42,0.2)] transition',
                expanded ? 'bg-[var(--ink)]' : 'bg-[#1a1a1a] hover:bg-[#2a2a2a]'
              )}
              style={{
                height: Math.max(16, Math.round(20 * uiScale)),
                minWidth: Math.max(16, Math.round(20 * uiScale)),
                paddingInline: Math.max(4, Math.round(6 * uiScale)),
                fontSize: Math.max(9, Math.round(11 * uiScale)),
              }}
            >
              {t('editor.tools.imageStackCount', { count })}
            </button>
          </div>
        </div>

        {expanded
          ? alts.map((url, i) => {
              const pos = altLayout[i] || {
                left: stageBox.left - stageBox.width - gapScene,
                top: stageBox.top,
                width: stageBox.width,
                height: stageBox.height,
              };
              const cardStyle: CSSProperties = {
                position: 'absolute',
                left: pos.left,
                top: pos.top,
                width: pos.width,
                height: pos.height,
                transform: Math.abs(angle) > 0.001 ? `rotate(${angle}deg)` : undefined,
                transformOrigin: 'center center',
              };
              return (
                <div
                  key={`${nodeId}-alt-${i}-${url.slice(-24)}`}
                  className="pointer-events-auto absolute z-[36] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] shadow-[0_8px_28px_rgba(15,23,42,0.18)]"
                  style={cardStyle}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
                  <div
                    className={cn(
                      'absolute flex max-w-[calc(100%-8px)] items-center gap-0.5',
                      actions.stack ? 'flex-col items-end' : 'flex-row'
                    )}
                    style={{
                      right: actions.pad,
                      top: actions.pad,
                      maxWidth: `calc(100% - ${actions.pad * 2}px)`,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setMain(url)}
                      className="inline-flex max-w-full items-center justify-center truncate rounded-md bg-black/65 font-medium text-white transition hover:bg-black/80"
                      style={{
                        height: actions.btnH,
                        paddingInline: actions.px,
                        fontSize: actions.fontPx,
                      }}
                    >
                      {t('editor.tools.imageStackSetMain')}
                    </button>
                    <button
                      type="button"
                      onClick={() => detach(url)}
                      className="inline-flex max-w-full items-center justify-center truncate rounded-md bg-black/65 font-medium text-white transition hover:bg-black/80"
                      style={{
                        height: actions.btnH,
                        paddingInline: actions.px,
                        fontSize: actions.fontPx,
                      }}
                    >
                      {t('editor.tools.imageStackDetach')}
                    </button>
                  </div>
                </div>
              );
            })
          : null}
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(ImageVariantsOverlay);
