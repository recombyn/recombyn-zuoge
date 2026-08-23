import { useCallback, useEffect, useRef, useState, memo, type ChangeEvent } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { HiOutlineAdjustmentsHorizontal } from 'react-icons/hi2';
import { ColorPanelPopover } from '@/components/base/colorPanel';
import { Checkbox, DropdownPanel, Select, Slider } from '@/components/base';
import { Icon } from '@/components/base/icon';
import Tooltip from '@/components/base/tooltip';
import { FloatingToolbar } from '@/components/editor/chrome/FloatingToolbar';
import { FillColorSwatch, StrokeColorSwatch } from '@/components/rcb/selection/chrome';
import {
  DEFAULT_PENCIL_BRUSH_ID,
  findPencilBrush,
  isPencilEasingId,
  PENCIL_EASING_IDS,
  resetPencilBrushOptions,
  updatePencilBrushEasing,
  updatePencilBrushInk,
  updatePencilBrushOptions,
  type PencilBrushDef,
  type PencilBrushId,
} from '@/components/rcb/tools/pencilBrushes';
import {
  setActiveTool,
  setPenFillColor,
  setPenStrokeColor,
  setPenStrokeOpacity,
  setPenStrokeWidth,
} from '@/store/modules/editor';
import { cn } from '@/utils/classnames';

function formatBrushValue(value: number, digits: number): string {
  return Number(value).toFixed(digits);
}

function formatPx(value: number): string {
  return String(Math.round(Number(value) || 0));
}

function pencilEasingI18nKey(id: string): string {
  if (id === 'linear') return 'editor.pencilEasingLinear';
  return `editor.pencilEasing${id[0].toUpperCase()}${id.slice(1)}`;
}

function BrushSettingsPanel({
  brush,
  fillColor,
  strokeColor,
  strokeWidth,
  opacity,
  onFillColorChange,
  onStrokeColorChange,
  onStrokeWidthChange,
  onOpacityChange,
  onChanged,
}: {
  brush: PencilBrushDef;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  onFillColorChange: (value: string) => void;
  onStrokeColorChange: (value: string) => void;
  onStrokeWidthChange: (value: number) => void;
  onOpacityChange: (pct: number) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const options = brush.options;
  const start = typeof options.start === 'object' ? options.start : {};
  const end = typeof options.end === 'object' ? options.end : {};
  const thinning = Number(options.thinning ?? 0.5);
  const streamline = Number(options.streamline ?? 0.5);
  const smoothing = Number(options.smoothing ?? 0.5);
  const startTaper = Number(start?.taper ?? 0);
  const endTaper = Number(end?.taper ?? 0);
  const easingOptions = PENCIL_EASING_IDS.map((value) => ({
    value,
    label: t(pencilEasingI18nKey(value)),
  }));

  function patchOptions(patch: Partial<PencilBrushDef['options']>) {
    updatePencilBrushOptions(brush.id, patch);
    onChanged();
  }

  function setTaper(side: 'start' | 'end', value: number) {
    patchOptions({ [side]: { taper: value } });
  }

  function setCap(side: 'start' | 'end', cap: boolean) {
    patchOptions({ [side]: { cap } });
  }

  function setEasing(which: 'easing' | 'start' | 'end', value: string) {
    if (!isPencilEasingId(value)) return;
    updatePencilBrushEasing(brush.id, which, value);
    onChanged();
  }

  return (
    <div className="flex max-h-[min(72vh,560px)] flex-col gap-3 overflow-y-auto px-4 pb-3 pt-2 text-[12px]">
      <SettingRange
        label={t('editor.pencilBrushSize')}
        min={1}
        max={200}
        step={1}
        value={strokeWidth}
        display={formatPx(strokeWidth)}
        onChange={onStrokeWidthChange}
      />
      <SettingRange
        label={t('editor.pencilBrushThinning')}
        min={-1}
        max={1}
        step={0.01}
        value={thinning}
        display={formatBrushValue(thinning, 2)}
        fillFromZero
        onChange={(value) => patchOptions({ thinning: value })}
      />
      <SettingRange
        label={t('editor.pencilBrushStreamline')}
        min={0}
        max={1}
        step={0.01}
        value={streamline}
        display={formatBrushValue(streamline, 2)}
        onChange={(value) => patchOptions({ streamline: value })}
      />
      <SettingRange
        label={t('editor.pencilBrushSmoothing')}
        min={0}
        max={1}
        step={0.01}
        value={smoothing}
        display={formatBrushValue(smoothing, 2)}
        onChange={(value) => patchOptions({ smoothing: value })}
      />
      <SettingSelect
        label={t('editor.pencilBrushEasing')}
        value={brush.easingId || 'linear'}
        options={easingOptions}
        onChange={(value) => setEasing('easing', value)}
      />

      <div className="border-t border-[var(--line)] pt-3">
        <SettingRange
          label={t('editor.pencilBrushTaperStart')}
          min={0}
          max={100}
          step={1}
          value={startTaper}
          display={String(Math.round(startTaper))}
          onChange={(value) => setTaper('start', value)}
        />
        <div className="mt-2">
          <SettingSelect
            label={t('editor.pencilBrushEasingStart')}
            value={brush.startEasingId || 'linear'}
            options={easingOptions}
            onChange={(value) => setEasing('start', value)}
          />
        </div>
        <div className="mt-2">
          <SettingCheck
            label={t('editor.pencilBrushCapStart')}
            checked={start?.cap !== false}
            onChange={(checked) => setCap('start', checked)}
          />
        </div>
      </div>

      <div className="border-t border-[var(--line)] pt-3">
        <SettingRange
          label={t('editor.pencilBrushTaperEnd')}
          min={0}
          max={100}
          step={1}
          value={endTaper}
          display={String(Math.round(endTaper))}
          onChange={(value) => setTaper('end', value)}
        />
        <div className="mt-2">
          <SettingSelect
            label={t('editor.pencilBrushEasingEnd')}
            value={brush.endEasingId || 'linear'}
            options={easingOptions}
            onChange={(value) => setEasing('end', value)}
          />
        </div>
        <div className="mt-2">
          <SettingCheck
            label={t('editor.pencilBrushCapEnd')}
            checked={end?.cap !== false}
            onChange={(checked) => setCap('end', checked)}
          />
        </div>
      </div>

      <div className="border-t border-[var(--line)] pt-3">
        <SettingCheck
          label={t('editor.pencilBrushFill')}
          checked={brush.fillEnabled !== false}
          onChange={(checked) => {
            updatePencilBrushInk(brush.id, { fillEnabled: checked });
            onChanged();
          }}
        />
        <div className="mt-2">
          <SettingColorRow
            label={t('editor.pencilBrushFillColor')}
            color={fillColor}
            opacity={opacity}
            onChange={onFillColorChange}
            onOpacityChange={onOpacityChange}
          />
        </div>
        <div className="mt-3">
          <SettingRange
            label={t('editor.pencilBrushStroke')}
            min={0}
            max={200}
            step={1}
            value={Math.round(Number(brush.outlineStrokeWidth) || 0)}
            display={formatPx(Number(brush.outlineStrokeWidth) || 0)}
            onChange={(value) => {
              updatePencilBrushInk(brush.id, { outlineStrokeWidth: value });
              onChanged();
            }}
          />
        </div>
        <div className="mt-2">
          <SettingColorRow
            label={t('editor.pencilBrushStrokeColor')}
            color={strokeColor}
            opacity={opacity}
            onChange={onStrokeColorChange}
            onOpacityChange={onOpacityChange}
          />
        </div>
      </div>

      <div className="border-t border-[var(--line)] pt-3 text-[var(--muted)]">
        <button
          type="button"
          className="hover:text-[var(--accent)]"
          onClick={() => {
            resetPencilBrushOptions(brush.id);
            onChanged();
          }}
        >
          {t('editor.pencilBrushReset')}
        </button>
      </div>
    </div>
  );
}

function SettingRange({
  label,
  min,
  max,
  step,
  value,
  display,
  fillFromZero = false,
  inline = false,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  fillFromZero?: boolean;
  inline?: boolean;
  onChange: (value: number) => void;
}) {
  const slider = (
    <Slider
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={onChange}
      fillFromZero={fillFromZero}
      trackHeight={4}
      thumbWidth={14}
      thumbHeight={14}
    />
  );
  const readout = (
    <span className="w-10 shrink-0 text-right tabular-nums text-[var(--muted)]">{display}</span>
  );
  if (inline) {
    return (
      <label className="flex items-center gap-2 text-[12px] text-[var(--ink)]">
        <span className="w-[72px] shrink-0">{label}</span>
        <span className="min-w-0 flex-1">{slider}</span>
        {readout}
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1.5 text-[12px] text-[var(--ink)]">
      <span>{label}</span>
      <div className="flex items-center gap-2">
        {slider}
        {readout}
      </div>
    </label>
  );
}

function SettingSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-[12px] text-[var(--ink)]">
      <span>{label}</span>
      <Select
        size="small"
        type="filled"
        value={value}
        options={options}
        onChange={(next) => onChange(String(next))}
        className="w-full"
      />
    </label>
  );
}

function SettingCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex h-6 items-center justify-between gap-2 text-[12px] text-[var(--ink)]">
      <span>{label}</span>
      <Checkbox
        size="small"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </div>
  );
}

function SettingColorRow({
  label,
  color,
  opacity,
  onChange,
  onOpacityChange,
}: {
  label: string;
  color: string;
  opacity: number;
  onChange: (value: string) => void;
  onOpacityChange: (pct: number) => void;
}) {
  return (
    <div className="flex h-6 items-center justify-between gap-2 text-[12px] text-[var(--ink)]">
      <span>{label}</span>
      <ColorPanelPopover
        value={color}
        onChange={onChange}
        opacity={opacity}
        onOpacityChange={onOpacityChange}
        showAlpha
        title={label}
        placement="right"
      />
    </div>
  );
}

type PenStrokeToolbarProps = {
  /** Which tool's options to show. */
  mode: 'pen' | 'pencil';
  /**
   * `anchor` — float above the bottom tool strip.
   * `dock` — fixed at page top-center; brush menu opens downward.
   */
  placement?: 'anchor' | 'dock';
  className?: string;
};

/**
 * Pen / pencil stroke bar: fill color, Size (Px), and pencil settings.
 */
function PenStrokeToolbar({
  mode,
  placement = 'anchor',
  className,
}: PenStrokeToolbarProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const isPencil = mode === 'pencil';
  const docked = placement === 'dock';
  const color = useSelector((s: any) => String(s.editor.penStrokeColor || '#333333'));
  const fillColor = useSelector((s: any) => String(s.editor.penFillColor ?? 'transparent'));
  const width = useSelector((s: any) => {
    const n = Number(s.editor.penStrokeWidth);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
  });
  const brushId = useSelector((s: any) =>
    String(s.editor.pencilBrushId || DEFAULT_PENCIL_BRUSH_ID)
  ) as PencilBrushId;
  const opacity = useSelector((s: any) => {
    const n = Number(s.editor.penStrokeOpacity);
    return Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : 100;
  });
  const brush = findPencilBrush(brushId);
  const strokeColor = brush.outlineStrokeColor || color;
  const barWidth = width;
  const barWidthTip = isPencil ? t('editor.pencilBrushSize') : t('editor.pencilBrushWidth');
  const [, setBrushRev] = useState(0);
  const [brushOpen, setBrushOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const exitPenEdit = useCallback(() => {
    // Let PenDrawFeature commit the open path, then ensure we leave the tool.
    window.dispatchEvent(new Event('resume:exit-pen'));
    dispatch(setActiveTool('select'));
  }, [dispatch]);

  const onStrokeColorChange = useCallback(
    (hex: string) => dispatch(setPenStrokeColor(hex)),
    [dispatch]
  );
  const onFillColorChange = useCallback(
    (hex: string) => dispatch(setPenFillColor(hex)),
    [dispatch]
  );
  const onStrokeOpacityChange = useCallback(
    (pct: number) => dispatch(setPenStrokeOpacity(pct)),
    [dispatch]
  );
  const onStrokeWidthChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const n = Math.round(Number(e.target.value));
      dispatch(setPenStrokeWidth(n || 1));
    },
    [dispatch]
  );
  const onBrushStrokeColorChange = useCallback(
    (value: string) => {
      updatePencilBrushInk(brush.id, { outlineStrokeColor: value });
      setBrushRev((revision) => revision + 1);
    },
    [brush.id]
  );
  const onBrushFillColorChange = useCallback(
    (value: string) => dispatch(setPenStrokeColor(value)),
    [dispatch]
  );
  const onBrushStrokeWidthChange = useCallback(
    (value: number) => dispatch(setPenStrokeWidth(value)),
    [dispatch]
  );
  const onBrushOpacityChange = useCallback(
    (pct: number) => dispatch(setPenStrokeOpacity(pct)),
    [dispatch]
  );
  const onBrushSettingsChanged = useCallback(() => {
    setBrushRev((revision) => revision + 1);
  }, []);
  const toggleBrushOpen = useCallback(() => {
    setBrushOpen((open) => !open);
  }, []);

  useEffect(() => {
    if (!isPencil) setBrushOpen(false);
  }, [isPencil]);

  useEffect(() => {
    if (!brushOpen) return;
    function onDocPointer(e: PointerEvent) {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (rootRef.current?.contains(target)) return;
      if (target.closest('[data-select-dropdown]')) return;
      if (target.closest('[data-color-panel]')) return;
      setBrushOpen(false);
    }
    document.addEventListener('pointerdown', onDocPointer, true);
    return () => document.removeEventListener('pointerdown', onDocPointer, true);
  }, [brushOpen]);

  const menuPos = docked
    ? 'absolute left-1/2 top-[calc(100%+8px)] z-40 -translate-x-1/2'
    : 'absolute bottom-[calc(100%+8px)] left-1/2 z-40 -translate-x-1/2';

  return (
    <div
      ref={rootRef}
      className={cn(
        docked
          ? 'pointer-events-auto'
          : 'pointer-events-auto absolute bottom-[calc(100%+10px)] left-1/2 z-30 -translate-x-1/2',
        className
      )}
    >
      <FloatingToolbar className="relative h-8 gap-1 px-2 py-0">
        {isPencil ? (
          <ColorPanelPopover
            value={color}
            onChange={onStrokeColorChange}
            opacity={opacity}
            onOpacityChange={onStrokeOpacityChange}
            showAlpha={isPencil}
            title={t('editor.pencilBrushFill')}
            placement={docked ? 'bottom' : 'top'}
            offset={10}
            shiftMainAxis={false}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--accent-soft)]"
          >
            <FillColorSwatch color={color} />
          </ColorPanelPopover>
        ) : (
          <>
            <ColorPanelPopover
              value={fillColor}
              onChange={onFillColorChange}
              showAlpha
              title={t('editor.fill', { defaultValue: '背景' })}
              placement={docked ? 'bottom' : 'top'}
              offset={10}
              shiftMainAxis={false}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--accent-soft)]"
            >
              <FillColorSwatch color={fillColor} />
            </ColorPanelPopover>
            <ColorPanelPopover
              value={color}
              onChange={onStrokeColorChange}
              title={t('editor.stroke', { defaultValue: '描边' })}
              placement={docked ? 'bottom' : 'top'}
              offset={10}
              shiftMainAxis={false}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--accent-soft)]"
            >
              <StrokeColorSwatch color={color} />
            </ColorPanelPopover>
          </>
        )}

        <span className="mx-0.5 h-3.5 w-px bg-[var(--line)]" aria-hidden />

        {isPencil ? (
          <div className="relative">
            <Tooltip
              tip={t('editor.pencilBrushTitle')}
              placement={docked ? 'bottom' : 'top'}
            >
              <button
                type="button"
                aria-label={t('editor.pencilBrushTitle')}
                aria-expanded={brushOpen}
                onClick={toggleBrushOpen}
                className={cn(
                  'inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors',
                  brushOpen ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--accent-soft)]'
                )}
              >
                <HiOutlineAdjustmentsHorizontal className="h-3.5 w-3.5" />
              </button>
            </Tooltip>

            {brushOpen ? (
              <DropdownPanel
                className={cn(menuPos, 'w-[280px] rounded-xl p-0')}
                data-rcb-overlay="1"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="flex w-full flex-col overflow-hidden">
                  <header className="flex items-center px-4 pb-1 pt-3.5">
                    <span className="text-[15px] font-semibold tracking-tight text-[var(--ink)]">
                      {t('editor.pencilBrushTitle')}
                    </span>
                  </header>
                  <BrushSettingsPanel
                    brush={brush}
                    fillColor={color}
                    strokeColor={strokeColor}
                    strokeWidth={width}
                    opacity={opacity}
                    onFillColorChange={onBrushFillColorChange}
                    onStrokeColorChange={onBrushStrokeColorChange}
                    onStrokeWidthChange={onBrushStrokeWidthChange}
                    onOpacityChange={onBrushOpacityChange}
                    onChanged={onBrushSettingsChanged}
                  />
                </div>
              </DropdownPanel>
            ) : null}
          </div>
        ) : null}

        {isPencil ? <span className="mx-0.5 h-3.5 w-px bg-[var(--line)]" aria-hidden /> : null}

        {/* Width — pencil Size and pen stroke width share the same Px field. */}
        <label
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[4px] bg-[var(--accent-soft)] px-1.5"
          onPointerDown={(e) => e.stopPropagation()}
          title={barWidthTip}
        >
          <Icon name="editor-stroke-weight" className="h-3.5 w-3.5 shrink-0 text-[var(--ink)]" />
          <input
            type="number"
            min={1}
            max={200}
            value={barWidth}
            onChange={onStrokeWidthChange}
            step={1}
            className="h-full w-10 min-w-0 bg-transparent text-[11px] leading-none tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="shrink-0 text-[10px] text-[var(--muted)]">{t('editor.unitPx')}</span>
        </label>

        <span className="mx-0.5 h-3.5 w-px bg-[var(--line)]" aria-hidden />
        <Tooltip tip={`${t('editor.pathEditExit')} (Esc)`} placement={docked ? 'bottom' : 'top'}>
          <button
            type="button"
            aria-label={t('editor.pathEditExit')}
            onClick={exitPenEdit}
            onPointerDown={(e) => e.stopPropagation()}
            className="inline-flex h-6 items-center justify-center rounded-md px-2 text-[12px] text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)]"
          >
            {t('editor.pathEditExit')}
          </button>
        </Tooltip>
      </FloatingToolbar>
    </div>
  );
}

export default memo(PenStrokeToolbar);
