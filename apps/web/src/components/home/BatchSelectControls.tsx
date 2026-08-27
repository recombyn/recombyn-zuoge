import { useTranslation } from 'react-i18next';
import {
  HiOutlineCheck,
  HiOutlineMinus,
} from 'react-icons/hi2';
import { RiDeleteBinLine } from 'react-icons/ri';
import { FloatingToolbar } from '@/components/editor/chrome/FloatingToolbar';
import { cn } from '@/utils/classnames';

export type BatchSelectControlsProps = {
  total: number;
  selectedCount: number;
  allSelected: boolean;
  deleting: boolean;
  onToggleSelectAll: () => void;
  onClearSelection: () => void;
  onDelete: () => void;
  onCancel: () => void;
  className?: string;
};

export function BatchSelectControls({
  total,
  selectedCount,
  allSelected,
  deleting,
  onToggleSelectAll,
  onClearSelection,
  onDelete,
  onCancel,
  className,
}: BatchSelectControlsProps) {
  const { t } = useTranslation();
  const hasSelection = selectedCount > 0;
  const partial = hasSelection && !allSelected;

  return (
    <div
      role="toolbar"
      aria-label={t('home.batchSelect')}
      className={cn(
        'inline-flex max-w-full items-center gap-2 overflow-x-auto text-[13px] font-medium text-[var(--ink)]',
        className
      )}
    >
      <button
        type="button"
        onClick={onToggleSelectAll}
        className="inline-flex shrink-0 items-center gap-2"
      >
        <span
          className={cn(
            'flex h-4 w-4 items-center justify-center rounded-[3px] border transition',
            hasSelection
              ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--on-brand)]'
              : 'border-[var(--line)] bg-[var(--surface)] text-transparent'
          )}
          aria-hidden
        >
          {allSelected ? (
            <HiOutlineCheck className="h-2.5 w-2.5" strokeWidth={3} />
          ) : partial ? (
            <HiOutlineMinus className="h-2.5 w-2.5" strokeWidth={3} />
          ) : null}
        </span>
        <span className="whitespace-nowrap">
          {hasSelection
            ? t('home.selectedCount', { count: selectedCount })
            : `${t('home.selectAll')} (${total})`}
        </span>
      </button>

      <span className="mx-0.5 h-4 w-px shrink-0 bg-[var(--line)]" aria-hidden />

      {hasSelection ? (
        <>
          <button
            type="button"
            disabled={deleting}
            onClick={onDelete}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-red-500 disabled:opacity-40"
          >
            {deleting ? (
              <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-red-500/30 border-t-red-500" />
            ) : (
              <RiDeleteBinLine className="h-3.5 w-3.5" />
            )}
            {t('common.delete')}
          </button>
          <button
            type="button"
            onClick={onClearSelection}
            className="shrink-0 whitespace-nowrap"
          >
            {t('home.clearSelection')}
          </button>
        </>
      ) : null}

      <button
        type="button"
        onClick={onCancel}
        className="shrink-0 whitespace-nowrap"
      >
        {t('common.cancel')}
      </button>
    </div>
  );
}

/** Mobile: bottom floating pill. Desktop uses header controls instead. */
export function BatchSelectBottomBar(props: BatchSelectControlsProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4 lg:hidden">
      <FloatingToolbar
        role="presentation"
        className="pointer-events-auto max-w-full px-3 py-2"
      >
        <BatchSelectControls {...props} />
      </FloatingToolbar>
    </div>
  );
}
