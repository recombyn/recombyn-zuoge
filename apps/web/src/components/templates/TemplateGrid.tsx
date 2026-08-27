import { useEffect, useState, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineListBullet,
} from 'react-icons/hi2';
import { Button, Dialog, Input, message } from '@/components/base';
import { BatchSelectBottomBar, BatchSelectControls } from '@/components/home/BatchSelectControls';
import { useProjectDeleteRunner } from '@/hooks/useProjectDeleteRunner';
import {
  renameProjectOnCloud,
  requestProjectFlush,
} from '@/components/editor/useProjectCloudSync';
import {
  invalidateProjectsListCache,
  setProjectOrgApi,
} from '@/service/projects';
import { cn } from '@/utils/classnames';
import {
  deleteTemplate,
  deleteTemplates,
  renameTemplateById,
} from '@/store/modules/editor';
import ProjectCard, {
  NewProjectCard,
  ProjectCardSkeleton,
} from '@/components/home/ProjectCard';
import {
  GRID_SKELETON_COUNT,
  InfiniteScrollSection,
} from '@/components/home/InfiniteScroll';
import { FLOW_COLUMNS_CLASS } from '@/components/home/FlowScrollSection';

export { ProjectCardSkeleton };

function ImportSkeletonCard({ name }: { name: string }) {
  const { t } = useTranslation();
  return (
    <>
      <ProjectCardSkeleton
        seed="import"
        label={`${name || t('home.untitled')} — ${t('home.importing')}`}
      />
      <span className="sr-only">
        {name || t('home.untitled')} — {t('home.importing')}
      </span>
    </>
  );
}

/** Projects library default — same home flow as 资产 / 喜欢 / 灵感. */
const DEFAULT_PROJECTS_GRID = FLOW_COLUMNS_CLASS;

/**
 * Projects grid (侧栏「项目」). Data = GET /projects only.
 */
function TemplateGrid({
  templates,
  title,
  fileCountLabel,
  importing = false,
  importingName = '',
  loading = false,
  loadingMore = false,
  hasMore = false,
  onLoadMore,
  onCreate,
  createDisabled = false,
  gridClassName = DEFAULT_PROJECTS_GRID,
  orgOptions = [],
}: {
  templates: any[];
  title: string;
  fileCountLabel: string;
  importing?: boolean;
  importingName?: string;
  /** Cloud hydrate / first paint */
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onCreate?: () => void;
  createDisabled?: boolean;
  /** Per-page grid; do not reuse other modules' breakpoints. */
  gridClassName?: string;
  orgOptions?: { id: string; name: string }[];
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const currentId = useSelector((s: any) => s.editor?.currentId as string | null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [renameTarget, setRenameTarget] = useState<any | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const runDelete = useProjectDeleteRunner();

  const handleLoadMore = onLoadMore ?? (() => undefined);

  useEffect(() => {
    const ids = new Set(templates.map((item) => item.id));
    setSelected((prev) => prev.filter((id) => ids.has(id)));
  }, [templates]);

  useEffect(() => {
    if (selectMode && templates.length === 0) {
      setSelectMode(false);
      setSelected([]);
    }
  }, [templates.length, selectMode]);

  useEffect(() => {
    if (renameTarget) setRenameDraft(renameTarget.name || '');
  }, [renameTarget]);

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected([]);
  };

  const allSelected = templates.length > 0 && selected.length === templates.length;

  const selectAll = () => {
    if (allSelected) setSelected([]);
    else setSelected(templates.map((item) => item.id));
  };

  const batchDelete = () => {
    const ids = [...selected];
    const count = ids.length;
    void runDelete({
      ids,
      deleting,
      setDeleting,
      t,
      onSuccess: () => {
        dispatch(deleteTemplates(ids));
        invalidateProjectsListCache();
        message.destructive(t('home.batchDeleted', { count }));
        exitSelectMode();
        setBatchDeleteOpen(false);
      },
    });
  };

  const confirmSingleDelete = () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    void runDelete({
      ids: [id],
      deleting,
      setDeleting,
      t,
      onSuccess: () => {
        dispatch(deleteTemplate(id));
        invalidateProjectsListCache();
        setSelected((prev) => prev.filter((x) => x !== id));
        message.destructive(t('common.delete'));
        setDeleteTarget(null);
      },
    });
  };

  const closeRename = () => setRenameTarget(null);

  const commitRenameFor = (item: { id?: string }, name: string) => {
    const next = name.trim() || t('home.untitled');
    const id = String(item.id || '');
    if (!id) return;
    dispatch(renameTemplateById({ id, name: next }));
    // Open editor will flush via dirty; otherwise push name to cloud now.
    async function pushRename() {
      try {
        if (currentId === id) {
          requestProjectFlush();
        } else {
          await renameProjectOnCloud(id, next);
        }
      } finally {
        invalidateProjectsListCache();
      }
    }
    pushRename();
  };

  const commitRename = () => {
    if (!renameTarget) return;
    commitRenameFor(renameTarget, renameDraft);
    closeRename();
  };

  return (
    <div className="w-full min-w-0">
      <div className="mb-2.5 flex min-h-7 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[24px] font-bold text-[var(--ink)]">{title}</h2>
          <button
            type="button"
            title={selectMode ? t('home.cancelSelect') : t('home.batchSelect')}
            aria-pressed={selectMode}
            disabled={!templates.length && !selectMode}
            onClick={(e) => {
              if (selectMode) {
                exitSelectMode();
                e.currentTarget.blur();
                return;
              }
              // Empty list: never enter select mode (avoids toolbar flash).
              if (!templates.length) return;
              setSelectMode(true);
            }}
            className={cn(
              'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--line)]',
              selectMode
                ? 'bg-[var(--accent-soft)] text-[var(--ink)]'
                : 'bg-transparent text-[var(--muted)] [@media(hover:hover)]:hover:bg-[var(--accent-soft)] [@media(hover:hover)]:hover:text-[var(--ink)]',
              !templates.length &&
                !selectMode &&
                'cursor-not-allowed opacity-40 [@media(hover:hover)]:hover:bg-transparent'
            )}
          >
            <HiOutlineListBullet className="h-5 w-5" />
          </button>
          {selectMode && selected.length > 0 ? (
            <span className="shrink-0 text-[12px] text-[var(--muted)] lg:hidden">
              {t('home.selectedCount', { count: selected.length })}
            </span>
          ) : null}
        </div>

        <div className="flex min-w-0 shrink-0 items-center justify-end gap-2">
          {selectMode && templates.length > 0 ? (
            <BatchSelectControls
              className="hidden lg:inline-flex"
              total={templates.length}
              selectedCount={selected.length}
              allSelected={allSelected}
              deleting={deleting}
              onToggleSelectAll={selectAll}
              onClearSelection={() => setSelected([])}
              onDelete={() => {
                if (!selected.length) return;
                setBatchDeleteOpen(true);
              }}
              onCancel={exitSelectMode}
            />
          ) : (
            <span className="whitespace-nowrap text-[12px] tracking-normal text-[var(--muted)]">
              {fileCountLabel}
            </span>
          )}
          {selectMode && templates.length > 0 ? (
            <span className="whitespace-nowrap text-[12px] tracking-normal text-[var(--muted)] lg:hidden">
              {fileCountLabel}
            </span>
          ) : null}
        </div>
      </div>

      <InfiniteScrollSection
        loading={loading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        onLoadMore={handleLoadMore}
        gridClassName={gridClassName}
        skeleton={
          <>
            {onCreate ? (
              <NewProjectCard disabled={createDisabled} onClick={onCreate} />
            ) : null}
            {Array.from({ length: GRID_SKELETON_COUNT }, (_, i) => (
              <ProjectCardSkeleton key={`sk-${i}`} seed={i} />
            ))}
          </>
        }
      >
        {onCreate ? (
          <NewProjectCard disabled={createDisabled} onClick={onCreate} />
        ) : null}
        {importing ? <ImportSkeletonCard name={importingName} /> : null}
        {templates.map((item) => (
          <ProjectCard
            key={item.id}
            item={item}
            selected={selected.includes(item.id)}
            selectMode={selectMode}
            orgOptions={orgOptions}
            onToggle={() => toggle(item.id)}
            onRename={() => setRenameTarget(item)}
            onCommitRename={(name) => commitRenameFor(item, name)}
            onSetOrg={async (orgId) => {
              try {
                await setProjectOrgApi(item.id, orgId);
                invalidateProjectsListCache();
                message.success(
                  orgId ? t('home.orgMoved') : t('home.orgDetached')
                );
              } catch {
                message.error(t('home.orgMoveFailed'));
              }
            }}
            onDelete={() => setDeleteTarget(item)}
          />
        ))}
      </InfiniteScrollSection>

      <Dialog
        show={Boolean(renameTarget)}
        onClose={closeRename}
        width={400}
        title={t('home.rename')}
        titleClassName="!text-[16px] !font-semibold !pb-2"
        className="!bg-[var(--surface)] !p-5"
        footer={
          <>
            <Button size="small" type="default" onClick={closeRename}>
              {t('common.cancel')}
            </Button>
            <Button size="small" type="primary" onClick={commitRename}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <Input
          size="middle"
          type="filled"
          autoFocus
          value={renameDraft}
          placeholder={t('home.renamePlaceholder')}
          onChange={(e) => setRenameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') closeRename();
          }}
          className="!rounded-md"
        />
      </Dialog>

      <Dialog
        show={Boolean(deleteTarget)}
        onClose={() => {
          if (deleting) return;
          setDeleteTarget(null);
        }}
        width={400}
        title={t('home.deleteProjectConfirmTitle')}
        titleClassName="!text-[16px] !font-semibold !pb-2"
        className="!bg-[var(--surface)] !p-5"
        footer={
          <>
            <Button
              size="small"
              type="default"
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              size="small"
              type="primary"
              destructive
              loading={deleting}
              onClick={() => void confirmSingleDelete()}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          {t('home.deleteProjectConfirmBody', {
            name: deleteTarget?.name?.trim() || t('home.untitled'),
          })}
        </p>
      </Dialog>

      <Dialog
        show={batchDeleteOpen}
        onClose={() => {
          if (deleting) return;
          setBatchDeleteOpen(false);
        }}
        width={400}
        title={t('home.batchDeleteConfirmTitle')}
        titleClassName="!text-[16px] !font-semibold !pb-2"
        className="!bg-[var(--surface)] !p-5"
        footer={
          <>
            <Button
              size="small"
              type="default"
              disabled={deleting}
              onClick={() => setBatchDeleteOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              size="small"
              type="primary"
              destructive
              loading={deleting}
              onClick={() => void batchDelete()}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          {t('home.batchDeleteConfirmBody', { count: selected.length })}
        </p>
      </Dialog>

      {selectMode && templates.length > 0 ? (
        <>
          <div className="h-16 lg:hidden" aria-hidden />
          <BatchSelectBottomBar
            total={templates.length}
            selectedCount={selected.length}
            allSelected={allSelected}
            deleting={deleting}
            onToggleSelectAll={selectAll}
            onClearSelection={() => setSelected([])}
            onDelete={() => {
              if (!selected.length) return;
              setBatchDeleteOpen(true);
            }}
            onCancel={exitSelectMode}
          />
        </>
      ) : null}
    </div>
  );
}

export default memo(TemplateGrid);
