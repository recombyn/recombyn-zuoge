import { memo, type ReactNode } from 'react';

import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/base';

import { imageToolBtn } from './imageToolbarShared';



const TOOL_ICON_SIZE = 16;



export type RemoveBgMode = 'ilp';



/** Industrial matting — only shown when intelligence is connected. */

function ImageRemoveBgMenu({ onPick }: { onPick: (mode: RemoveBgMode) => void }): ReactNode {

  const { t } = useTranslation();

  return (

    <button type="button" className={imageToolBtn} onClick={() => onPick('ilp')}>

      <Icon

        name="editor-remove_bg"

        width={TOOL_ICON_SIZE}

        height={TOOL_ICON_SIZE}

        className="text-current"

      />

      <span>{t('editor.imageToolbar.removeBg')}</span>

    </button>

  );

}



export default memo(ImageRemoveBgMenu);

