import { memo } from 'react';
import { HiOutlineArrowPath, HiOutlineCheck } from 'react-icons/hi2';
import { useTranslation } from 'react-i18next';
import { DropdownPanelItem } from '@/components/base';
import {
  BLEND_MODE_OPTIONS,
  BlendModeIcon,
  parseBlendMode,
  type BlendModeId,
} from '@/components/rcb/selection/chrome/BlendModeControl';
import ImageToolPanelShell, { PanelIconBtn } from './ImageToolPanelShell';

const IMAGE_BLEND_OPTIONS = BLEND_MODE_OPTIONS.filter((opt) => opt.id !== 'pass-through');

function BlendModeRowCheck({ selected }: { selected: boolean }) {
  if (!selected) return <span className="h-3.5 w-3.5 shrink-0" />;
  return <HiOutlineCheck className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />;
}

/** Blend mode list docked beside the image. Applies immediately. */
function BlendModeToolPanel({
  blendMode,
  onChange,
  onReset,
  onClose,
}: {
  blendMode: unknown;
  onChange: (mode: BlendModeId) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mode = parseBlendMode(blendMode, { allowPassThrough: false });
  return (
    <ImageToolPanelShell
      title={t('editor.imageToolbar.blendMode')}
      width={240}
      onClose={onClose}
      headerRight={
        <PanelIconBtn title={t('editor.imageToolbar.reset')} onClick={onReset}>
          <HiOutlineArrowPath className="h-4 w-4" />
        </PanelIconBtn>
      }
    >
      <div className="-mx-1 max-h-[min(70vh,22rem)] overflow-y-auto">
        {IMAGE_BLEND_OPTIONS.map((opt, index) => {
          const prev = IMAGE_BLEND_OPTIONS[index - 1];
          const showDivider = Boolean(opt.groupStart && prev);
          return (
            <div key={opt.id}>
              {showDivider ? <div className="my-0.5 h-px bg-[var(--line)]" aria-hidden /> : null}
              <DropdownPanelItem selected={mode === opt.id} onClick={() => onChange(opt.id)}>
                <BlendModeIcon mode={opt.id} />
                <span className="min-w-0 flex-1 truncate">{t(`editor.blendMode.${opt.id}`)}</span>
                <BlendModeRowCheck selected={mode === opt.id} />
              </DropdownPanelItem>
            </div>
          );
        })}
      </div>
    </ImageToolPanelShell>
  );
}

export default memo(BlendModeToolPanel);
