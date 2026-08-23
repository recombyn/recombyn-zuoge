import { type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { LuMousePointer2, LuPenTool, LuPlus } from 'react-icons/lu';
import Tooltip from '@/components/base/tooltip';
import { Icon } from '@/components/base/icon';
import { FloatingToolbar } from '@/components/editor/chrome/FloatingToolbar';
import { cn } from '@/utils/classnames';

export type PathEditSubtool = 'select' | 'pen' | 'add-anchor' | 'curve';

const PATH_EDIT_BTN =
  'inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors text-[var(--ink)] hover:bg-[var(--accent-soft)]';
const PATH_EDIT_BTN_ACTIVE = 'bg-[var(--ink)] text-[var(--on-brand)] hover:bg-[var(--ink)]';
/** Done / confirm — solid ink command with check. */
const PATH_EDIT_BTN_DONE =
  'inline-flex h-6 items-center justify-center rounded-md px-2 text-[12px] text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)]';

function PathEditToolbar({
  subtool,
  onSubtoolChange,
  onExit,
}: {
  subtool: PathEditSubtool;
  onSubtoolChange: (tool: PathEditSubtool) => void;
  onExit: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const selectLabel = t('editor.pathEditSelect');
  const penLabel = t('editor.pathEditPen');
  const addAnchorLabel = t('editor.pathEditAddAnchor');
  const curveLabel = t('editor.pathEditCurve');
  const doneLabel = t('editor.pathEditExit');
  return (
    <FloatingToolbar className="pointer-events-auto h-8 gap-1.5 px-3 py-0">
      <Tooltip tip={selectLabel} placement="bottom">
        <button
          type="button"
          aria-label={selectLabel}
          aria-pressed={subtool === 'select'}
          className={cn(PATH_EDIT_BTN, subtool === 'select' && PATH_EDIT_BTN_ACTIVE)}
          onClick={() => onSubtoolChange('select')}
        >
          <LuMousePointer2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </Tooltip>
      <Tooltip tip={penLabel} placement="bottom">
        <button
          type="button"
          aria-label={penLabel}
          aria-pressed={subtool === 'pen'}
          className={cn(PATH_EDIT_BTN, subtool === 'pen' && PATH_EDIT_BTN_ACTIVE)}
          onClick={() => onSubtoolChange('pen')}
        >
          <LuPenTool className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </Tooltip>
      <Tooltip tip={addAnchorLabel} placement="bottom">
        <button
          type="button"
          aria-label={addAnchorLabel}
          aria-pressed={subtool === 'add-anchor'}
          className={cn(PATH_EDIT_BTN, subtool === 'add-anchor' && PATH_EDIT_BTN_ACTIVE)}
          onClick={() => onSubtoolChange('add-anchor')}
        >
          <span className="relative block h-4 w-4" aria-hidden>
            <LuPenTool className="absolute bottom-0 left-0 h-3.5 w-3.5" strokeWidth={1.75} />
            <LuPlus className="absolute right-0 top-0 h-2 w-2" strokeWidth={2.5} />
          </span>
        </button>
      </Tooltip>
      <Tooltip tip={curveLabel} placement="bottom">
        <button
          type="button"
          aria-label={curveLabel}
          aria-pressed={subtool === 'curve'}
          className={cn(PATH_EDIT_BTN, subtool === 'curve' && PATH_EDIT_BTN_ACTIVE)}
          onClick={() => onSubtoolChange('curve')}
        >
          <Icon name="editor-path-curve" width={14} height={14} />
        </button>
      </Tooltip>
      <span className="mx-0.5 h-3.5 w-px shrink-0 bg-[var(--line)]" aria-hidden />
      <Tooltip tip={doneLabel} placement="bottom">
        <button
          type="button"
          aria-label={doneLabel}
          className={PATH_EDIT_BTN_DONE}
          onClick={onExit}
        >
          {doneLabel}
        </button>
      </Tooltip>
    </FloatingToolbar>
  );
}

export default memo(PathEditToolbar);
