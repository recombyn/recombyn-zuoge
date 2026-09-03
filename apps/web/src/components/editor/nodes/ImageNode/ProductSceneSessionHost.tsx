import { useEffect, useMemo, useState, type ReactNode, memo } from 'react';
import { useSelector } from '@/store';
import { useSelectedNodeId } from '@/store/editorSelectors';
import { useTranslation } from 'react-i18next';
import { HiOutlineChevronDown, HiOutlineShoppingBag } from 'react-icons/hi2';
import { BiExit } from 'react-icons/bi';
import { DropdownPanel, DropdownPanelItem, Tooltip } from '@/components/base';
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

/** Curated MediaKit standard_scene presets for the toolbar. */
export const PRODUCT_SCENE_PRESETS = [
  { code: 'exhibit_home', labelKey: 'exhibitHome' },
  { code: 'exhibit_simple', labelKey: 'exhibitSimple' },
  { code: 'exhibit_kitchen', labelKey: 'exhibitKitchen' },
  { code: 'exhibit_bathroom', labelKey: 'exhibitBathroom' },
  { code: 'exhibit_luxury', labelKey: 'exhibitLuxury' },
  { code: 'exhibit_modern', labelKey: 'exhibitModern' },
  { code: 'exhibit_forest', labelKey: 'exhibitForest' },
  { code: 'exhibit_stone', labelKey: 'exhibitStone' },
  { code: 'water_reflect', labelKey: 'waterReflect' },
  { code: 'exhibit_light', labelKey: 'exhibitLight' },
  { code: 'natural_pasture', labelKey: 'naturalPasture' },
  { code: 'exhibit_floor', labelKey: 'exhibitFloor' },
] as const;

const BATCH_OPTIONS = [1, 2, 4] as const;

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
 * Product-scene (电商万创) session: standard presets + batch count.
 * Professional / industry modes are available via agent meta.
 */
function ProductSceneSessionHost({
  document,
  hidden = false,
}: {
  document: SceneDocument;
  hidden?: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const camera = useRcbCamera();
  const panel = useSelector(
    (s: any) => s.editor.imageToolPanel as null | { nodeId: string; kind: string }
  );
  const selectedNodeId = useSelectedNodeId();

  const active = panel?.kind === 'productScene';
  const nodeId = active ? panel!.nodeId : null;
  const node = nodeId ? document?.deltaSetLike?.[nodeId] : null;
  const box = useMemo(() => nodeBox(document, node), [document, node]);

  const [sceneCode, setSceneCode] = useState(PRODUCT_SCENE_PRESETS[0].code);
  const [batchCount, setBatchCount] = useState<(typeof BATCH_OPTIONS)[number]>(1);
  const [sceneMenuOpen, setSceneMenuOpen] = useState(false);
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);

  useEffect(() => {
    if (!active) {
      setSceneMenuOpen(false);
      setBatchMenuOpen(false);
      return;
    }
    setSceneCode(PRODUCT_SCENE_PRESETS[0].code);
    setBatchCount(1);
    setSceneMenuOpen(false);
    setBatchMenuOpen(false);
  }, [active, nodeId]);

  useEffect(() => {
    if (!active || !nodeId) return;
    if (!selectedNodeId || selectedNodeId !== nodeId) {
      closeImageToolPanel();
    }
  }, [selectedNodeId, active, nodeId]);

  useEffect(() => {
    if (!active || !nodeId) return;
    if (!node || node.key !== 'image') {
      closeImageToolPanel();
    }
  }, [document, active, nodeId, node]);

  const z = Math.max(0.05, camera.zoom || 1);
  const toolbarGap = rcbScreenPxToScene(10, z);
  const toolbarStyle = useRcbScreenToolbarStyle({
    left: box ? box.left + box.width / 2 : 0,
    top: box ? box.top + box.height + toolbarGap : 0,
    anchor: 'top',
  });

  if (!active || !nodeId || !box || hidden) return null;

  const selected =
    PRODUCT_SCENE_PRESETS.find((p) => p.code === sceneCode) ?? PRODUCT_SCENE_PRESETS[0];

  const close = () => closeImageToolPanel();

  const onConfirm = () => {
    if (!selected) return;
    startImageProcess({
      sourceId: nodeId,
      kind: 'productScene',
      label: t('editor.imageToolbar.processingProductScene'),
      meta: {
        toolVersion: 'standard',
        standardScene: selected.code,
        batchCount,
        outputWidth: 600,
        outputHeight: 600,
      },
    });
    close();
  };

  return (
    <RcbOverlayPortal>
      <div
        data-product-scene-toolbar
        data-sel-toolbar
        className="pointer-events-auto absolute z-[37]"
        style={toolbarStyle}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <FloatingToolbar className="relative gap-1 px-2.5 py-1.5">
          <span className="inline-flex h-8 min-w-[5.5rem] items-center gap-1.5 px-2 text-[12px] font-medium text-[var(--ink)]">
            <HiOutlineShoppingBag className="h-4 w-4 shrink-0 text-current" />
            <span>{t('editor.imageToolbar.productScene')}</span>
          </span>

          <ImageToolSep />

          <div className="relative">
            <button
              type="button"
              className={cn(
                imageToolBtn,
                'min-w-[7rem] justify-between gap-2 px-3 font-medium',
                sceneMenuOpen && 'bg-[var(--accent-soft)]'
              )}
              onClick={() => {
                setSceneMenuOpen((v) => !v);
                setBatchMenuOpen(false);
              }}
            >
              <span className="max-w-[8rem] truncate">
                {t(`editor.imageToolbar.productScenePreset.${selected.labelKey}`, {
                  defaultValue: selected.code,
                })}
              </span>
              <HiOutlineChevronDown className="h-3 w-3 shrink-0 text-[var(--muted)]" />
            </button>

            {sceneMenuOpen ? (
              <DropdownPanel className="absolute bottom-[calc(100%+6px)] left-1/2 z-50 max-h-64 min-w-[11rem] -translate-x-1/2 overflow-y-auto p-1">
                {PRODUCT_SCENE_PRESETS.map((p) => (
                  <DropdownPanelItem
                    key={p.code}
                    selected={p.code === selected?.code}
                    className="px-3 py-2"
                    onClick={() => {
                      setSceneCode(p.code);
                      setSceneMenuOpen(false);
                    }}
                  >
                    {t(`editor.imageToolbar.productScenePreset.${p.labelKey}`, {
                      defaultValue: p.code,
                    })}
                  </DropdownPanelItem>
                ))}
              </DropdownPanel>
            ) : null}
          </div>

          <div className="relative">
            <button
              type="button"
              className={cn(
                imageToolBtn,
                'min-w-[4.5rem] justify-between gap-2 px-3 font-medium tabular-nums',
                batchMenuOpen && 'bg-[var(--accent-soft)]'
              )}
              onClick={() => {
                setBatchMenuOpen((v) => !v);
                setSceneMenuOpen(false);
              }}
            >
              <span>×{batchCount}</span>
              <HiOutlineChevronDown className="h-3 w-3 shrink-0 text-[var(--muted)]" />
            </button>

            {batchMenuOpen ? (
              <DropdownPanel className="absolute bottom-[calc(100%+6px)] left-1/2 z-50 min-w-[7rem] -translate-x-1/2 p-1">
                {BATCH_OPTIONS.map((n) => (
                  <DropdownPanelItem
                    key={n}
                    selected={n === batchCount}
                    className="px-3 py-2 tabular-nums"
                    onClick={() => {
                      setBatchCount(n);
                      setBatchMenuOpen(false);
                    }}
                  >
                    {t('editor.imageToolbar.productSceneBatch', { count: n })}
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
            <span>{t('editor.imageToolbar.productSceneConfirm')}</span>
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

export default memo(ProductSceneSessionHost);
