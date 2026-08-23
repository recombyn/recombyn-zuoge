import { memo } from 'react';
import { HiOutlineArrowPath } from 'react-icons/hi2';
import { useTranslation } from 'react-i18next';
import { EffectsForm } from '@/components/rcb/selection/chrome/EffectsControl';
import ImageToolPanelShell, { PanelIconBtn } from './ImageToolPanelShell';

type EffectPatch = Record<string, string | number | boolean>;

const EFFECTS_RESET: EffectPatch = {
  'inner-shadow-enabled': false,
  'inner-shadow-visible': false,
  'inner-shadow-color': 'rgba(0,0,0,0.25)',
  'inner-shadow-x': 0,
  'inner-shadow-y': 2,
  'inner-shadow-blur': 4,
  'shadow-enabled': false,
  'shadow-visible': false,
  'shadow-color': 'rgba(0,0,0,0.25)',
  'shadow-x': 0,
  'shadow-y': 2,
  'shadow-blur': 4,
  'blur-mode': 'backdrop',
  'blur-enabled': false,
  'blur-amount': 12,
  'backdrop-blur-enabled': false,
  'backdrop-blur-amount': 12,
  'backdrop-blur-brightness': 100,
};

/** Effects: shadows + blur, docked like Adjust. Applies immediately. */
function EffectsToolPanel({
  attrs,
  onChange,
  onReset,
  onClose,
}: {
  attrs: Record<string, unknown> | undefined;
  onChange: (patch: EffectPatch) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ImageToolPanelShell
      title={t('editor.imageToolbar.effects')}
      width={248}
      onClose={onClose}
      headerRight={
        <PanelIconBtn title={t('editor.imageToolbar.reset')} onClick={onReset}>
          <HiOutlineArrowPath className="h-4 w-4" />
        </PanelIconBtn>
      }
    >
      <div className="-mx-2 max-h-[min(70vh,22rem)] overflow-y-auto">
        <EffectsForm attrs={attrs} onChange={onChange} />
      </div>
    </ImageToolPanelShell>
  );
}

export { EFFECTS_RESET };
export default memo(EffectsToolPanel);
