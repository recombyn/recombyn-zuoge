import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, memo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineEllipsisHorizontal,
  HiOutlinePencilSquare,
  HiOutlinePlus,
  HiOutlineTrash,
} from 'react-icons/hi2';
import { Dropdown, Tooltip, Button, Dialog, message } from '@/components/base';
import type { MenuItemType } from '@/components/base/dropdown/MenuItem';
import {
  removeProjectFromCloud,
  renameProjectOnCloud,
  requestProjectFlush,
} from '@/components/editor/useProjectCloudSync';
import { deleteTemplate, renameTemplateById } from '@/store/modules/editor';
import {
  invalidateProjectsListCache,
  patchProjectNameInListCache,
} from '@/service/projects';
import { cn } from '@/utils/classnames';

const RAIL_INSET_X = 'px-2.5';
const SIDEBAR_PROJECT_LIMIT = 15;

export type RailRecentProject = {
  id: string;
  name: string;
  openedAt: number;
  updatedAt: number;
};

function sortRecent(projects: RailRecentProject[]): RailRecentProject[] {
  return [...projects]
    .sort(
      (a, b) =>
        (Number(b.openedAt) || Number(b.updatedAt) || 0) -
        (Number(a.openedAt) || Number(a.updatedAt) || 0)
    )
    .slice(0, SIDEBAR_PROJECT_LIMIT);
}

type Props = {
  expanded: boolean;
  projects: RailRecentProject[];
  loading?: boolean;
  onOpenProject: (id: string) => void;
  onCreate: () => void;
  onProjectDeleted?: () => void;
};

/** Sidebar recent projects — click opens canvas. */
function RailRecentList({
  expanded,
  projects,
  loading,
  onOpenProject,
  onCreate,
  onProjectDeleted,
}: Props): ReactNode {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const currentId = useSelector((s: any) => s.editor?.currentId as string | null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<RailRecentProject | null>(null);
  const [deleting, setDeleting] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const cancelingEditRef = useRef(false);

  const recent = useMemo(() => sortRecent(projects), [projects]);

  useEffect(() => {
    if (!editingId) return;
    const el = editInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editingId]);

  const commitRenameFor = useCallback(
    (item: RailRecentProject, name: string) => {
      const next = name.trim() || t('home.untitled');
      const id = String(item.id || '');
      if (!id) return;
      dispatch(renameTemplateById({ id, name: next, skipUpdatedAt: true }));
      async function pushRename() {
        try {
          if (currentId === id) {
            requestProjectFlush();
          } else {
            await renameProjectOnCloud(id, next);
          }
        } finally {
          patchProjectNameInListCache(id, next);
        }
      }
      void pushRename();
    },
    [currentId, dispatch, t]
  );

  const startEdit = useCallback(
    (item: RailRecentProject) => {
      setEditingId(String(item.id));
      setEditDraft(item.name || t('home.untitled'));
    },
    [t]
  );

  const finishEdit = useCallback(
    (item: RailRecentProject) => {
      if (editingId !== String(item.id)) return;
      commitRenameFor(item, editDraft);
      setEditingId(null);
    },
    [commitRenameFor, editDraft, editingId]
  );

  const cancelEdit = useCallback(() => {
    cancelingEditRef.current = true;
    setEditingId(null);
  }, []);

  const commitDelete = useCallback(
    async (item: RailRecentProject) => {
      const id = String(item.id || '');
      if (!id) return;
      try {
        await removeProjectFromCloud(id);
        dispatch(deleteTemplate(id));
        invalidateProjectsListCache();
        onProjectDeleted?.();
        message.destructive(t('common.delete'));
      } catch {
        message.error(t('home.batchDeleteFailed'));
      }
    },
    [dispatch, onProjectDeleted, t]
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await commitDelete(deleteTarget);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }, [commitDelete, deleteTarget, deleting]);

  if (!expanded) return null;

  const menuItems: MenuItemType[] = [
    {
      key: 'rename',
      label: (
        <span className="inline-flex items-center gap-2">
          <HiOutlinePencilSquare className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t('home.rename')}
        </span>
      ),
    },
    {
      key: 'delete',
      label: (
        <span className="inline-flex items-center gap-2 text-red-500">
          <HiOutlineTrash className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t('common.delete')}
        </span>
      ),
    },
  ];

  return (
    <div className="mt-4 shrink-0">
      <div className={cn('group mb-1 flex h-8 items-center', RAIL_INSET_X)}>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--muted)]">
          {t('home.recent')}
        </span>
        <Tooltip tip={t('home.newProject')} placement="top" offset={6}>
          <button
            type="button"
            aria-label={t('home.newProject')}
            onClick={onCreate}
            className={cn(
              'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition',
              'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              'hover:bg-[color-mix(in_srgb,var(--ink)_5%,var(--rail))] hover:text-[var(--ink)]'
            )}
          >
            <HiOutlinePlus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          </button>
        </Tooltip>
      </div>
      <div>
        {loading ? (
          <div className="space-y-0.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={cn('py-2.5', RAIL_INSET_X)}>
                <span className="block h-4 animate-pulse rounded bg-[color-mix(in_srgb,var(--ink)_5%,var(--rail))]" />
              </div>
            ))}
          </div>
        ) : recent.length === 0 ? (
          <p className={cn('py-2.5 text-[12px] font-normal text-[var(--muted)]', RAIL_INSET_X)}>
            {t('home.recentEmpty')}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {recent.map((p) => (
              <li key={p.id} className="group">
                <div
                  role={editingId === p.id ? undefined : 'button'}
                  tabIndex={editingId === p.id ? undefined : 0}
                  onClick={() => {
                    if (editingId === p.id) return;
                    onOpenProject(p.id);
                  }}
                  onKeyDown={(e) => {
                    if (editingId === p.id) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenProject(p.id);
                    }
                  }}
                  className={cn(
                    'flex cursor-pointer items-center rounded-[10px] py-2.5 transition hover:bg-[color-mix(in_srgb,var(--ink)_5%,var(--rail))]',
                    RAIL_INSET_X
                  )}
                >
                  <div
                    className="min-w-0 flex-1"
                    onClick={(e) => editingId === p.id && e.stopPropagation()}
                  >
                    {editingId === p.id ? (
                      <input
                        ref={editInputRef}
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => {
                          if (cancelingEditRef.current) {
                            cancelingEditRef.current = false;
                            return;
                          }
                          finishEdit(p);
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            finishEdit(p);
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            cancelEdit();
                          }
                        }}
                        className="w-full min-w-0 truncate border-0 bg-transparent px-0 text-left text-[13px] font-medium leading-none tracking-tight text-[var(--ink)] outline-none focus:outline-none focus:ring-0"
                        aria-label={t('home.rename')}
                      />
                    ) : (
                      <span className="block w-full min-w-0 truncate text-left text-[13px] font-medium leading-none tracking-tight text-[var(--ink)]/80 transition group-hover:text-[var(--ink)]">
                        {p.name || t('home.untitled')}
                      </span>
                    )}
                  </div>
                  <div
                    className="shrink-0 pl-1"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <Dropdown
                      trigger="click"
                      placement="bottom-end"
                      offset={4}
                      items={menuItems}
                      onClick={(key) => {
                        if (key === 'rename') startEdit(p);
                        if (key === 'delete') setDeleteTarget(p);
                      }}
                      floatingClassName="z-[600]"
                      popupClassName="min-w-[9.5rem] rounded-xl !bg-[var(--surface)] p-1.5 shadow-[0_8px_28px_rgba(15,23,42,0.14)] ring-1 ring-[var(--line)]"
                    >
                      <button
                        type="button"
                        aria-label={t('common.more')}
                        className={cn(
                          'flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted)] transition',
                          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                          'hover:bg-[color-mix(in_srgb,var(--ink)_6%,var(--rail))] hover:text-[var(--ink)]'
                        )}
                      >
                        <HiOutlineEllipsisHorizontal className="h-4 w-4" aria-hidden />
                      </button>
                    </Dropdown>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

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
              disabled={deleting}
              onClick={() => void confirmDelete()}
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
    </div>
  );
}

export default memo(RailRecentList);
