import { memo } from 'react';
import { HiOutlineArrowPath } from 'react-icons/hi2';
import { useTranslation } from 'react-i18next';
import Slider from '@/components/base/slider';
import ImageToolPanelShell, { PanelFooterActions, PanelIconBtn } from './ImageToolPanelShell';
import { brushModeClass } from './maskBrushUtils';
import type { MattingBrushMode } from './MattingHintOverlay';

function ModeButton({
  active,
  tone,
  label,
  onClick,
}: {
  active: boolean;
  tone: 'include' | 'exclude';
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={brushModeClass(active, tone)} onClick={onClick}>
      {label}
    </button>
  );
}

/** Smart matting: optional keep/exclude brushes; confirm runs auto cutout when empty. */
function RemoveBgToolPanel({
  brushSize,
  onBrushSizeChange,
  brushMode,
  onBrushModeChange,
  hasStrokes,
  onReset,
  onCancel,
  onConfirm,
  confirmBusy,
}: {
  brushSize: number;
  onBrushSizeChange: (v: number) => void;
  brushMode: MattingBrushMode;
  onBrushModeChange: (mode: MattingBrushMode) => void;
  hasStrokes: boolean;
  onReset: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  confirmBusy?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ImageToolPanelShell
      title={t('editor.imageToolbar.removeBg')}
      width={260}
      onClose={onCancel}
      headerRight={
        <PanelIconBtn title={t('editor.imageToolbar.resetMattingHints', '重置涂抹')} onClick={onReset}>
          <HiOutlineArrowPath className="h-4 w-4" />
        </PanelIconBtn>
      }
      footer={
        <PanelFooterActions
          onCancel={onCancel}
          onConfirm={onConfirm}
          confirmLabel={t('editor.imageToolbar.runSmartMatting', '智能抠图')}
          confirmDisabled={false}
          confirmBusy={confirmBusy}
        />
      }
    >
      <p className="px-1 pb-2 text-xs leading-relaxed text-white/55">
        {t(
          'editor.imageToolbar.mattingHintHelp',
          '直接抠图由系统自动识别主体；可选涂抹保留或排除区域以微调。'
        )}
      </p>
      <div className="mb-3 flex gap-2">
        <ModeButton
          active={brushMode === 'include'}
          tone="include"
          label={t('editor.imageToolbar.mattingInclude', '保留')}
          onClick={() => onBrushModeChange('include')}
        />
        <ModeButton
          active={brushMode === 'exclude'}
          tone="exclude"
          label={t('editor.imageToolbar.mattingExclude', '排除')}
          onClick={() => onBrushModeChange('exclude')}
        />
      </div>
      <div className="flex flex-col items-stretch gap-3 py-1">
        <Slider min={16} max={400} step={1} value={brushSize} onChange={onBrushSizeChange} />
      </div>
      {hasStrokes ? (
        <p className="pt-2 text-xs text-white/45">
          {t('editor.imageToolbar.mattingStrokesActive', '已添加涂抹，将结合智能抠图微调边缘。')}
        </p>
      ) : null}
    </ImageToolPanelShell>
  );
}

export default memo(RemoveBgToolPanel);
