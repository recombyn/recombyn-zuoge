import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineChevronDown, HiOutlineMap } from 'react-icons/hi2';
import { Dropdown, Tooltip } from '@/components/base';
import type { MenuItemType } from '@/components/base/dropdown/MenuItem';
import { FloatingToolbar } from '@/components/editor/chrome/FloatingToolbar';
import EditorMinimap from '@/components/editor/chrome/EditorMinimap';
import type { ArtboardFrame } from '@/store/modules/editor';
import type { RcbCamera as CanvasCamera } from '@/components/rcb';
import { cn } from '@/utils/classnames';
import type { SceneDocument } from '@/components/rcb/sceneNode';

const ZOOM_TRIGGER_BASE =
  'inline-flex h-7 min-w-[2.75rem] items-center justify-center gap-1.5 rounded px-2.5 transition-colors';
const ZOOM_TRIGGER_OPEN = 'bg-[var(--accent-soft)] text-[var(--ink)]';
const ZOOM_TRIGGER_IDLE =
  'text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]';
const HUD_ICON = 'h-4 w-4';

const ZOOM_MENU_PRESETS = [
  { key: '25', zoom: 0.25 },
  { key: '50', zoom: 0.5 },
  { key: '75', zoom: 0.75 },
  { key: '100', zoom: 1 },
  { key: '150', zoom: 1.5 },
  { key: '200', zoom: 2 },
] as const;

function ZoomMenuLabel({ label, shortcut }: { label: string; shortcut?: string }) {
  return (
    <span className="flex w-full min-w-[11rem] items-center justify-between gap-6">
      <span>{label}</span>
      {shortcut ? (
        <span className="shrink-0 text-[11px] font-normal tabular-nums text-[var(--muted)]">
          {shortcut}
        </span>
      ) : null}
    </span>
  );
}

function zoomMenuSelectedKeys(opts: { zoom: number; fitActive: boolean }): string[] {
  if (opts.fitActive) return ['fit'];
  const hit = ZOOM_MENU_PRESETS.find((p) => Math.abs(opts.zoom - p.zoom) < 0.001);
  return hit ? [hit.key] : [];
}

type Props = {
  document: SceneDocument;
  frames: ArtboardFrame[];
  camera: CanvasCamera;
  stageEl: HTMLElement | null;
  stageBackground?: string;
  selectedFrameIds: string[];
  selectedNodeIds: string[];
  onCameraChange: (camera: CanvasCamera) => void;
  zoomPercent: number;
  zoomFitActive: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  zoomAtStageCenter: (zoom: number) => void;
};

/** Share preview bottom-left HUD: minimap + zoom menu. */
function ShareBottomHud({
  document,
  frames,
  camera,
  stageEl,
  stageBackground,
  selectedFrameIds,
  selectedNodeIds,
  onCameraChange,
  zoomPercent,
  zoomFitActive,
  onZoomIn,
  onZoomOut,
  onFitView,
  zoomAtStageCenter,
}: Props) {
  const { t } = useTranslation();
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);

  const zoomMenuItems = useMemo<MenuItemType[]>(
    () => [
      {
        key: 'fit',
        label: <ZoomMenuLabel label={t('editor.fitCanvas')} shortcut="Shift 1" />,
      },
      { key: 'in', label: <ZoomMenuLabel label={t('editor.zoomIn')} /> },
      { key: 'out', label: <ZoomMenuLabel label={t('editor.zoomOut')} /> },
      { key: 'zoom-divider', type: 'divider', label: '' },
      ...ZOOM_MENU_PRESETS.map((p) => ({
        key: p.key,
        label: <ZoomMenuLabel label={`${Math.round(p.zoom * 100)}%`} />,
      })),
    ],
    [t]
  );

  const zoomSelectedKeys = useMemo(
    () => zoomMenuSelectedKeys({ zoom: camera.zoom, fitActive: zoomFitActive }),
    [camera.zoom, zoomFitActive]
  );

  const onZoomMenuClick = useCallback(
    (key: string) => {
      if (key === 'fit') onFitView();
      else if (key === 'in') onZoomIn();
      else if (key === 'out') onZoomOut();
      else {
        const preset = ZOOM_MENU_PRESETS.find((p) => p.key === key);
        if (preset) zoomAtStageCenter(preset.zoom);
      }
      setZoomMenuOpen(false);
    },
    [onFitView, onZoomIn, onZoomOut, zoomAtStageCenter]
  );

  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-20 flex flex-col items-start gap-2">
      {minimapOpen ? (
        <EditorMinimap
          document={document}
          frames={frames}
          camera={camera}
          stageEl={stageEl}
          activeFrameId={null}
          selectedFrameIds={selectedFrameIds}
          selectedNodeIds={selectedNodeIds}
          onCameraChange={onCameraChange}
          canvasBg={stageBackground}
        />
      ) : null}
      <FloatingToolbar className="pointer-events-auto w-fit px-2 text-[12px] text-[var(--ink)] shadow-[0_8px_24px_rgba(0,0,0,0.14)]">
        <Tooltip tip={t('editor.minimap')} placement="top">
          <button
            type="button"
            aria-label={t('editor.minimap')}
            onClick={() => setMinimapOpen((v) => !v)}
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded transition-colors',
              minimapOpen
                ? 'bg-[var(--accent-soft)] text-[var(--ink)]'
                : 'text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]'
            )}
          >
            <HiOutlineMap className={HUD_ICON} strokeWidth={1.75} />
          </button>
        </Tooltip>
        <span className="mx-0.5 h-3.5 w-px bg-black/10" aria-hidden />
        <Dropdown
          trigger="click"
          open={zoomMenuOpen}
          onOpenChange={setZoomMenuOpen}
          placement="top-start"
          strategy="fixed"
          items={zoomMenuItems}
          onClick={onZoomMenuClick}
          popupClassName="min-w-[12.5rem]"
          selectedKeys={zoomSelectedKeys}
        >
          <button
            type="button"
            aria-label={t('editor.zoomMenu')}
            className={cn(
              ZOOM_TRIGGER_BASE,
              zoomMenuOpen ? ZOOM_TRIGGER_OPEN : ZOOM_TRIGGER_IDLE
            )}
          >
            <span className="text-[12px] font-medium tabular-nums text-[var(--ink)]">
              {zoomPercent}%
            </span>
            <HiOutlineChevronDown className="h-3 w-3 shrink-0 text-[var(--muted)]" />
          </button>
        </Dropdown>
      </FloatingToolbar>
    </div>
  );
}

export default memo(ShareBottomHud);
