import { memo, type ReactNode } from 'react';

import { useTranslation } from 'react-i18next';

import { HiOutlineCube, HiOutlineLanguage } from 'react-icons/hi2';
import { LuEraser } from 'react-icons/lu';
import { PiSelectionPlus } from 'react-icons/pi';
import { VscEditSparkle } from 'react-icons/vsc';

import { Icon } from '@/components/base';

import { cn } from '@/utils/classnames';

import ImageRemoveBgMenu, { type RemoveBgMode } from './ImageRemoveBgMenu';

import ImageDecomposeMenu, { type DecomposeMode } from './ImageDecomposeMenu';

import { ImageToolSep, imageToolBtn } from './imageToolbarShared';



export type { RemoveBgMode, DecomposeMode };



function Tool({

  label,

  onClick,

  children,

  active,

}: {

  label: string;

  onClick?: () => void;

  children: ReactNode;

  active?: boolean;

}) {

  return (

    <button

      type="button"

      className={cn(imageToolBtn, 'relative', active && 'bg-[var(--accent-soft)]')}

      onClick={onClick}

    >

      {children}

      <span>{label}</span>

    </button>

  );

}



/** Image selection toolbar edit actions (AI tools + optional trailing slots). */

function ImageToolbarEditTools({

  onUpscale,

  onRemoveBg,

  onEraser,

  onMark,

  onReplaceText,

  onEditText,

  onEditElements,

  onMultiAngle,

  previewSlot,

  downloadSlot,

}: {

  onUpscale: () => void;

  onRemoveBg?: (mode: RemoveBgMode) => void;

  onEraser: () => void;

  onMark?: () => void;

  onReplaceText?: () => void;

  onEditText?: () => void;

  onEditElements?: (mode: DecomposeMode) => void;

  onMultiAngle: () => void;

  previewSlot?: ReactNode;

  downloadSlot?: ReactNode;

}) {

  const { t } = useTranslation();

  const hasTrailing = Boolean(previewSlot || downloadSlot);

  return (

    <>

      <Tool label={t('editor.imageToolbar.upscale')} onClick={onUpscale}>

        <Icon name="editor-upscale" width={16} height={16} className="text-current" />

      </Tool>

      {onRemoveBg ? <ImageRemoveBgMenu onPick={onRemoveBg} /> : null}

      <Tool label={t('editor.imageToolbar.eraser')} onClick={onEraser}>

        <LuEraser className="h-4 w-4" />

      </Tool>

      {onMark ? (

        <Tool label={t('editor.imageToolbar.mark')} onClick={onMark}>

          <PiSelectionPlus className="h-4 w-4" />

        </Tool>

      ) : null}

      {onReplaceText ? (

        <Tool label={t('editor.imageToolbar.replaceText')} onClick={onReplaceText}>

          <HiOutlineLanguage className="h-4 w-4" />

        </Tool>

      ) : null}

      {onEditText ? (

        <Tool label={t('editor.imageToolbar.editText')} onClick={onEditText}>

          <VscEditSparkle className="h-4 w-4" />

        </Tool>

      ) : null}

      {onEditElements ? <ImageDecomposeMenu onPick={onEditElements} /> : null}

      <Tool label={t('editor.imageToolbar.multiAngle')} onClick={onMultiAngle}>

        <HiOutlineCube className="h-4 w-4" />

      </Tool>

      {hasTrailing ? (

        <>

          <ImageToolSep />

          {previewSlot}

          {downloadSlot}

        </>

      ) : null}

    </>

  );

}



export default memo(ImageToolbarEditTools);

