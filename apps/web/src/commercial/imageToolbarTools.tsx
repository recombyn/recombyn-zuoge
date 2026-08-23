import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { LuSquare } from 'react-icons/lu';
import { openImageToolPanel } from '@/store/modules/editor';
import { imageToolBtn } from '@/components/editor/nodes/ImageNode/imageToolbarShared';

type Props = {
  nodeId: string;
};

/** Optional commercial image tools. */
export function CommercialImageToolbarTools({ nodeId }: Props) {
  const dispatch = useDispatch();
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className={imageToolBtn}
      onClick={() => dispatch(openImageToolPanel({ nodeId, kind: 'layerMask' }))}
    >
      <LuSquare className="h-4 w-4" />
      <span>{t('editor.imageToolbar.layerMask')}</span>
    </button>
  );
}
