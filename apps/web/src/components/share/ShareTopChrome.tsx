import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineCodeBracket } from 'react-icons/hi2';
import EditorProjectMenu from '@/components/editor/chrome/EditorProjectMenu';
import { useLeftDockInset, useRightDockInset } from '@/components/editor/page/editorBottomHudLayout';
import { EditorTopExportButton } from '@/components/editor/panels/ExportSelectionPanel';
import { cn } from '@/utils/classnames';

type Props = {
  shareName: string;
  compactTopBar: boolean;
  inspectOpen: boolean;
  canExport: boolean;
  onToggleInspect: () => void;
  onProjectList: () => void;
  onNewProject: () => void;
  onDuplicateProject: () => void;
  onImportJson: (file: File) => void;
};

/** Share preview top bar — same left chrome as EditorTopChrome (menu + title). */
function ShareTopChrome({
  shareName,
  compactTopBar,
  inspectOpen,
  canExport,
  onToggleInspect,
  onProjectList,
  onNewProject,
  onDuplicateProject,
  onImportJson,
}: Props) {
  const { t } = useTranslation();
  const leftHudInsetPx = useLeftDockInset(false);
  const rightHudInsetPx = useRightDockInset(false, inspectOpen, 'dev');

  return (
    <>
      <div
        className="pointer-events-none absolute top-3 z-20 hidden md:block"
        style={{ left: leftHudInsetPx }}
      >
        <div className="pointer-events-auto flex min-w-0 max-w-full items-center gap-2">
          <EditorProjectMenu
            onProjectList={onProjectList}
            onNewProject={onNewProject}
            onDuplicateProject={onDuplicateProject}
            onImportJson={onImportJson}
            variant="float"
          />
          <span
            className="min-w-0 max-w-[min(16rem,calc(100vw-18rem))] truncate text-[14px] font-medium text-[var(--ink)]"
            title={shareName}
          >
            {shareName}
          </span>
        </div>
      </div>

      <div
        className="pointer-events-none absolute top-3 z-40 hidden md:block"
        style={{ right: rightHudInsetPx }}
      >
        {compactTopBar && inspectOpen ? null : (
          <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
            {canExport ? <EditorTopExportButton iconOnly={compactTopBar} /> : null}
            <button
              type="button"
              aria-label={t('editor.devInspect')}
              title={t('editor.devInspect')}
              onClick={onToggleInspect}
              className={cn(
                'inline-flex h-8 items-center justify-center rounded-xl text-[13px] font-medium shadow-sm ring-1 ring-[var(--line)]',
                compactTopBar ? 'w-8 px-0' : 'gap-1.5 px-3',
                inspectOpen
                  ? 'bg-[var(--ink)] text-[var(--on-brand)]'
                  : 'bg-[var(--surface)] text-[var(--ink)]'
              )}
            >
              <HiOutlineCodeBracket className="h-4 w-4 shrink-0" />
              {compactTopBar ? null : t('editor.devInspect')}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export default memo(ShareTopChrome);
