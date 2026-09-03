import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { VscLayers } from 'react-icons/vsc';
import { imageToolBtn } from './imageToolbarShared';

export type DecomposeMode = 'depth';

/** WaveSpeed qwen-image/layered decompose entry. */
function ImageDecomposeMenu({ onPick }: { onPick: (mode: DecomposeMode) => void }): ReactNode {
  const { t } = useTranslation();
  return (
    <button type="button" className={imageToolBtn} onClick={() => onPick('depth')}>
      <VscLayers className="h-4 w-4" />
      <span>{t('editor.imageToolbar.editElements')}</span>
    </button>
  );
}

export default memo(ImageDecomposeMenu);
