import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  type Placement,
} from '@floating-ui/react';
import {
  HiOutlineArrowsRightLeft,
  HiOutlineArrowPath,
  HiOutlineChevronDown,
  HiOutlinePhoto,
} from 'react-icons/hi2';
import {
  COLOR_PANEL_WIDTH,
  WIDE_STYLE_PANEL_WIDTH,
  ColorPanel,
  FILL_SOLID_PRESETS,
  INPUT_NO_SPIN,
  hexToRgba,
  normalizeHex,
  rgbaToHex,
} from '@/components/base/colorPanel';
import Slider from '@/components/base/slider';
import Tooltip from '@/components/base/tooltip';
import { DropdownPanel, DropdownPanelItem, SegmentedControl, Icon } from '@/components/base';
import DiffuseMeshEditor from '@/components/editor/panels/DiffuseMeshEditor';
import { StylePanelShell } from '@/components/editor/panels/StylePanelChrome';
import { cn } from '@/utils/classnames';
import { meshPreviewDataUrl } from '@/components/rcb/scene/document/sceneDiffuseMesh';
import {
  buildImageAdjustFilterCss,
  cssPreviewForGradient,
  DEFAULT_FILL_IMAGE_ADJUST,
  defaultGradient,
  fillImageTileSize,
  FILL_PANEL_TYPES,
  parseFillGradient,
  parseFillImageFit,
  parseFillImageScale,
  parseFillType,
  resetFillImageTransformFields,
  serializeFillGradient,
  withDefaultFillImageFields,
  type FillGradient,
  type FillImageAdjust,
  type FillImageFit,
  type FillImageRotate,
  type FillStop,
  type FillType,
} from '@/components/rcb/scene/document/sceneFill';
export type FillPanelValue = {
  fillType: FillType;
  fillColor: string;
  fillOpacity: number;
  fillGradient?: string;
  fillImageSrc?: string;
  fillImageFit?: FillImageFit;
  fillImageRotate?: FillImageRotate;
  fillImageScale?: number;
  fillImageOffsetX?: number;
  fillImageOffsetY?: number;
  fillImageAdjust?: FillImageAdjust;
};

const IMAGE_FIT_OPTION_KEYS: Array<{ value: FillImageFit; labelKey: string }> = [
  { value: 'fill', labelKey: 'editor.fillImageFitFill' },
  { value: 'fit', labelKey: 'editor.fillImageFitFit' },
  { value: 'crop', labelKey: 'editor.fillImageFitCrop' },
  { value: 'tile', labelKey: 'editor.fillImageFitTile' },
];

const FILL_TYPE_TIP_KEYS: Record<FillType, string> = {
  solid: 'editor.fillTypeSolid',
  linear: 'editor.fillTypeLinear',
  radial: 'editor.fillTypeRadial',
  angular: 'editor.fillTypeAngular',
  diffuse: 'editor.fillTypeDiffuse',
  image: 'editor.fillTypeImage',
};

const FILL_TYPE_ICON: Record<FillType, string> = {
  solid: 'editor-fill-solid',
  linear: 'editor-fill-linear',
  radial: 'editor-fill-radial',
  angular: 'editor-fill-angular',
  diffuse: 'editor-fill-diffuse',
  image: 'editor-fill-image',
};

/** Image / diffuse fills need a bit more width than solid/linear panels. */
function fillPanelWidth(type: FillType): number {
  return type === 'image' || type === 'diffuse' ? WIDE_STYLE_PANEL_WIDTH : COLOR_PANEL_WIDTH;
}

const IMAGE_ADJUST_ROW_KEYS: Array<{ key: keyof FillImageAdjust; labelKey: string }> = [
  { key: 'exposure', labelKey: 'editor.fillAdjustExposure' },
  { key: 'contrast', labelKey: 'editor.fillAdjustContrast' },
  { key: 'saturation', labelKey: 'editor.fillAdjustSaturation' },
  { key: 'temperature', labelKey: 'editor.fillAdjustTemperature' },
  { key: 'tint', labelKey: 'editor.fillAdjustTint' },
  { key: 'hue', labelKey: 'editor.fillAdjustHue' },
  { key: 'highlights', labelKey: 'editor.fillAdjustHighlights' },
  { key: 'shadows', labelKey: 'editor.fillAdjustShadows' },
];

function resolveFillTypePatch(
  next: FillType,
  value: FillPanelValue,
  solid: string,
  gradient: FillGradient
): Partial<FillPanelValue> {
  switch (next) {
    case 'solid':
      return { fillType: 'solid', fillColor: solid };
    case 'image':
      return {
        fillType: 'image',
        fillColor: solid,
        ...withDefaultFillImageFields(value),
      };
    default: {
      const keepCurrent =
        parseFillType(value.fillType) === next && gradient.type === next;
      const g = keepCurrent ? gradient : defaultGradient(next, solid);
      g.type = next;
      return {
        fillType: next,
        fillColor: solid,
        fillGradient: serializeFillGradient(g),
      };
    }
  }
}

function clampAdjustInput(n: number) {
  return Math.max(-100, Math.min(100, Math.round(n) || 0));
}

function FillImagePreviewImage({
  src,
  fit,
  rotate,
  adjust,
  opacity,
  scale,
  offsetX,
  offsetY,
}: {
  src: string;
  fit: FillImageFit;
  rotate: FillImageRotate;
  adjust: FillImageAdjust;
  opacity: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}) {
  const filter = buildImageAdjustFilterCss(adjust);
  const scaleMul = Math.max(0.01, scale / 100);
  const objectFit = fit === 'fit' ? 'contain' : 'cover';
  const [tileSize, setTileSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (fit !== 'tile' || !src) {
      setTileSize(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      setTileSize(fillImageTileSize(img.naturalWidth, img.naturalHeight, scale));
    };
    img.src = src;
  }, [src, fit, scale]);

  if (fit === 'tile') {
    return (
      <span
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: opacity / 100,
          ...(filter !== 'none' ? { filter } : {}),
          backgroundImage: `url(${src})`,
          backgroundRepeat: 'repeat',
          backgroundSize: tileSize ? `${tileSize.w}px ${tileSize.h}px` : undefined,
          backgroundPosition: `${50 + offsetX}% ${50 + offsetY}%`,
        }}
      />
    );
  }

  return (
    <img
      alt=""
      src={src}
      draggable={false}
      className="pointer-events-none absolute max-h-none max-w-none"
      style={{
        left: `calc(50% + ${offsetX}%)`,
        top: `calc(50% + ${offsetY}%)`,
        width: fit === 'fit' ? 'auto' : '100%',
        height: fit === 'fit' ? 'auto' : '100%',
        minWidth: fit !== 'fit' ? `${100 * scaleMul}%` : undefined,
        minHeight: fit !== 'fit' ? `${100 * scaleMul}%` : undefined,
        maxWidth: fit === 'fit' ? `${100 * scaleMul}%` : undefined,
        maxHeight: fit === 'fit' ? `${100 * scaleMul}%` : undefined,
        objectFit,
        transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
        transformOrigin: 'center center',
        opacity: opacity / 100,
        ...(filter !== 'none' ? { filter } : {}),
      }}
    />
  );
}

/** Drag inside the panel thumbnail to pan the image fill. */
function FillImagePreviewStrip({
  src,
  fit,
  rotate,
  adjust,
  opacity,
  scale,
  offsetX,
  offsetY,
  onOffsetChange,
  onPickFile,
}: {
  src?: string;
  fit: FillImageFit;
  rotate: FillImageRotate;
  adjust: FillImageAdjust;
  opacity: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  onOffsetChange: (x: number, y: number) => void;
  onPickFile: (file: File | null) => void;
}) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<null | {
    startX: number;
    startY: number;
    ox: number;
    oy: number;
    w: number;
    h: number;
  }>(null);
  const onOffsetChangeRef = useRef(onOffsetChange);
  onOffsetChangeRef.current = onOffsetChange;

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      onOffsetChangeRef.current(
        drag.ox + (dx / Math.max(1, drag.w)) * 100,
        drag.oy + (dy / Math.max(1, drag.h)) * 100
      );
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const beginPan = (e: ReactPointerEvent) => {
    if (!src) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      ox: offsetX,
      oy: offsetY,
      w: rect.width,
      h: rect.height,
    };
  };

  return (
    <div className="relative w-full">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          onPickFile(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
      <Tooltip
        tip={src ? t('editor.fillDragAdjustArea') : t('editor.fillClickUpload')}
        placement="top"
        triggerClassName="w-full"
      >
        <div
          ref={previewRef}
          data-fill-image-preview
          role="button"
          tabIndex={0}
          aria-label={
            src ? t('editor.fillDragAdjustPreview') : t('editor.fillClickUpload')
          }
          className={cn(
            'relative flex h-[72px] w-full items-center justify-center overflow-hidden rounded',
            src ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
          )}
          style={{ boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)' }}
          onPointerDown={(e) => {
            if (!src) {
              fileRef.current?.click();
              return;
            }
            beginPan(e);
          }}
          onClick={() => {
            if (!src) fileRef.current?.click();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (!src) fileRef.current?.click();
            }
          }}
        >
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage: CHECKER,
              backgroundSize: '8px 8px',
              backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
            }}
          />
          {src ? (
            <FillImagePreviewImage
              src={src}
              fit={fit}
              rotate={rotate}
              adjust={adjust}
              opacity={opacity}
              scale={scale}
              offsetX={offsetX}
              offsetY={offsetY}
            />
          ) : null}
          {!src ? (
            <span className="relative z-[1] inline-flex flex-col items-center gap-1 text-[12px] text-[var(--muted)]">
              <HiOutlinePhoto className="h-6 w-6" />
              {t('editor.fillUploadImage')}
            </span>
          ) : (
            <span className="pointer-events-none absolute bottom-1 left-1.5 rounded bg-black/45 px-1.5 py-0.5 text-[10px] text-white/90">
              {t('editor.fillDragAdjust')}
            </span>
          )}
        </div>
      </Tooltip>
      {src ? (
        <Tooltip tip={t('editor.fillReplaceImage')} placement="top">
          <button
            type="button"
            aria-label={t('editor.fillReplaceImage')}
            className="absolute right-1.5 top-1.5 z-[2] inline-flex h-6 w-6 items-center justify-center rounded bg-black/45 text-white/90 hover:bg-black/60"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              fileRef.current?.click();
            }}
          >
            <HiOutlinePhoto className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

function ImageAdjustRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 whitespace-nowrap text-[11px] text-[var(--muted)]">{label}</span>
      <Slider
        className="min-w-0 flex-1"
        min={-100}
        max={100}
        step={1}
        value={value}
        fillFromZero
        onChange={onChange}
      />
      <input
        type="number"
        min={-100}
        max={100}
        value={value}
        onChange={(e) => onChange(clampAdjustInput(Number(e.target.value)))}
        className={cn(
          'h-7 w-11 shrink-0 rounded bg-[var(--accent-soft)] px-1 text-center text-[11px] text-[var(--ink)] outline-none',
          INPUT_NO_SPIN
        )}
      />
    </div>
  );
}

/** Compact fit dropdown — portals to body so FillPanel never clips it. */
function FitModeSelect({
  value,
  onChange,
}: {
  value: FillImageFit;
  onChange: (v: FillImageFit) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);
  const current =
    IMAGE_FIT_OPTION_KEYS.find((o) => o.value === value) ?? IMAGE_FIT_OPTION_KEYS[0];

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        className="inline-flex h-7 min-w-0 flex-1 items-center justify-between gap-1 rounded bg-[var(--accent-soft)] px-2 text-[12px] text-[var(--ink)] outline-none hover:bg-[var(--line)]"
        {...getReferenceProps({
          onClick: () => setOpen((v) => !v),
        })}
      >
        <span className="truncate">{t(current.labelKey)}</span>
        <HiOutlineChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 text-[var(--muted)] transition-transform', open && 'rotate-180')}
        />
      </button>
      <FloatingPortal>
        {open ? (
          <div
            ref={refs.setFloating}
            data-select-dropdown
            style={floatingStyles}
            className="z-[220]"
            {...getFloatingProps()}
          >
            <DropdownPanel className="min-w-[112px]">
              {IMAGE_FIT_OPTION_KEYS.map((opt) => {
                const active = opt.value === value;
                return (
                  <DropdownPanelItem
                    key={opt.value}
                    selected={active}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    {t(opt.labelKey)}
                  </DropdownPanelItem>
                );
              })}
            </DropdownPanel>
          </div>
        ) : null}
      </FloatingPortal>
    </>
  );
}

function TypeIcon({ type, active }: { type: FillType; active?: boolean }) {
  const tone = active ? 'text-[var(--ink)]' : 'text-[var(--muted)]';
  return <Icon name={FILL_TYPE_ICON[type]} width={20} height={20} className={tone} />;
}

const CHECKER =
  'linear-gradient(45deg, #d0d0d0 25%, transparent 25%), linear-gradient(-45deg, #d0d0d0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d0d0d0 75%), linear-gradient(-45deg, transparent 75%, #d0d0d0 75%)';

const MAX_GRADIENT_STOPS = 8;

/**
 * Canvas Delete/Backspace is registered earlier (capture). Gradient stop editing
 * registers a consumer here so hotkeys can remove a stop instead of the node.
 */
let gradientStopDeleteConsumer: (() => boolean) | null = null;

/** @returns true when Delete was handled as gradient-stop edit (including no-op at 2 stops). */
export function tryConsumeGradientStopDelete(): boolean {
  return gradientStopDeleteConsumer?.() ?? false;
}

function interpolateStopColor(stops: FillStop[], offset: number): string {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  if (sorted.length === 0) return '#CCCCCC';
  if (offset <= sorted[0].offset) return normalizeHex(sorted[0].color, '#CCCCCC');
  if (offset >= sorted[sorted.length - 1].offset) {
    return normalizeHex(sorted[sorted.length - 1].color, '#CCCCCC');
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (offset < a.offset || offset > b.offset) continue;
    const span = b.offset - a.offset;
    const t = span === 0 ? 0 : (offset - a.offset) / span;
    const ca = hexToRgba(normalizeHex(a.color, '#CCCCCC'));
    const cb = hexToRgba(normalizeHex(b.color, '#CCCCCC'));
    const r = Math.round(ca.r + (cb.r - ca.r) * t);
    const g = Math.round(ca.g + (cb.g - ca.g) * t);
    const bl = Math.round(ca.b + (cb.b - ca.b) * t);
    return rgbaToHex({ r, g, b: bl, a: 1 });
  }
  return normalizeHex(sorted[0].color, '#CCCCCC');
}

function GradientStopsBar({
  gradient,
  activeStop,
  onActiveStopChange,
  onStopsChange,
}: {
  gradient: FillGradient;
  activeStop: number;
  onActiveStopChange: (index: number) => void;
  onStopsChange: (stops: FillStop[], activeIndex: number) => void;
}) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragIndexRef = useRef<number | null>(null);
  const stopsRef = useRef(gradient.colorStops);
  const onStopsChangeRef = useRef(onStopsChange);
  const activeStopRef = useRef(activeStop);

  stopsRef.current = gradient.colorStops;
  onStopsChangeRef.current = onStopsChange;
  activeStopRef.current = activeStop;

  const offsetFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const { left, width } = el.getBoundingClientRect();
    if (width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - left) / width));
  }, []);

  const deleteActiveStop = useCallback(() => {
    const stops = stopsRef.current;
    if (stops.length <= 2) return false;
    const idx = Math.max(0, Math.min(activeStopRef.current, stops.length - 1));
    const next = stops.filter((_, i) => i !== idx);
    const nextActive = Math.min(idx, next.length - 1);
    onStopsChangeRef.current(next, nextActive);
    onActiveStopChange(nextActive);
    return true;
  }, [onActiveStopChange]);

  useEffect(() => {
    gradientStopDeleteConsumer = () => {
      if (dragIndexRef.current != null) return true;
      // While the stops bar is mounted, Delete never falls through to node delete.
      if (stopsRef.current.length <= 2) return true;
      return deleteActiveStop();
    };
    return () => {
      gradientStopDeleteConsumer = null;
    };
  }, [deleteActiveStop]);

  const handleStopPointerDown = (index: number) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragIndexRef.current = index;
    onActiveStopChange(index);

    const onMove = (ev: PointerEvent) => {
      const idx = dragIndexRef.current;
      if (idx == null) return;
      const offset = offsetFromClientX(ev.clientX);
      const stops = stopsRef.current.map((s, i) => (i === idx ? { ...s, offset } : s));
      const sorted = [...stops].sort((a, b) => a.offset - b.offset);
      const moved = stops[idx];
      const newIndex = sorted.indexOf(moved);
      dragIndexRef.current = newIndex;
      stopsRef.current = sorted;
      onStopsChangeRef.current(sorted, newIndex);
    };

    const onUp = () => {
      dragIndexRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleTrackPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-stop-handle]')) return;
    if (gradient.colorStops.length >= MAX_GRADIENT_STOPS) return;
    const offset = offsetFromClientX(e.clientX);
    const color = interpolateStopColor(gradient.colorStops, offset);
    const stops = [...gradient.colorStops, { offset, color, opacity: 100 }].sort(
      (a, b) => a.offset - b.offset
    );
    const newIndex = stops.findIndex(
      (s) => Math.abs(s.offset - offset) < 0.0001 && s.color === color
    );
    onStopsChange(stops, newIndex >= 0 ? newIndex : stops.length - 1);
  };

  return (
    <Tooltip
      tip={t('editor.fillDeleteStopHint')}
      placement="top"
      triggerClassName="min-w-0 flex-1"
    >
      <div
        ref={trackRef}
        role="presentation"
        tabIndex={0}
        className="relative h-7 min-w-0 w-full cursor-crosshair rounded outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3388ff]"
        style={{
          background: cssPreviewForGradient(gradient, 100),
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)',
        }}
        onPointerDown={handleTrackPointerDown}
      >
        {gradient.colorStops.map((s, i) => (
          <button
            key={`${s.offset}-${s.color}-${i}`}
            type="button"
            data-stop-handle
            aria-label={`${Math.round(s.offset * 100)}%`}
            onPointerDown={handleStopPointerDown(i)}
            onClick={(e) => {
              e.stopPropagation();
              onActiveStopChange(i);
            }}
            className={cn(
              'absolute top-1/2 z-[1] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 bg-white shadow-sm active:cursor-grabbing',
              i === activeStop ? 'border-[#3388ff]' : 'border-white'
            )}
            style={{ left: `${s.offset * 100}%`, background: s.color }}
          />
        ))}
      </div>
    </Tooltip>
  );
}

export function fillPanelPreview(value: FillPanelValue): string {
  const t = value.fillType;
  if (t === 'solid') return normalizeHex(value.fillColor, '#FFFFFF');
  if (t === 'image') {
    return value.fillImageSrc
      ? `url(${value.fillImageSrc}) center / cover`
      : 'repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 0 0 / 8px 8px';
  }
  const g = parseFillGradient(
    value.fillGradient,
    t === 'linear' || t === 'radial' || t === 'angular' || t === 'diffuse' ? t : 'linear',
    value.fillColor
  );
  if (g.type === 'diffuse' && g.meshPoints?.length) {
    try {
      return `url(${meshPreviewDataUrl(g.meshPoints, 64)}) center / cover`;
    } catch {
      /* fall through */
    }
  }
  return cssPreviewForGradient(g, value.fillOpacity);
}

/** Full fill editor: solid / linear / radial / angular / image. */
function FillPanel({
  value,
  onChange,
  title,
  onClose,
  className,
  meshSelectedIndex,
  onMeshSelectedIndexChange,
  meshShowGuides,
  onMeshShowGuidesChange,
  layerVisible = true,
  onLayerVisibleChange,
  activeStopIndex,
  onActiveStopIndexChange,
  onReset,
}: {
  value: FillPanelValue;
  onChange: (next: FillPanelValue) => void;
  title?: string;
  onClose?: () => void;
  className?: string;
  /** Sync mesh anchor selection with on-canvas handles. */
  meshSelectedIndex?: number;
  onMeshSelectedIndexChange?: (index: number) => void;
  meshShowGuides?: boolean;
  onMeshShowGuidesChange?: (show: boolean) => void;
  /** Show/hide fill on the canvas (eye control in panel header). */
  layerVisible?: boolean;
  onLayerVisibleChange?: (visible: boolean) => void;
  /** Sync gradient stop selection with on-canvas handles. */
  activeStopIndex?: number;
  onActiveStopIndexChange?: (index: number) => void;
  /** Optional header reset (e.g. canvas bg → clear saved color / follow theme). */
  onReset?: () => void;
}) {
  const { t } = useTranslation();
  const panelTitle = title ?? t('editor.selectionToolbar.color');
  const fillType = parseFillType(value.fillType);
  const panelType = (FILL_PANEL_TYPES.includes(fillType) ? fillType : 'solid') as FillType;
  const solid = normalizeHex(value.fillColor || '#FFFFFF', '#FFFFFF');
  const gradient = useMemo(
    () =>
      parseFillGradient(
        value.fillGradient,
        panelType === 'solid' || panelType === 'image'
          ? 'linear'
          : (panelType as Exclude<FillType, 'solid' | 'image'>),
        solid
      ),
    [value.fillGradient, panelType, solid]
  );
  const [localActiveStop, setLocalActiveStop] = useState(0);
  const activeStop = activeStopIndex ?? localActiveStop;
  const setActiveStop = (index: number | ((prev: number) => number)) => {
    const next =
      typeof index === 'function'
        ? index(activeStopIndex ?? localActiveStop)
        : index;
    setLocalActiveStop(next);
    onActiveStopIndexChange?.(next);
  };
  useEffect(() => {
    setActiveStop((i) => Math.min(i, Math.max(0, gradient.colorStops.length - 1)));
  }, [gradient.colorStops.length]);

  useEffect(() => {
    if (activeStopIndex == null) return;
    setLocalActiveStop(activeStopIndex);
  }, [activeStopIndex]);

  const emit = useCallback(
    (patch: Partial<FillPanelValue>) => {
      onChange({ ...value, ...patch });
    },
    [onChange, value]
  );

  const setType = (next: FillType) => {
    emit(resolveFillTypePatch(next, value, solid, gradient));
  };

  const updateGradient = (g: FillGradient) => {
    emit({
      fillType: g.type,
      fillGradient: serializeFillGradient(g),
      fillColor: g.colorStops[0]?.color || g.meshPoints?.[0]?.color || solid,
    });
  };

  const updateStop = (index: number, patch: Partial<FillStop>) => {
    const stops = gradient.colorStops.map((s, i) => (i === index ? { ...s, ...patch } : s));
    updateGradient({ ...gradient, colorStops: stops });
  };

  const reverseStops = () => {
    const stops = [...gradient.colorStops]
      .map((s) => ({ ...s, offset: 1 - s.offset }))
      .sort((a, b) => a.offset - b.offset);
    updateGradient({ ...gradient, colorStops: stops });
  };

  const applyStops = (stops: FillStop[], activeIndex: number) => {
    updateGradient({ ...gradient, colorStops: stops });
    setActiveStop(activeIndex);
  };

  const onPickImage = (file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      emit({
        fillType: 'image',
        fillColor: solid,
        ...withDefaultFillImageFields({
          ...value,
          fillImageSrc: String(reader.result || ''),
        }),
      });
    };
    reader.readAsDataURL(file);
  };

  const stop = gradient.colorStops[activeStop] || gradient.colorStops[0];
  const isGradient =
    panelType === 'linear' || panelType === 'radial' || panelType === 'angular';
  const isDiffuse = panelType === 'diffuse';

  const imageFit = value.fillImageFit ?? 'fill';
  const imageRotate = value.fillImageRotate ?? 0;
  const imageScale = value.fillImageScale ?? 100;
  const imageAdjust = value.fillImageAdjust ?? DEFAULT_FILL_IMAGE_ADJUST;
  const imageOpacity = value.fillOpacity ?? 100;

  const cycleRotate = () => {
    emit({ fillImageRotate: Math.round((imageRotate + 90) % 360) });
  };

  const updateImageAdjust = (key: keyof FillImageAdjust, n: number) => {
    emit({
      fillImageAdjust: {
        ...imageAdjust,
        [key]: clampAdjustInput(n),
      },
    });
  };

  const resetImageFill = () => {
    emit({
      fillOpacity: 100,
      ...resetFillImageTransformFields(),
    });
  };

  const resetDiffuseFill = () => {
    const g = defaultGradient('diffuse', solid);
    emit({
      fillType: 'diffuse',
      fillGradient: serializeFillGradient(g),
      fillColor: g.meshPoints?.[0]?.color || solid,
    });
  };

  const resetGradientFill = () => {
    if (!isGradient) return;
    const g = defaultGradient(panelType as 'linear' | 'radial' | 'angular', solid);
    emit({
      fillType: panelType,
      fillGradient: serializeFillGradient(g),
      fillColor: solid,
    });
  };

  const resetSolidFill = () => {
    emit({ fillType: 'solid', fillColor: '#FFFFFF', fillOpacity: 100 });
  };

  const resetTip =
    panelType === 'image'
      ? onReset
        ? t('editor.fillResetDefault')
        : t('editor.fillResetImageAdjust')
      : panelType === 'diffuse'
        ? t('editor.fillResetDiffuse')
        : isGradient
          ? t('editor.fillResetGradient')
          : t('editor.fillResetDefault');

  const handleReset = () => {
    if (panelType === 'image') {
      if (onReset) onReset();
      else resetImageFill();
      return;
    }
    if (panelType === 'diffuse') {
      resetDiffuseFill();
      return;
    }
    if (isGradient) {
      resetGradientFill();
      return;
    }
    if (onReset) onReset();
    else resetSolidFill();
  };

  return (
    <StylePanelShell
      title={panelTitle}
      onClose={onClose}
      width={fillPanelWidth(panelType)}
      dataAttr="data-fill-panel"
      className={className}
      bodyClassName="max-h-[min(70vh,560px)] space-y-3 overflow-y-auto"
      layerVisible={layerVisible}
      onLayerVisibleChange={onLayerVisibleChange}
      layerVisibleTipShow={t('editor.selectionToolbar.showFill')}
      layerVisibleTipHide={t('editor.selectionToolbar.hideFill')}
      headerActions={
        <Tooltip tip={resetTip} placement="bottom">
          <button
            type="button"
            aria-label={resetTip}
            onClick={handleReset}
            className="inline-flex h-8 w-8 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
          >
            <HiOutlineArrowPath className="h-[18px] w-[18px]" />
          </button>
        </Tooltip>
      }
    >
        <SegmentedControl
          size="sm"
          fullWidth
          value={panelType}
          onChange={(next) => setType(next)}
          options={FILL_PANEL_TYPES.map((type) => ({
            value: type,
            title: t(FILL_TYPE_TIP_KEYS[type]),
            label: <TypeIcon type={type} active={panelType === type} />,
          }))}
        />

        {isGradient ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <GradientStopsBar
                gradient={gradient}
                activeStop={activeStop}
                onActiveStopChange={setActiveStop}
                onStopsChange={applyStops}
              />
              <Tooltip tip={t('editor.fillReverseStops')} placement="top">
                <button
                  type="button"
                  aria-label={t('editor.fillReverseStops')}
                  onClick={reverseStops}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
                >
                  <HiOutlineArrowsRightLeft className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>
            <ColorPanel
              value={stop?.color || solid}
              onChange={(hex) => updateStop(activeStop, { color: hex })}
              opacity={stop?.opacity ?? 100}
              onOpacityChange={(opacity) => updateStop(activeStop, { opacity })}
              showAlpha
              title=""
              showHeader={false}
              padded={false}
              presets={FILL_SOLID_PRESETS}
              className="w-full !shadow-none !ring-0"
            />
          </div>
        ) : null}

        {isDiffuse ? (
          <DiffuseMeshEditor
            value={gradient.type === 'diffuse' ? gradient : defaultGradient('diffuse', solid)}
            baseColor={solid}
            onChange={updateGradient}
            selectedIndex={meshSelectedIndex}
            onSelectedIndexChange={onMeshSelectedIndexChange}
            showGuides={meshShowGuides}
            onShowGuidesChange={onMeshShowGuidesChange}
          />
        ) : null}

        {panelType === 'image' ? (
          <div className="space-y-2.5">
            <FillImagePreviewStrip
              src={value.fillImageSrc}
              fit={imageFit}
              rotate={imageRotate}
              adjust={imageAdjust}
              opacity={imageOpacity}
              scale={imageScale}
              offsetX={value.fillImageOffsetX ?? 0}
              offsetY={value.fillImageOffsetY ?? 0}
              onOffsetChange={(x, y) =>
                emit({
                  fillImageOffsetX: Math.round(x * 10) / 10,
                  fillImageOffsetY: Math.round(y * 10) / 10,
                })
              }
              onPickFile={onPickImage}
            />

            <div className="flex items-center gap-1.5">
              <FitModeSelect
                value={imageFit}
                onChange={(v) => emit({ fillImageFit: parseFillImageFit(v) })}
              />
              <label className="flex h-7 shrink-0 items-center gap-0.5 rounded bg-[var(--accent-soft)] px-1.5 text-[11px] text-[var(--muted)]">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={Math.round(imageScale * 10) / 10}
                  onChange={(e) =>
                    emit({
                      fillImageScale: parseFillImageScale(Number(e.target.value)),
                    })
                  }
                  className={cn(
                    'h-full w-10 bg-transparent text-center text-[11px] text-[var(--ink)] outline-none',
                    INPUT_NO_SPIN
                  )}
                />
                %
              </label>
              <Tooltip tip={t('editor.fillRotate90')} placement="top">
                <button
                  type="button"
                  aria-label={t('editor.fillRotate90')}
                  onClick={cycleRotate}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--accent-soft)] text-[var(--muted)] hover:text-[var(--ink)]"
                >
                  <HiOutlineArrowPath className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </div>

            <div className="space-y-1.5">
              <ImageAdjustRow
                label={t('editor.fillOpacity')}
                value={Math.round(imageOpacity)}
                onChange={(n) =>
                  emit({ fillOpacity: Math.max(0, Math.min(100, Math.round(n) || 0)) })
                }
              />
              {IMAGE_ADJUST_ROW_KEYS.map(({ key, labelKey }) => (
                <ImageAdjustRow
                  key={key}
                  label={t(labelKey)}
                  value={imageAdjust[key]}
                  onChange={(n) => updateImageAdjust(key, n)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {!isGradient && !isDiffuse && panelType === 'solid' ? (
          <ColorPanel
            value={solid}
            onChange={(hex) => emit({ fillType: 'solid', fillColor: hex })}
            opacity={value.fillOpacity ?? 100}
            onOpacityChange={(opacity) => emit({ fillOpacity: opacity })}
            showAlpha
            title=""
            showHeader={false}
            padded={false}
            presets={FILL_SOLID_PRESETS}
            className="w-full !shadow-none !ring-0"
          />
        ) : null}
    </StylePanelShell>
  );
}

export type FillPanelPopoverProps = {
  value: FillPanelValue;
  onChange: (next: FillPanelValue) => void;
  title?: string;
  placement?: Placement;
  offset?: number;
  shiftMainAxis?: boolean;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode | ((ctx: { open: boolean; preview: string }) => ReactNode);
  floatingStyle?: CSSProperties;
  meshSelectedIndex?: number;
  onMeshSelectedIndexChange?: (index: number) => void;
  meshShowGuides?: boolean;
  onMeshShowGuidesChange?: (show: boolean) => void;
  onReset?: () => void;
};

/** Floating fill panel (type tabs + solid / gradients / image). */
function FillPanelPopover({
  value,
  onChange,
  title,
  placement = 'bottom-start',
  offset: offsetDistance = 10,
  shiftMainAxis = true,
  disabled = false,
  className,
  triggerClassName,
  open: controlledOpen,
  onOpenChange,
  children,
  floatingStyle,
  meshSelectedIndex,
  onMeshSelectedIndexChange,
  meshShowGuides,
  onMeshShowGuidesChange,
  onReset,
}: FillPanelPopoverProps) {
  const { t } = useTranslation();
  const panelTitle = title ?? t('editor.selectionToolbar.color');
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setLocalOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange]
  );

  const preview = fillPanelPreview(value);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(offsetDistance),
      flip({
        padding: 12,
        fallbackPlacements: ['top-start', 'top-end', 'right-start', 'left-start'],
      }),
      shift({ padding: 12, mainAxis: shiftMainAxis }),
    ],
  });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

  const trigger =
    typeof children === 'function'
      ? children({ open, preview })
      : children ?? (
          <span
            className={cn(
              'relative inline-flex h-4 w-4 overflow-hidden rounded-full ring-1 ring-black/10',
              triggerClassName
            )}
          >
            <span
              aria-hidden
              className="absolute inset-0"
              style={{
                backgroundImage:
                  'linear-gradient(45deg, #d0d0d0 25%, transparent 25%), linear-gradient(-45deg, #d0d0d0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d0d0d0 75%), linear-gradient(-45deg, transparent 75%, #d0d0d0 75%)',
                backgroundSize: '6px 6px',
                backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
              }}
            />
            <span className="absolute inset-0" style={{ background: preview }} />
          </span>
        );

  return (
    <>
      <Tooltip tip={panelTitle} placement="top" disabled={open || !panelTitle}>
        <button
          type="button"
          ref={refs.setReference}
          disabled={disabled}
          aria-label={panelTitle}
          aria-expanded={open}
          className={cn(
            'inline-flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-40',
            className
          )}
          {...getReferenceProps({
            onClick: () => {
              if (!disabled) setOpen(!open);
            },
          })}
        >
          {trigger}
        </button>
      </Tooltip>

      <FloatingPortal>
        {open ? (
          <div
            ref={refs.setFloating}
            style={{ ...floatingStyles, ...floatingStyle }}
            className="z-[120]"
            {...getFloatingProps()}
          >
            <FillPanel
              value={value}
              onChange={onChange}
              title={panelTitle}
              onClose={() => setOpen(false)}
              onReset={onReset}
              meshSelectedIndex={meshSelectedIndex}
              onMeshSelectedIndexChange={onMeshSelectedIndexChange}
              meshShowGuides={meshShowGuides}
              onMeshShowGuidesChange={onMeshShowGuidesChange}
            />
          </div>
        ) : null}
      </FloatingPortal>
    </>
  );
}

const MemoizedFillPanel = memo(FillPanel);
export default MemoizedFillPanel;
export { MemoizedFillPanel as FillPanel };
const MemoizedFillPanelPopover = memo(FillPanelPopover);
export { MemoizedFillPanelPopover as FillPanelPopover };
