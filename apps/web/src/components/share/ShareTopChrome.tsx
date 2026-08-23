import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineCodeBracket } from 'react-icons/hi2';
import { getInspectDockWidth } from '@/components/editor/panels/DevPropertiesPanel';
import { EditorTopExportButton } from '@/components/editor/panels/ExportSelectionPanel';
import WalletAccountChip from '@/components/layout/WalletAccountChip';
import { cn } from '@/utils/classnames';

type Props = {
  shareName: string;
  compactTopBar: boolean;
  inspectOpen: boolean;
  canExport: boolean;
  onToggleInspect: () => void;
};

/** Share preview top bar: title + export / inspect / wallet. */
function ShareTopChrome({
  shareName,
  compactTopBar,
  inspectOpen,
  canExport,
  onToggleInspect,
}: Props) {
  const { t } = useTranslation();

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-3 z-40 flex items-center gap-2 pl-4"
      style={{
        paddingRight: inspectOpen ? getInspectDockWidth() + 16 : 16,
      }}
    >
      <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0 truncate text-[14px] font-medium text-[var(--ink)]">
          {shareName}
        </span>
        {compactTopBar ? null : (
          <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-[var(--surface)] px-2 text-[11px] font-medium text-[var(--muted)] ring-1 ring-[var(--line)]">
            {t('editor.sharePreviewOnly', { defaultValue: t('editor.sharePreview') })}
          </span>
        )}
      </div>
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
          <WalletAccountChip className={compactTopBar ? 'max-w-[7.5rem]' : undefined} />
        </div>
      )}
    </div>
  );
}

export default memo(ShareTopChrome);
