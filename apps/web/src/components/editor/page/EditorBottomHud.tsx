import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineChevronDown,
  HiOutlineChevronUp,
  HiOutlineMap,
  HiOutlineSquare3Stack3D,
} from 'react-icons/hi2';
import { LuImages, LuKeyboard } from 'react-icons/lu';
import { Dropdown, Tooltip } from '@/components/base';
import type { MenuItemType } from '@/components/base';
import EditorMinimap from '@/components/editor/chrome/EditorMinimap';
import EditorShortcutsPanel from '@/components/editor/chrome/EditorShortcutsPanel';
import { FloatingToolbar } from '@/components/editor/chrome/FloatingToolbar';
import CanvasBgPicker from '@/components/editor/chrome/CanvasBgPicker';
import type { FillPanelValue } from '@/components/editor/panels/FillPanel';
import type { ArtboardFrame } from '@/components/rcb/frames/types';
import type { RcbCamera as CanvasCamera } from '@/components/rcb';
import { setCanvasMeta } from '@/store/modules/editor';
import { cn } from '@/utils/classnames';
import type { SceneDocument } from '@/components/rcb/sceneNode';

/** Shared optical size for bottom-left HUD glyphs. */
const HUD_ICON = 'h-[15px] w-[15px] shrink-0';
/** LuImages reads optically larger than Heroicons at the same box — nudge down 2px. */
const HUD_ICON_ASSETS = 'h-[13px] w-[13px] shrink-0';
const HUD_ICON_STROKE = 1.75;
/** Min gap between left HUD (at left-4) and centered toolstrip before stacking. */
const BOTTOM_HUD_TOOLS_GAP_PX = 12;

const ZOOM_TRIGGER_BASE =
  'inline-flex h-7 min-w-[2.75rem] items-center justify-center gap-1.5 rounded px-2.5 transition-colors';
const ZOOM_TRIGGER_OPEN = 'bg-[var(--accent-soft)] text-[var(--ink)]';
const ZOOM_TRIGGER_IDLE =
  'text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]';

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

/** True when left HUD at bottom-left would horizontally collide with centered tools. */
function bottomHudCollidesWithTools(opts: {
  stage: DOMRect;
  hudWidth: number;
  toolsWidth: number;
}): boolean {
  const { stage, hudWidth, toolsWidth } = opts;
  if (!(hudWidth > 0) || !(toolsWidth > 0) || !(stage.width > 0)) return false;
  const hudRight = stage.left + 16 + hudWidth;
  const toolsLeft = stage.left + stage.width / 2 - toolsWidth / 2;
  return hudRight + BOTTOM_HUD_TOOLS_GAP_PX > toolsLeft;
}

/**
 * Opt-in canvas FPS meter (rAF sampler).
 * Toggle: zoom menu → FPS meter, or `window.__RCB_FPS_HUD__ = true` then
 * `window.dispatchEvent(new Event('rcb-fps-hud'))`.
 * Console: `window.__fpsHud.live()` / `.slice(name, t0, t1)`.
 * Persists in localStorage. Default OFF.
 */
const FPS_HUD_STORAGE_KEY = 'recombyn-editor-fps-hud';
const FPS_HUD_EVENT = 'rcb-fps-hud';

type FpsFrameStats = {
  n: number;
  fps: number;
  min: number;
  median: number;
  p95: number;
  max: number;
  mean: number;
  dropped22: number;
  dropped33: number;
};

type FpsSlice = {
  name: string;
  wallMs: number;
  frame: FpsFrameStats;
  longTasks: number;
  longMaxMs: number;
};

type FpsLive = FpsFrameStats & {
  sampleCount: number;
  longTasks: number;
  longMaxMs: number;
};

type FpsHudApi = {
  live: () => FpsLive;
  slice: (name: string, t0: number, t1: number) => FpsSlice;
  now: () => number;
  enable: () => void;
  disable: () => void;
};

declare global {
  interface Window {
    __RCB_FPS_HUD__?: boolean;
    __fpsHud?: FpsHudApi;
  }
}

function emptyFpsStats(): FpsFrameStats {
  return {
    n: 0,
    fps: 0,
    min: 0,
    median: 0,
    p95: 0,
    max: 0,
    mean: 0,
    dropped22: 0,
    dropped33: 0,
  };
}

function fpsFrameStats(arr: number[]): FpsFrameStats {
  if (!arr.length) return emptyFpsStats();
  const s = [...arr].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return {
    n: s.length,
    fps: +(1000 / mean).toFixed(1),
    min: +s[0].toFixed(2),
    median: +q(0.5).toFixed(2),
    p95: +q(0.95).toFixed(2),
    max: +s[s.length - 1].toFixed(2),
    mean: +mean.toFixed(2),
    dropped22: s.filter((x) => x > 22).length,
    dropped33: s.filter((x) => x > 33).length,
  };
}

function readFpsHudEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.__RCB_FPS_HUD__ === true) return true;
  if (window.__RCB_FPS_HUD__ === false) return false;
  try {
    return localStorage.getItem(FPS_HUD_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeFpsHudEnabled(on: boolean) {
  if (typeof window === 'undefined') return;
  window.__RCB_FPS_HUD__ = on;
  try {
    if (on) localStorage.setItem(FPS_HUD_STORAGE_KEY, '1');
    else localStorage.removeItem(FPS_HUD_STORAGE_KEY);
  } catch {
    /* ignore quota / private mode */
  }
  window.dispatchEvent(new Event(FPS_HUD_EVENT));
}

function startFpsSampler() {
  const samples: Array<{ t: number; dt: number }> = [];
  const longTasks: Array<{ t: number; dur: number }> = [];
  let last = 0;
  let raf = 0;
  let running = true;

  const longObs = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longTasks.push({ t: entry.startTime, dur: entry.duration });
    }
  });
  try {
    longObs.observe({ type: 'longtask', buffered: true });
  } catch {
    /* longtask not available */
  }

  function loop(now: number) {
    if (!running) return;
    if (last) {
      samples.push({ t: now, dt: now - last });
      if (samples.length > 8000) samples.splice(0, samples.length - 4000);
    }
    last = now;
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  return {
    live(): FpsLive {
      const recent = samples.slice(-120);
      const t0 = recent[0]?.t ?? 0;
      const t1 = recent[recent.length - 1]?.t ?? 0;
      const longs = longTasks.filter((x) => x.t >= t0 && x.t <= t1);
      return {
        sampleCount: samples.length,
        ...fpsFrameStats(recent.map((s) => s.dt)),
        longTasks: longs.length,
        longMaxMs: longs.length ? +Math.max(...longs.map((x) => x.dur)).toFixed(2) : 0,
      };
    },
    slice(name: string, t0: number, t1: number): FpsSlice {
      const dts = samples.filter((s) => s.t >= t0 && s.t <= t1).map((s) => s.dt);
      const longs = longTasks.filter((x) => x.t >= t0 && x.t <= t1);
      return {
        name,
        wallMs: +(t1 - t0).toFixed(2),
        frame: fpsFrameStats(dts),
        longTasks: longs.length,
        longMaxMs: longs.length ? +Math.max(...longs.map((x) => x.dur)).toFixed(2) : 0,
      };
    },
    now() {
      return performance.now();
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      longObs.disconnect();
    },
  };
}

function bindFpsHudWindowApi(sampler: ReturnType<typeof startFpsSampler>) {
  window.__fpsHud = {
    live: () => sampler.live(),
    slice: (name, t0, t1) => sampler.slice(name, t0, t1),
    now: () => sampler.now(),
    enable: () => writeFpsHudEnabled(true),
    disable: () => writeFpsHudEnabled(false),
  };
}

function emptyFpsLive(): FpsLive {
  return { sampleCount: 0, longTasks: 0, longMaxMs: 0, ...emptyFpsStats() };
}

function FpsHudOverlay() {
  const { t } = useTranslation();
  const [live, setLive] = useState<FpsLive>(emptyFpsLive);

  useEffect(() => {
    const sampler = startFpsSampler();
    bindFpsHudWindowApi(sampler);
    const id = window.setInterval(() => {
      setLive(sampler.live());
    }, 250);
    return () => {
      window.clearInterval(id);
      sampler.stop();
      if (window.__fpsHud) {
        window.__fpsHud = {
          ...window.__fpsHud,
          live: () => emptyFpsLive(),
          slice: (name, t0, t1) => ({
            name,
            wallMs: +(t1 - t0).toFixed(2),
            frame: emptyFpsStats(),
            longTasks: 0,
            longMaxMs: 0,
          }),
        };
      }
    };
  }, []);

  const fpsLabel = live.n ? String(live.fps) : '—';

  return (
    <div
      className="pointer-events-none absolute left-4 top-14 z-20"
      aria-label={t('editor.fpsHud')}
    >
      <div className="min-w-[7.5rem] rounded-md border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1.5 font-mono text-[11px] leading-4 text-[var(--ink)]">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">FPS</span>
          <span className="text-[16px] font-semibold tabular-nums">{fpsLabel}</span>
        </div>
        <div className="mt-0.5 tabular-nums text-[var(--muted)]">
          {live.median.toFixed(1)}ms · p95 {live.p95.toFixed(1)}
        </div>
        <div className="tabular-nums text-[var(--muted)]">
          drop {live.dropped22} · long {live.longTasks}
        </div>
      </div>
    </div>
  );
}

function HudBtn({
  tip,
  active,
  disabled,
  onClick,
  children,
  className,
  'data-tour': dataTour,
}: {
  tip: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  'data-tour'?: string;
}) {
  return (
    <Tooltip tip={tip} placement="top">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        data-tour={dataTour}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded transition-colors',
          active
            ? 'bg-[var(--accent-soft)] text-[var(--ink)]'
            : 'text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]',
          'disabled:cursor-not-allowed disabled:opacity-35',
          className
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** Legacy / empty document canvas colors — follow `--canvas` with the active theme. */
const THEME_FOLLOW_CANVAS_BGS = new Set([
  '',
  'transparent',
  '#fff',
  '#ffffff',
  '#f0f0f0',
  '#f3f3f3',
  '#f5f5f5',
  '#fafafa',
  // Dark theme `--canvas` / near-canvas neutrals
  '#1e1e1e',
  '#141414',
]);

export function isThemeFollowCanvasBg(raw: string) {
  return THEME_FOLLOW_CANVAS_BGS.has(String(raw || '').trim().toLowerCase());
}

export function canvasFillToDocumentMeta(next: FillPanelValue, followTheme: boolean) {
  return {
    backgroundColor: followTheme ? '' : next.fillColor,
    backgroundFillType: next.fillType,
    backgroundOpacity: next.fillOpacity,
    backgroundGradient: next.fillGradient,
    backgroundImageSrc: next.fillImageSrc,
    backgroundImageFit: next.fillImageFit,
    backgroundImageRotate: next.fillImageRotate,
    backgroundImageScale: next.fillImageScale,
    backgroundImageOffsetX: next.fillImageOffsetX,
    backgroundImageOffsetY: next.fillImageOffsetY,
    backgroundImageAdjust: next.fillImageAdjust,
  };
}

/** Clear user-saved canvas fill so the stage follows theme `--canvas` again. */
export function themeDefaultCanvasMeta() {
  return {
    backgroundColor: '',
    backgroundFillType: 'solid',
    backgroundOpacity: 100,
    backgroundGradient: '',
    backgroundImageSrc: '',
  };
}

type Props = {
  document: SceneDocument;
  frames: ArtboardFrame[];
  camera: CanvasCamera;
  stageEl: HTMLElement | null;
  stageBackground?: string;
  activeFrameId: string | null;
  selectedFrameIds: string[];
  selectedNodeIds: string[];
  onCameraChange: (camera: CanvasCamera) => void;
  isDevMode: boolean;
  useCompactTooling: boolean;
  layersOpen: boolean;
  setLayersOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  assetsOpen: boolean;
  setAssetsOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  minimapOpen: boolean;
  setMinimapOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  toolsExpanded: boolean;
  setToolsExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  canvasFillValue: FillPanelValue;
  canvasBgOpen: boolean;
  setCanvasBgOpen: (v: boolean) => void;
  canvasMeshSelectedIndex: number;
  setCanvasMeshSelectedIndex: (v: number) => void;
  canvasMeshShowGuides: boolean;
  setCanvasMeshShowGuides: (v: boolean) => void;
  zoomPercent: number;
  zoomFitActive: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  zoomAtStageCenter: (zoom: number) => void;
};

function EditorBottomHud({
  document,
  frames,
  camera,
  stageEl,
  stageBackground,
  activeFrameId,
  selectedFrameIds,
  selectedNodeIds,
  onCameraChange,
  isDevMode,
  useCompactTooling,
  layersOpen,
  setLayersOpen,
  assetsOpen,
  setAssetsOpen,
  minimapOpen,
  setMinimapOpen,
  shortcutsOpen,
  setShortcutsOpen,
  toolsExpanded,
  setToolsExpanded,
  canvasFillValue,
  canvasBgOpen,
  setCanvasBgOpen,
  canvasMeshSelectedIndex,
  setCanvasMeshSelectedIndex,
  canvasMeshShowGuides,
  setCanvasMeshShowGuides,
  zoomPercent,
  zoomFitActive,
  onZoomIn,
  onZoomOut,
  onFitView,
  zoomAtStageCenter,
}: Props) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [fpsHudOn, setFpsHudOn] = useState(readFpsHudEnabled);
  const bottomHudRef = useRef<HTMLDivElement | null>(null);
  const [stackBottomHud, setStackBottomHud] = useState(false);

  useEffect(() => {
    const sync = () => setFpsHudOn(readFpsHudEnabled());
    window.addEventListener(FPS_HUD_EVENT, sync);
    if (!window.__fpsHud) {
      window.__fpsHud = {
        live: () => emptyFpsLive(),
        slice: (name, t0, t1) => ({
          name,
          wallMs: +(t1 - t0).toFixed(2),
          frame: emptyFpsStats(),
          longTasks: 0,
          longMaxMs: 0,
        }),
        now: () => performance.now(),
        enable: () => writeFpsHudEnabled(true),
        disable: () => writeFpsHudEnabled(false),
      };
    }
    return () => {
      window.removeEventListener(FPS_HUD_EVENT, sync);
    };
  }, []);

  useEffect(() => {
    const stage = stageEl;
    const hud = bottomHudRef.current;
    const tools = stage?.ownerDocument?.querySelector(
      '[data-tour="editor-tools"]'
    ) as HTMLElement | null;
    if (!stage || !hud || !tools) {
      setStackBottomHud(false);
      return undefined;
    }
    const measure = () => {
      const stageBox = stage.getBoundingClientRect();
      const hudBox = hud.getBoundingClientRect();
      const toolsBox = tools.getBoundingClientRect();
      setStackBottomHud(
        bottomHudCollidesWithTools({
          stage: stageBox,
          hudWidth: hudBox.width,
          toolsWidth: toolsBox.width,
        })
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    ro.observe(hud);
    ro.observe(tools);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isDevMode, stageEl, toolsExpanded, useCompactTooling]);

  const toggleMinimap = useCallback(() => {
    setMinimapOpen((v) => !v);
    setShortcutsOpen(false);
  }, [setMinimapOpen, setShortcutsOpen]);

  const toggleShortcuts = useCallback(() => {
    setShortcutsOpen((v) => !v);
    setMinimapOpen(false);
  }, [setMinimapOpen, setShortcutsOpen]);

  const zoomMenuItems = useMemo<MenuItemType[]>(
    () => [
      {
        key: 'fit',
        label: <ZoomMenuLabel label={t('editor.fitCanvas')} shortcut="Shift 1" />,
      },
      {
        key: 'in',
        label: <ZoomMenuLabel label={t('editor.zoomIn')} />,
      },
      {
        key: 'out',
        label: <ZoomMenuLabel label={t('editor.zoomOut')} />,
      },
      { key: 'zoom-divider', type: 'divider', label: '' },
      ...ZOOM_MENU_PRESETS.map((p) => ({
        key: p.key,
        label: <ZoomMenuLabel label={`${Math.round(p.zoom * 100)}%`} />,
      })),
      { key: 'fps-divider', type: 'divider', label: '' },
      {
        key: 'fps',
        label: <ZoomMenuLabel label={t('editor.fpsHud')} />,
      },
    ],
    [t]
  );

  const zoomSelectedKeys = useMemo(() => {
    const keys = zoomMenuSelectedKeys({ zoom: camera.zoom, fitActive: zoomFitActive });
    if (fpsHudOn) keys.push('fps');
    return keys;
  }, [camera.zoom, zoomFitActive, fpsHudOn]);

  const onZoomMenuClick = useCallback(
    (key: string) => {
      if (key === 'fps') {
        writeFpsHudEnabled(!readFpsHudEnabled());
        setZoomMenuOpen(false);
        return;
      }
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
    <>
      {fpsHudOn ? <FpsHudOverlay /> : null}
      <div
        className={cn(
          'pointer-events-none absolute left-4 z-20 flex flex-col items-start gap-2',
          stackBottomHud ? 'bottom-[4.75rem]' : 'bottom-4'
        )}
      >
        {minimapOpen ? (
          <EditorMinimap
            document={document}
            frames={frames}
            camera={camera}
            stageEl={stageEl}
            activeFrameId={activeFrameId}
            selectedFrameIds={selectedFrameIds}
            selectedNodeIds={selectedNodeIds}
            onCameraChange={onCameraChange}
            canvasBg={stageBackground}
          />
        ) : null}
        {shortcutsOpen ? (
          <EditorShortcutsPanel onClose={() => setShortcutsOpen(false)} />
        ) : null}
        <FloatingToolbar
          ref={bottomHudRef}
          className="pointer-events-auto w-fit px-2 text-[12px] text-[var(--ink)] shadow-[0_8px_24px_rgba(0,0,0,0.14)]"
        >
        {!isDevMode ? (
          <>
            {useCompactTooling ? (
              <>
                <HudBtn
                  tip={
                    toolsExpanded
                      ? t('editor.tools.hideTools', { defaultValue: '收起' })
                      : t('editor.tools.showTools', { defaultValue: '展开' })
                  }
                  active={toolsExpanded}
                  onClick={() => setToolsExpanded((v) => !v)}
                >
                  {toolsExpanded ? (
                    <HiOutlineChevronDown className={HUD_ICON} strokeWidth={HUD_ICON_STROKE} />
                  ) : (
                    <HiOutlineChevronUp className={HUD_ICON} strokeWidth={HUD_ICON_STROKE} />
                  )}
                </HudBtn>
                {toolsExpanded ? (
                  <>
                    <span className="mx-0.5 h-3.5 w-px bg-black/10" aria-hidden />
                    <HudBtn
                      tip={t('editor.layers')}
                      active={layersOpen}
                      onClick={() => setLayersOpen((v) => !v)}
                    >
                      <HiOutlineSquare3Stack3D
                        className={HUD_ICON}
                        strokeWidth={HUD_ICON_STROKE}
                      />
                    </HudBtn>
                    <HudBtn
                      tip={t('editor.assets.title', { defaultValue: '资产' })}
                      active={assetsOpen}
                      onClick={() => setAssetsOpen((v) => !v)}
                    >
                      <LuImages className={HUD_ICON_ASSETS} strokeWidth={HUD_ICON_STROKE} />
                    </HudBtn>
                    <HudBtn tip={t('editor.minimap')} active={minimapOpen} onClick={toggleMinimap}>
                      <HiOutlineMap className={HUD_ICON} strokeWidth={HUD_ICON_STROKE} />
                    </HudBtn>
                    <span data-shortcuts-toggle>
                      <HudBtn
                        tip={t('editor.shortcuts.title')}
                        active={shortcutsOpen}
                        onClick={toggleShortcuts}
                      >
                        <LuKeyboard className={HUD_ICON} strokeWidth={HUD_ICON_STROKE} />
                      </HudBtn>
                    </span>
                    <span className="mx-0.5 h-3.5 w-px bg-black/10" aria-hidden />
                  </>
                ) : null}
              </>
            ) : (
              <>
                <CanvasBgPicker
                  value={canvasFillValue}
                  open={canvasBgOpen}
                  onOpenChange={(next) => {
                    setCanvasBgOpen(next);
                    if (next) setCanvasMeshSelectedIndex(0);
                  }}
                  meshSelectedIndex={canvasMeshSelectedIndex}
                  onMeshSelectedIndexChange={setCanvasMeshSelectedIndex}
                  meshShowGuides={canvasMeshShowGuides}
                  onMeshShowGuidesChange={setCanvasMeshShowGuides}
                  onChange={(next) => {
                    const follow =
                      next.fillType === 'solid' && isThemeFollowCanvasBg(next.fillColor);
                    dispatch(setCanvasMeta(canvasFillToDocumentMeta(next, follow)));
                  }}
                  onReset={() => dispatch(setCanvasMeta(themeDefaultCanvasMeta()))}
                />
                <HudBtn tip={t('editor.layers')} active={layersOpen} onClick={() => setLayersOpen((v) => !v)}>
                  <HiOutlineSquare3Stack3D className={HUD_ICON} strokeWidth={HUD_ICON_STROKE} />
                </HudBtn>
                <HudBtn
                  tip={t('editor.assets.title', { defaultValue: '资产' })}
                  active={assetsOpen}
                  onClick={() => setAssetsOpen((v) => !v)}
                >
                  <LuImages className={HUD_ICON_ASSETS} strokeWidth={HUD_ICON_STROKE} />
                </HudBtn>
                <HudBtn tip={t('editor.minimap')} active={minimapOpen} onClick={toggleMinimap}>
                  <HiOutlineMap className={HUD_ICON} strokeWidth={HUD_ICON_STROKE} />
                </HudBtn>
                <span data-shortcuts-toggle>
                  <HudBtn
                    tip={t('editor.shortcuts.title')}
                    active={shortcutsOpen}
                    onClick={toggleShortcuts}
                  >
                    <LuKeyboard className={HUD_ICON} strokeWidth={HUD_ICON_STROKE} />
                  </HudBtn>
                </span>
                <span className="mx-0.5 h-3.5 w-px bg-black/10" aria-hidden />
              </>
            )}
          </>
        ) : null}
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
    </>
  );
}

export default memo(EditorBottomHud);
