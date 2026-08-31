import { useEffect, useMemo, useState, type ReactNode, memo } from 'react';
import { useDispatch, useSelector } from '@/store';
import { useSelectedNodeId } from '@/store/editorSelectors';
import { useTranslation } from 'react-i18next';
import { HiOutlineChevronDown } from 'react-icons/hi2';
import { BiExit } from 'react-icons/bi';
import { DropdownPanel, DropdownPanelItem, Icon, Tooltip } from '@/components/base';
import {
  PanelConfirmCost,
  IMAGE_TOOL_CREDIT_COST,
} from '@/components/editor/nodes/ImageNode/toolPanels/ImageToolPanelShell';
import {
  RcbOverlayPortal,
  rcbScreenPxToScene,
  useRcbCamera,
  useRcbScreenToolbarStyle,
} from '@/components/rcb';
import { FloatingToolbar } from '@/components/editor/chrome/FloatingToolbar';
import {
  closeImageToolPanel,
  startImageProcess,
} from '@/store/modules/editor';
import { nodeLeftTop } from '@/components/rcb/scene/paint/sceneToSvg';
import { cn } from '@/utils/classnames';
import { imageToolBtn, ImageToolSep } from './imageToolbarShared';
import type { SceneDocument, SceneNodeInput } from '@/components/rcb/sceneNode';

export type UpscaleResolution = '2K' | '4K';

export type UpscalePreset = {
  key: string;
  title: string;
  resolution: UpscaleResolution;
  width: number;
  height: number;
};

/** Real-ESRGAN upscale tiers on intelligence. */
export const UPSCALE_PRESETS: UpscalePreset[] = [
  {
    key: '2k',
    title: '2K',
    resolution: '2K',
    width: 2048,
    height: 2048,
  },
  {
    key: '4k',
    title: '4K',
    resolution: '4K',
    width: 4096,
    height: 4096,
  },
];

const UPSCALE_COST = IMAGE_TOOL_CREDIT_COST.upscale;

function nodeBox(document: SceneDocument, node: SceneNodeInput) {
  if (!node) return null;
  const { left, top } = nodeLeftTop(document, node);
  return {
    left,
    top,
    width: Math.max(1, Number(node.width) || 1),
    height: Math.max(1, Number(node.height) || 1),
  };
}

/**
 * Upscale session: compact bar under the image (same chrome as expand).
 * Resolution dropdown keeps the prior panel style; confirm + credits live on the bar.
 */
function UpscaleSessionHost({
  document,
  hidden = false,
}: {
  document: SceneDocument;
  hidden?: boolean;
}): ReactNode {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const camera = useRcbCamera();
  const panel = useSelector(
    (s: any) => s.editor.imageToolPanel as null | { nodeId: string; kind: string }
  );
  const selectedNodeId = useSelectedNodeId();

  const active = panel?.kind === 'upscale';
  const nodeId = active ? panel!.nodeId : null;
  const node = nodeId ? document?.deltaSetLike?.[nodeId] : null;
  const box = useMemo(() => nodeBox(document, node), [document, node]);

  const [selectedKey, setSelectedKey] = useState(UPSCALE_PRESETS[1]?.key ?? '4k');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!active) {
      setMenuOpen(false);
      return;
    }
    setSelectedKey(UPSCALE_PRESETS[1]?.key ?? '4k');
    setMenuOpen(false);
  }, [active, nodeId]);

  useEffect(() => {
    if (!active || !nodeId) return;
    if (!selectedNodeId || selectedNodeId !== nodeId) {
      dispatch(closeImageToolPanel());
    }
  }, [selectedNodeId, active, nodeId, dispatch]);

  useEffect(() => {
    if (!active || !nodeId) return;
    if (!node || node.key !== 'image') {
      dispatch(closeImageToolPanel());
    }
  }, [document, active, nodeId, node, dispatch]);

  const z = Math.max(0.05, camera.zoom || 1);
  const toolbarGap = rcbScreenPxToScene(10, z);
  const toolbarStyle = useRcbScreenToolbarStyle({
    left: box ? box.left + box.width / 2 : 0,
    top: box ? box.top + box.height + toolbarGap : 0,
    anchor: 'top',
  });

  if (!active || !nodeId || !box || hidden) return null;

  const selected =
    UPSCALE_PRESETS.find((p) => p.key === selectedKey) ?? UPSCALE_PRESETS[1] ?? UPSCALE_PRESETS[0];

  const close = () => dispatch(closeImageToolPanel());

  const onConfirm = () => {
    if (!selected) return;
    dispatch(
      startImageProcess({
        sourceId: nodeId,
        kind: 'upscale',
        label: t('editor.imageToolbar.processingUpscale'),
        targetWidth: selected.width,
        targetHeight: selected.height,
        meta: { resolution: selected.resolution },
      })
    );
    close();
  };

  return (
    <RcbOverlayPortal>
      <div
        data-upscale-toolbar
        data-sel-toolbar
        className="pointer-events-auto absolute z-[37]"
        style={toolbarStyle}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <FloatingToolbar className="relative gap-1 px-2.5 py-1.5">
          <span className="inline-flex h-8 min-w-[5.5rem] items-center gap-1.5 px-2 text-[12px] font-medium text-[var(--ink)]">
            <Icon name="editor-upscale" width={16} height={16} className="text-current" />
            <span>{t('editor.imageToolbar.upscale')}</span>
          </span>

          <ImageToolSep />

          <div className="relative">
            <button
              type="button"
              className={cn(
                imageToolBtn,
                'min-w-[5.5rem] justify-between gap-2 px-3 font-medium',
                menuOpen && 'bg-[var(--accent-soft)]'
              )}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span className="tabular-nums">{selected?.title ?? '4K'}</span>
              <HiOutlineChevronDown className="h-3 w-3 shrink-0 text-[var(--muted)]" />
            </button>

            {menuOpen ? (
              <DropdownPanel className="absolute bottom-[calc(100%+6px)] left-1/2 z-50 min-w-[11rem] -translate-x-1/2 p-1">
                {UPSCALE_PRESETS.map((p) => (
                  <DropdownPanelItem
                    key={p.key}
                    selected={p.key === selected?.key}
                    className="h-auto flex-col items-start gap-0.5 px-3 py-2"
                    onClick={() => {
                      setSelectedKey(p.key);
                      setMenuOpen(false);
                    }}
                  >
                    <span className="text-[12px] font-semibold tabular-nums">{p.title}</span>
                    <span className="text-[11px] font-normal text-[var(--muted)]">
                      {p.resolution === '2K'
                        ? t('editor.imageToolbar.upscale2kHint')
                        : t('editor.imageToolbar.upscale4kHint')}
                    </span>
                  </DropdownPanelItem>
                ))}
              </DropdownPanel>
            ) : null}
          </div>

          <ImageToolSep />

          <button
            type="button"
            className="inline-flex h-8 min-w-[5.75rem] items-center justify-center gap-1.5 rounded-xl px-4 text-[12px] font-medium bg-[var(--ink)] text-[var(--on-brand)] transition hover:opacity-90"
            onClick={onConfirm}
          >
            <span>{t('editor.imageToolbar.upscaleConfirm')}</span>
            <PanelConfirmCost amount={UPSCALE_COST} />
          </button>

          <Tooltip tip={t('editor.imageToolbar.panelExit', '退出')} placement="top">
            <button
              type="button"
              aria-label={t('editor.imageToolbar.panelExit', '退出')}
              className={cn(imageToolBtn, 'px-2.5')}
              onClick={close}
            >
              <BiExit className="h-[18px] w-[18px]" />
            </button>
          </Tooltip>
        </FloatingToolbar>
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(UpscaleSessionHost);
