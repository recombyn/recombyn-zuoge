import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BiExit } from 'react-icons/bi';
import { LuLink2, LuRotateCcw } from 'react-icons/lu';
import { FloatingToolbar } from '@/components/editor/chrome/FloatingToolbar';
import { cn } from '@/utils/classnames';
import { imageToolBtn, ImageToolSep } from '../imageToolbarShared';
import type { LayerMaskBrushSettings, MaskPaintColor } from './layerMaskBrush';

type Props = {
  brush: LayerMaskBrushSettings;
  paintColor: MaskPaintColor;
  maskEnabled: boolean;
  maskPreviewOnly: boolean;
  onBrushChange: (patch: Partial<LayerMaskBrushSettings>) => void;
  onPaintColorChange: (color: MaskPaintColor) => void;
  onToggleMaskEnabled: () => void;
  onToggleMaskPreview: () => void;
  onInvert: () => void;
  onClear: () => void;
  onConfirm: () => void;
  onExit: () => void;
  busy?: boolean;
};

function SliderRow({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex min-w-[7.5rem] flex-col gap-0.5 text-[10px] text-[var(--muted)]">
      <span className="flex justify-between gap-2">
        <span>{label}</span>
        <span className="tabular-nums text-[var(--ink)]">{Math.round(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full accent-[var(--ink)]"
      />
    </label>
  );
}

function LayerMaskBrushBar({
  brush,
  paintColor,
  maskEnabled,
  maskPreviewOnly,
  onBrushChange,
  onPaintColorChange,
  onToggleMaskEnabled,
  onToggleMaskPreview,
  onInvert,
  onClear,
  onConfirm,
  onExit,
  busy,
}: Props): ReactNode {
  const { t } = useTranslation();

  return (
    <FloatingToolbar className="relative max-w-[min(96vw,56rem)] gap-2 px-3 py-2">
      <span className="shrink-0 text-[12px] font-medium text-[var(--ink)]">
        {t('editor.imageToolbar.layerMask')}
      </span>
      <ImageToolSep />
      <SliderRow
        label={t('editor.imageToolbar.maskBrushSize')}
        value={brush.size}
        min={8}
        max={280}
        onChange={(size) => onBrushChange({ size })}
      />
      <SliderRow
        label={t('editor.imageToolbar.maskHardness')}
        value={brush.hardness}
        min={0}
        max={100}
        onChange={(hardness) => onBrushChange({ hardness })}
      />
      <SliderRow
        label={t('editor.imageToolbar.maskOpacity')}
        value={brush.opacity}
        min={1}
        max={100}
        onChange={(opacity) => onBrushChange({ opacity })}
      />
      <SliderRow
        label={t('editor.imageToolbar.maskFlow')}
        value={brush.flow}
        min={1}
        max={100}
        onChange={(flow) => onBrushChange({ flow })}
      />
      <SliderRow
        label={t('editor.imageToolbar.maskSmooth')}
        value={brush.smooth}
        min={0}
        max={100}
        onChange={(smooth) => onBrushChange({ smooth })}
      />
      <ImageToolSep />
      <button
        type="button"
        className={cn(
          imageToolBtn,
          paintColor === 'white' && 'bg-[var(--accent-soft)]'
        )}
        onClick={() => onPaintColorChange('white')}
      >
        {t('editor.imageToolbar.maskPaintReveal')}
      </button>
      <button
        type="button"
        className={cn(imageToolBtn, paintColor === 'black' && 'bg-[var(--accent-soft)]')}
        onClick={() => onPaintColorChange('black')}
      >
        {t('editor.imageToolbar.maskPaintHide')}
      </button>
      <button type="button" className={imageToolBtn} onClick={onInvert}>
        <LuRotateCcw className="h-3.5 w-3.5" />
        <span>{t('editor.imageToolbar.maskInvert')}</span>
      </button>
      <button type="button" className={imageToolBtn} onClick={onClear}>
        <span>{t('editor.imageToolbar.maskClear')}</span>
      </button>
      <ImageToolSep />
      <button
        type="button"
        className={cn(imageToolBtn, !maskEnabled && 'bg-[var(--accent-soft)]')}
        onClick={onToggleMaskEnabled}
      >
        <LuLink2 className="h-3.5 w-3.5" />
        <span>
          {maskEnabled
            ? t('editor.imageToolbar.maskEnabled')
            : t('editor.imageToolbar.maskDisabled')}
        </span>
      </button>
      <button
        type="button"
        className={cn(imageToolBtn, maskPreviewOnly && 'bg-[var(--accent-soft)]')}
        onClick={onToggleMaskPreview}
      >
        <span>{t('editor.imageToolbar.maskPreviewOnly')}</span>
      </button>
      <ImageToolSep />
      <button
        type="button"
        className={cn(imageToolBtn, 'font-medium')}
        disabled={busy}
        onClick={onConfirm}
      >
        <span>{t('editor.imageToolbar.maskConfirm')}</span>
      </button>
      <button type="button" className={imageToolBtn} onClick={onExit} aria-label={t('editor.exit')}>
        <BiExit className="h-4 w-4" />
      </button>
    </FloatingToolbar>
  );
}

export default memo(LayerMaskBrushBar);
