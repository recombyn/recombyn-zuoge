import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, memo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { parseAsString, parseAsStringLiteral, useQueryState } from 'nuqs';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineBolt,
  HiOutlineChevronRight,
  HiOutlineEllipsisHorizontal,
  HiOutlineLifebuoy,
  HiOutlinePencilSquare,
  HiOutlinePlus,
  HiOutlineSparkles,
  HiOutlineTrash,
} from 'react-icons/hi2';
import { LuPanelLeftClose, LuPanelLeftOpen } from 'react-icons/lu';
import { Dropdown, Tooltip, Button, Dialog, message } from '@/components/base';
import type { MenuItemType } from '@/components/base/dropdown/MenuItem';
import AppLogo from '@/components/base/AppLogo';
import { Icon } from '@/components/base/icon';
import PlansDialog from '@/components/layout/PlansDialog';
import UserAccountPanel, { UserAvatar } from '@/components/layout/UserAccountPanel';
import HomeHero from '@/components/home/HomeHero';
import InspirationSection from '@/components/home/InspirationSection';
import SkillsLibraryPanel from '@/components/home/SkillsLibraryPanel';
import { HOME_MAIN_SHELL, HOME_MAIN_SCROLL, HOME_PROJECT_GRID } from '@/components/home/homeLayout';
import type { HomeAgentSubmitPayload } from '@/components/home/HomeAgentComposer';
import type { OfficialCaseMeta } from '@/utils/officialCases';
import TemplateGrid from '@/components/templates/TemplateGrid';
import {
  flushCurrentProjectNow,
  removeProjectFromCloud,
  renameProjectOnCloud,
  requestProjectFlush,
} from '@/components/editor/useProjectCloudSync';
import { clearProjectsLibrary, deleteTemplate, renameTemplateById } from '@/store/modules/editor';
import { apiQuery } from '@/service/client';
import {
  clearProjectsListCache,
  invalidateProjectsListCache,
  patchProjectNameInListCache,
  type PaginatedProjects,
  type ProjectSummaryDto,
} from '@/service/projects';
import { normalizeProjectThumbnailUrls, collageOrSingleThumb } from '@/utils/projectThumb';
import { getToken } from '@/utils/token';
import { buildLoginUrl } from '@/utils/authReturnTo';
import { useGoEditor } from '@/utils/goEditor';
import { useBillingEnabled, useWalletSnapshot } from '@/service/wallet';
import { formatCredits, planLabelKey } from '@/utils/wallet';
import { useIsDesktopShell } from '@/components/layout/DesktopTitlebar';
import {
  homeRailWidthPx,
  useHomeRailExpanded,
} from '@/components/layout/useHomeRailExpanded';
import {
  railHelpItemKeys,
  runRailHelpAction,
  type RailHelpItemKey,
} from '@/components/layout/railHelp';
import { isDesktopLocal } from '@/utils/apiBase';
import { cn } from '@/utils/classnames';
import {
  HOME_NAV_KEYS,
  homeLoginReturnPath,
  parseHomeNavParam,
  runHomeGoNav,
  type HomeNavKey,
} from '@/components/layout/homeNav';

const PROJECT_PAGE_SIZE = 15;

const homeNavParser = parseAsStringLiteral(HOME_NAV_KEYS)
  .withDefault('home')
  .withOptions({ history: 'replace', clearOnDefault: true });

const homeQueryParser = parseAsString
  .withDefault('')
  .withOptions({ history: 'replace', clearOnDefault: true, throttleMs: 200 });

/** List card shape for Home recent / Mine grid — mapped from Query, not Redux. */
type ProjectListItem = {
  id: string;
  name: string;
  thumbnail: string | string[] | null;
  thumbnailCustom?: boolean;
  createdAt: number;
  updatedAt: number;
  openedAt: number;
  source: 'user';
  remoteOnly: boolean;
  orgId?: string | null;
  orgName?: string | null;
};

function projectSummaryToListItem(row: ProjectSummaryDto): ProjectListItem {
  const thumbs = normalizeProjectThumbnailUrls(row.thumbnailUrl, row.updatedAt);
  return {
    id: row.id,
    name: row.name || 'Untitled',
    thumbnail: collageOrSingleThumb(thumbs),
    thumbnailCustom: Boolean(row.thumbnailCustom),
    createdAt: row.createdAt || row.updatedAt || Date.now(),
    updatedAt: row.updatedAt || row.createdAt || Date.now(),
    openedAt: row.updatedAt || row.createdAt || Date.now(),
    source: 'user',
    remoteOnly: Boolean(row.hasDocument),
    orgId: row.orgId ?? null,
    orgName: row.orgName ?? null,
  };
}

function mergeProjectPages(pages: unknown[] | undefined): {
  items: ProjectListItem[];
  total: number;
} {
  if (!pages?.length) return { items: [], total: 0 };
  const items: ProjectListItem[] = [];
  let total = 0;
  for (const raw of pages) {
    const page = raw as PaginatedProjects;
    for (const row of page.projects || []) {
      if (row?.id) items.push(projectSummaryToListItem(row));
    }
    if (Number.isFinite(Number(page.total))) total = Number(page.total);
  }
  return { items, total: total || items.length };
}

const SIDEBAR_PROJECT_LIMIT = 15;

function sortRecentSidebarProjects(projects: ProjectListItem[]): ProjectListItem[] {
  return [...projects]
    .sort(
      (a, b) =>
        (Number(b.openedAt) || Number(b.updatedAt) || 0) -
        (Number(a.openedAt) || Number(a.updatedAt) || 0)
    )
    .slice(0, SIDEBAR_PROJECT_LIMIT);
}

function useHomeProjectsList(enabled: boolean, filterOrgId = '') {
  const projectsQuery = useInfiniteQuery({
    ...apiQuery.projectsListMyProjects.infiniteOptions({
      input: (pageParam: number) => ({
        query: {
          page: pageParam,
          pageSize: PROJECT_PAGE_SIZE,
          ...(filterOrgId ? { orgId: filterOrgId } : {}),
        },
      }),
      initialPageParam: 1,
      getNextPageParam: (last: unknown) => {
        const page = last as PaginatedProjects;
        return page?.hasMore ? (page.page || 0) + 1 : undefined;
      },
    }),
    enabled,
  });

  const { items, total } = useMemo(() => {
    if (projectsQuery.isError) return { items: [] as ProjectListItem[], total: 0 };
    return mergeProjectPages(projectsQuery.data?.pages as unknown[] | undefined);
  }, [projectsQuery.data?.pages, projectsQuery.isError]);

  const ready =
    !enabled ||
    projectsQuery.isError ||
    Boolean(projectsQuery.data) ||
    !projectsQuery.isPending;

  return {
    items,
    total,
    ready,
    refetch: projectsQuery.refetch,
    isStale: projectsQuery.isStale,
    data: projectsQuery.data,
    hasMore: Boolean(projectsQuery.hasNextPage),
    loadingMore: projectsQuery.isFetchingNextPage,
    fetchNextPage: projectsQuery.fetchNextPage,
  };
}

type Props = {
  nav: string;
  setNav: (id: string) => void;
  query: string;
  importing?: boolean;
  importingName?: string;
  onCreate: () => void;
  onAgentSubmit: (payload: HomeAgentSubmitPayload) => void;
  onOpenCase: (meta: OfficialCaseMeta) => void;
};

const RAIL_NAV_HIT = 'h-10 w-10 rounded-xl';
/** Shared expanded-rail row geometry — nav + recent projects share one icon/text grid. */
const RAIL_INSET_X = 'px-2.5';
const RAIL_ROW_GAP = 'gap-3';
const RAIL_ICON_SLOT = 'flex h-5 w-[21px] shrink-0 items-center justify-center';
const railSidePadding = (expanded: boolean) => (expanded ? 'px-2.5' : 'px-2');

const RAIL_NAV_ICONS = {
  home: 'home-rail-compose',
  inspiration: 'home-rail-inspire',
  mine: 'home-rail-projects',
  skills: 'home-rail-skills',
} as const;

type RailNavId = keyof typeof RAIL_NAV_ICONS;

const RAIL_NAV_ITEMS: { id: RailNavId; labelKey: string }[] = [
  { id: 'home', labelKey: 'home.navHome' },
  { id: 'inspiration', labelKey: 'home.railInspiration' },
  { id: 'mine', labelKey: 'home.mine' },
  { id: 'skills', labelKey: 'home.railSkills' },
];

/** Per-nav glyph size — tuned per icon artwork. */
const RAIL_ICON_SIZES: Record<RailNavId, string> = {
  home: 'h-[20px] w-[20px]',
  inspiration: 'h-[21px] w-[21px]',
  mine: 'h-[19px] w-[19px]',
  skills: 'h-[19px] w-[19px]',
};

const RAIL_HELP_LABEL_KEYS: Record<RailHelpItemKey, string> = {
  guide: 'home.railHelpGuide',
  contact: 'home.railHelpContact',
  updates: 'home.railHelpUpdates',
};

const HOME_MAIN_INSET = HOME_MAIN_SHELL;

function railHelpItemLabel(t: (key: string) => string, key: RailHelpItemKey) {
  return t(RAIL_HELP_LABEL_KEYS[key]);
}

function railItemTone(active: boolean) {
  return active
    ? 'bg-[color-mix(in_srgb,var(--ink)_8%,var(--rail))] text-[var(--ink)]'
    : 'text-[var(--ink)]/70 hover:bg-[color-mix(in_srgb,var(--ink)_5%,var(--rail))] hover:text-[var(--ink)]';
}

/** Guest footer — help + login in one panel (expanded sidebar only). */
function RailGuestFooterPanel({ onLogin }: { onLogin: () => void }) {
  const { t } = useTranslation();
  const desktopLocal = isDesktopLocal();
  const [helpOpen, setHelpOpen] = useState(false);
  const helpKeys = railHelpItemKeys(desktopLocal);

  return (
    <div className="overflow-hidden rounded-xl bg-[var(--surface)] ring-1 ring-[var(--line)]">
      <button
        type="button"
        onClick={() => setHelpOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-2.5 py-2.5 text-left text-[13px] text-[var(--ink)] transition hover:bg-[var(--accent-soft)]"
      >
        <HiOutlineLifebuoy className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{t('home.railHelp')}</span>
        <HiOutlineChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-[var(--muted)] transition-transform',
            helpOpen && 'rotate-90'
          )}
          aria-hidden
        />
      </button>
      {helpOpen ? (
        <div className="border-t border-[var(--line)] px-1.5 py-1">
          {helpKeys.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => runRailHelpAction(key)}
              className="flex w-full items-center rounded-lg px-2 py-2 text-left text-[12px] text-[var(--ink)]/85 transition hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
            >
              {railHelpItemLabel(t, key)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="border-t border-[var(--line)] p-1.5">
        <button
          type="button"
          onClick={onLogin}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] font-medium text-[var(--ink)] transition hover:bg-[var(--accent-soft)]"
        >
          <UserAvatar size={28} name={null} email={null} avatar={null} />
          <span className="truncate">{t('home.login')}</span>
        </button>
      </div>
    </div>
  );
}

function RailNavIcon({ id }: { id: keyof typeof RAIL_NAV_ICONS }) {
  const size = RAIL_ICON_SIZES[id];
  return (
    <span className={RAIL_ICON_SLOT}>
      <Icon name={RAIL_NAV_ICONS[id]} className={size} />
    </span>
  );
}

function RailItem({
  label,
  active,
  disabled,
  onClick,
  icon,
  expanded,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  icon: ReactNode;
  expanded: boolean;
}) {
  const button = (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'group flex shrink-0 items-center transition-colors disabled:opacity-50',
        expanded ? cn('h-10 w-full rounded-[10px]', RAIL_INSET_X, RAIL_ROW_GAP) : cn('mx-auto justify-center', RAIL_NAV_HIT),
        railItemTone(Boolean(active))
      )}
    >
      {icon}
      {expanded ? (
        <span className="min-w-0 truncate text-[13px] font-medium leading-none tracking-tight">
          {label}
        </span>
      ) : null}
    </button>
  );

  if (expanded) return button;
  return (
    <Tooltip tip={label} placement="right" offset={10} triggerClassName="inline-flex justify-center">
      {button}
    </Tooltip>
  );
}

/** Collapsed: logo → hover reveals expand icon (fig.2). Expanded: brand + collapse (fig.1). */
function RailBrandHeader({
  expanded,
  onExpand,
  onCollapse,
}: {
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const { t } = useTranslation();

  if (expanded) {
    return (
      <div
        className={cn(
          'mb-3 flex h-10 w-full shrink-0 items-center',
          RAIL_INSET_X,
          RAIL_ROW_GAP
        )}
      >
        <span className={RAIL_ICON_SLOT}>
          <AppLogo size={20} />
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-none tracking-tight text-[var(--ink)] [font-family:var(--font-hero)]"
          aria-hidden
        >
          {t('app.name')}
        </span>
        <Tooltip tip={t('home.railCollapse')} placement="bottom" offset={6}>
          <button
            type="button"
            aria-label={t('home.railCollapse')}
            onClick={onCollapse}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--ink)]/55 transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_4%,var(--rail))] hover:text-[var(--ink)]"
          >
            <LuPanelLeftClose className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="mb-3 flex shrink-0 justify-center">
      <Tooltip
        tip={t('home.railExpand')}
        placement="right"
        offset={10}
        triggerClassName="inline-flex justify-center"
      >
        <button
          type="button"
          aria-label={t('home.railExpand')}
          onClick={onExpand}
          className="group relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_4%,var(--rail))]"
        >
          <span className="flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
            <AppLogo size={26} />
          </span>
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[var(--ink)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <LuPanelLeftOpen className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
          </span>
        </button>
      </Tooltip>
    </div>
  );
}

function RailProjectsList({
  expanded,
  projects,
  loading,
  onOpenProject,
  onCreate,
}: {
  expanded: boolean;
  projects: ProjectListItem[];
  loading?: boolean;
  onOpenProject: (id: string) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const currentId = useSelector((s: any) => s.editor?.currentId as string | null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ProjectListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const cancelingEditRef = useRef(false);

  const recent = useMemo(() => sortRecentSidebarProjects(projects), [projects]);

  useEffect(() => {
    if (!editingId) return;
    const el = editInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editingId]);

  const commitRenameFor = useCallback(
    (item: ProjectListItem, name: string) => {
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
    (item: ProjectListItem) => {
      setEditingId(String(item.id));
      setEditDraft(item.name || t('home.untitled'));
    },
    [t]
  );

  const finishEdit = useCallback(
    (item: ProjectListItem) => {
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
    async (item: ProjectListItem) => {
      const id = String(item.id || '');
      if (!id) return;
      try {
        await removeProjectFromCloud(id);
        dispatch(deleteTemplate(id));
        invalidateProjectsListCache();
        refreshHomeProjectsList();
        message.destructive(t('common.delete'));
      } catch {
        message.error(t('home.batchDeleteFailed'));
      }
    },
    [dispatch, t]
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
              <div key={i} className={cn('py-1.5', RAIL_INSET_X)}>
                <span className="block h-4 animate-pulse rounded bg-[color-mix(in_srgb,var(--ink)_5%,var(--rail))]" />
              </div>
            ))}
          </div>
        ) : recent.length === 0 ? (
          <p className={cn('py-1.5 text-[12px] font-normal text-[var(--muted)]', RAIL_INSET_X)}>
            {t('home.recentEmpty')}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {recent.map((p) => (
              <li key={p.id} className="group">
                <div
                  className={cn(
                    'flex items-center rounded-[10px] py-1.5 transition hover:bg-[color-mix(in_srgb,var(--ink)_5%,var(--rail))]',
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
                      <button
                        type="button"
                        onClick={() => onOpenProject(p.id)}
                        className="w-full min-w-0 truncate text-left text-[13px] font-medium leading-none tracking-tight text-[var(--ink)]/80 transition group-hover:text-[var(--ink)]"
                      >
                        {p.name || t('home.untitled')}
                      </button>
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

function RailCreditsBlock({
  expanded,
  planLabel,
  credits,
  onOpenPlans,
  t,
}: {
  expanded: boolean;
  planLabel: string;
  credits: number;
  onOpenPlans: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  if (expanded) {
    return (
      <div className="rounded-xl bg-[var(--surface)] p-2.5 ring-1 ring-[var(--line)]">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--ink)]">
            {planLabel}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-[12px] tabular-nums text-[var(--muted)]">
            <HiOutlineBolt className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {formatCredits(credits)}
          </span>
        </div>
        <button
          type="button"
          onClick={onOpenPlans}
          className="mt-2.5 flex w-full items-center justify-center rounded-xl bg-[var(--ink)] px-3 py-2 text-[12px] font-semibold text-[var(--on-brand)] transition hover:opacity-90"
        >
          {t('wallet.upgrade')}
        </button>
      </div>
    );
  }

  return (
    <Tooltip
      tip={`${planLabel} · ${t('wallet.creditsLeft', { count: formatCredits(credits) })}`}
      placement="right"
      offset={10}
    >
      <button
        type="button"
        onClick={onOpenPlans}
        className="flex h-[52px] w-[52px] flex-col items-center justify-center gap-0.5 rounded-xl bg-[var(--surface)] ring-1 ring-[var(--line)] transition hover:bg-[var(--accent-soft)]"
      >
        <HiOutlineSparkles className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden />
        <span className="max-w-full truncate px-1 text-[11px] font-semibold tabular-nums leading-none text-[var(--ink)]">
          {formatCredits(credits)}
        </span>
      </button>
    </Tooltip>
  );
}

function RailSidebarFooter({ expanded }: { expanded: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useSelector((state: any) => state.auth?.user);
  const authed = Boolean(user && getToken());
  const { credits, planId } = useWalletSnapshot();
  const billingEnabled = useBillingEnabled();
  const hideBillingUi = isDesktopLocal() || !billingEnabled;
  const [accountOpen, setAccountOpen] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);
  const planLabel = t(planLabelKey(planId));

  if (!authed) {
    if (expanded) {
      return <RailGuestFooterPanel onLogin={() => navigate(buildLoginUrl())} />;
    }
    const guestBtn = (
      <button
        type="button"
        onClick={() => navigate(buildLoginUrl())}
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl text-[var(--ink)]/70 transition hover:bg-[color-mix(in_srgb,var(--ink)_3%,var(--rail))] hover:text-[var(--ink)]"
      >
        <UserAvatar size={28} name={null} email={null} avatar={null} />
      </button>
    );
    return (
      <Tooltip tip={t('home.login')} placement="right" offset={10}>
        {guestBtn}
      </Tooltip>
    );
  }

  const creditsBlock = hideBillingUi ? null : (
    <RailCreditsBlock
      expanded={expanded}
      planLabel={planLabel}
      credits={credits}
      onOpenPlans={() => setPlansOpen(true)}
      t={t}
    />
  );

  const profileBtn = (
    <button
      type="button"
      className={cn(
        'flex min-w-0 items-center rounded-xl transition hover:bg-[color-mix(in_srgb,var(--ink)_3%,var(--rail))]',
        expanded ? 'h-11 w-full gap-2.5 px-2 py-1.5' : 'mx-auto h-10 w-10 justify-center'
      )}
    >
      <UserAvatar name={user.name} email={user.email} avatar={user.avatar} size={28} />
      {expanded ? (
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[13px] font-semibold leading-tight text-[var(--ink)]">
            {user.name || user.email || t('home.account')}
          </span>
          {user.email ? (
            <span className="mt-0.5 block truncate text-[11px] leading-tight text-[var(--muted)]">
              {user.email}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );

  return (
    <div className={cn('flex w-full flex-col', expanded ? 'gap-2' : 'items-center gap-2')}>
      {creditsBlock}
      <UserAccountPanel open={accountOpen} onOpenChange={setAccountOpen}>
        {expanded ? profileBtn : (
          <Tooltip tip={user.name || user.email || t('home.account')} placement="right" offset={10}>
            {profileBtn}
          </Tooltip>
        )}
      </UserAccountPanel>
      <PlansDialog open={plansOpen} onClose={() => setPlansOpen(false)} />
    </div>
  );
}

/** Side rail / top bar → force-refetch project list (same file; avoid prop drilling). */
let openProjectsListHandler: (() => void) | null = null;
let remountSkillsHandler: (() => void) | null = null;

/** Re-fetch Home / Projects list (no session cache). */
export function refreshHomeProjectsList() {
  openProjectsListHandler?.();
}

/** Remount Skills so it refetches (no session cache). */
export function refreshHomeNavPanel() {
  remountSkillsHandler?.();
}

/** Side rail — Miora-style: brand, create, nav, projects, credits + user footer. */
function HomeSidebar({
  nav,
  setNav,
  onCreate,
}: {
  nav: string;
  setNav: (id: string) => void;
  importing?: boolean;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const goEditor = useGoEditor();
  const desktop = useIsDesktopShell();
  const [expanded, setExpanded] = useHomeRailExpanded();
  const railW = homeRailWidthPx(expanded);
  const userId = useSelector((state: any) => state.auth?.user?.id) as string | undefined;
  const authed = Boolean(userId && getToken());

  const projectsList = useHomeProjectsList(authed);
  const sidebarProjectsLoading = authed && !projectsList.ready;

  const goNav = (id: HomeNavKey) => {
    runHomeGoNav(id, {
      nav,
      authed,
      navigate,
      setNav,
      refreshProjects: openProjectsListHandler ?? undefined,
      refreshSkills: refreshHomeNavPanel,
    });
  };

  const openProject = (id: string) => {
    goEditor({ projectId: id });
  };

  return (
    <>
      {!desktop ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex h-20 items-start bg-gradient-to-b from-[var(--surface)] from-60% to-transparent pt-4 px-4 md:hidden">
          <div className="pointer-events-auto inline-flex min-w-0 items-center gap-2 leading-none">
            <AppLogo size={22} />
            <span
              className="-translate-y-px truncate text-[15px] font-medium leading-none tracking-tight text-[var(--ink)] [font-family:var(--font-hero)]"
              aria-hidden
            >
              {t('app.name')}
            </span>
          </div>
        </div>
      ) : null}

      <aside
        className="pointer-events-none absolute inset-y-0 left-0 z-30 hidden flex-col overflow-visible border-r border-[var(--line)] transition-[width] duration-200 ease-out md:flex"
        style={{ width: railW }}
        aria-label={t('app.name')}
        data-expanded={expanded ? 'true' : 'false'}
      >
        <div className="pointer-events-auto flex h-full flex-col overflow-hidden bg-[var(--rail)]">
          <div className="rail-sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div className={cn('sticky top-0 z-10 shrink-0 bg-[var(--rail)] pt-3', railSidePadding(expanded))}>
              <RailBrandHeader
                expanded={expanded}
                onExpand={() => setExpanded(true)}
                onCollapse={() => setExpanded(false)}
              />
            </div>

            <div className={cn('pb-2', railSidePadding(expanded))}>
              <nav
                className={cn(
                  'flex shrink-0 flex-col gap-0.5',
                  expanded ? 'items-stretch' : 'items-center'
                )}
                aria-label={t('app.name')}
              >
                {RAIL_NAV_ITEMS.map(({ id, labelKey }) => (
                  <RailItem
                    key={id}
                    expanded={expanded}
                    label={t(labelKey)}
                    active={nav === id}
                    onClick={() => goNav(id)}
                    icon={<RailNavIcon id={id} />}
                  />
                ))}
              </nav>

              {authed ? (
                <RailProjectsList
                  expanded={expanded}
                  projects={projectsList.items}
                  loading={sidebarProjectsLoading}
                  onOpenProject={openProject}
                  onCreate={onCreate}
                />
              ) : null}
            </div>
          </div>

          <div className={cn('shrink-0 pb-3 pt-2', railSidePadding(expanded))}>
            <RailSidebarFooter expanded={expanded} />
          </div>
        </div>
      </aside>
    </>
  );
}

function HomeTemplateList({
  nav,
  setNav,
  query,
  importing = false,
  importingName = '',
  onCreate,
  onAgentSubmit,
  onOpenCase,
}: Props) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const userId = useSelector((state: any) => state.auth?.user?.id) as string | undefined;
  // Token is in localStorage only — Redux has no auth.token field.
  const authed = Boolean(userId && getToken());
  const [skillsMountKey, setSkillsMountKey] = useState(0);
  /** Filter "我的项目" by team org (empty = all accessible). */
  const [filterOrgId, setFilterOrgId] = useState('');
  /** Tracks Home/Projects surface enter/leave so we don't double-fetch on cold mount. */
  const onProjectsSurfaceRef = useRef(false);
  const skippedInitialProjectsRefreshRef = useRef(false);

  /** Guest must not stay on Projects / Skills — bounce home + open login. */
  useEffect(() => {
    if (authed) return;
    if (nav !== 'mine' && nav !== 'skills') return;
    const returnTo = homeLoginReturnPath(parseHomeNavParam(nav));
    setNav('home');
    navigate(buildLoginUrl(returnTo));
  }, [authed, nav, navigate, setNav]);

  const showMine = nav === 'mine' && Boolean(authed);
  const showSkills = nav === 'skills' && Boolean(authed);
  const showInspiration = nav === 'inspiration';
  const showHome = nav === 'home';
  const projectsListEnabled = Boolean(authed && (showHome || showMine));

  const orgsQuery = useQuery({
    ...apiQuery.orgsListMyOrgs.queryOptions({
      enabled: Boolean(authed && (showMine || showHome)),
    }),
  });
  const orgOptions = (() => {
    const data = orgsQuery.data as { orgs?: { id: string; name: string }[] } | undefined;
    return Array.isArray(data?.orgs) ? data.orgs : [];
  })();

  // List SoT: Query pages — do not mirror the full library into Redux.
  const projectsList = useHomeProjectsList(projectsListEnabled, showMine ? filterOrgId : '');
  const refetchProjects = projectsList.refetch;
  const projectsHasMore = projectsList.hasMore;
  const projectsLoadingMore = projectsList.loadingMore;
  const projectListItems = projectsList.items;
  const projectsTotal = projectsList.total;
  const projectsReady = projectsList.ready;

  const refreshProjectsList = useCallback(async (opts?: { flush?: boolean }) => {
    if (!authed) return;
    if (opts?.flush !== false) {
      try {
        await flushCurrentProjectNow({ force: true });
      } catch {
        /* list anyway */
      }
    }
    await refetchProjects();
  }, [authed, refetchProjects]);

  /** Same-tab Home/Projects click — refresh only when the Query cache is stale. */
  const softRefreshProjectsList = useCallback(async () => {
    if (!authed) return;
    if (!projectsList.isStale && projectsList.data) return;
    await refetchProjects();
  }, [authed, projectsList.data, projectsList.isStale, refetchProjects]);

  useEffect(() => {
    openProjectsListHandler = () => {
      void softRefreshProjectsList();
    };
    remountSkillsHandler = () => setSkillsMountKey((k) => k + 1);
    return () => {
      if (openProjectsListHandler) openProjectsListHandler = null;
      remountSkillsHandler = null;
    };
  }, [softRefreshProjectsList]);

  useEffect(() => {
    if (!authed) {
      dispatch(clearProjectsLibrary());
      clearProjectsListCache();
      onProjectsSurfaceRef.current = false;
      skippedInitialProjectsRefreshRef.current = false;
      return;
    }
    const onSurface = showHome || showMine;
    if (!onSurface) {
      onProjectsSurfaceRef.current = false;
      return;
    }
    const entering = !onProjectsSurfaceRef.current;
    onProjectsSurfaceRef.current = true;
    // Stay on list surface (Home ↔ Projects): keep Query cache — no extra list GET.
    if (!entering) return;
    // Cold first enter: `useInfiniteQuery` `enabled` already fetches — skip effect refresh.
    if (!skippedInitialProjectsRefreshRef.current) {
      skippedInitialProjectsRefreshRef.current = true;
      return;
    }
    // Re-enter from Skills — force refresh (staleTime may still be warm).
    void refreshProjectsList({ flush: false });
    // Intentionally keyed by tab visibility.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshProjectsList stable via refetch
  }, [authed, dispatch, showHome, showMine]);

  const loadMoreProjects = useCallback(() => {
    if (!authed || !projectsHasMore || projectsLoadingMore || !projectsReady) return;
    projectsList.fetchNextPage();
  }, [
    authed,
    projectsHasMore,
    projectsLoadingMore,
    projectsList.fetchNextPage,
    projectsReady,
  ]);

  const listForGrid = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projectListItems;
    return projectListItems.filter((item) =>
      (item.name || '').toLowerCase().includes(q)
    );
  }, [projectListItems, query]);

  const mineTitle = t('home.mine');
  const mineSkeleton = Boolean(authed) && !projectsReady;
  const mineScrollLoad = !query.trim();
  const importBonus = importing ? 1 : 0;
  const mineDisplayCount = mineScrollLoad
    ? projectsTotal + importBonus
    : listForGrid.length + importBonus;

  return (
    <>
      {showSkills ? (
        <main className={HOME_MAIN_SCROLL}>
          <div className={HOME_MAIN_INSET}>
            <SkillsLibraryPanel key={skillsMountKey} />
          </div>
        </main>
      ) : null}

      {showMine ? (
        <main className={HOME_MAIN_SCROLL}>
          <div className={cn(HOME_MAIN_INSET, 'space-y-8')}>
            {orgOptions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[13px] text-[var(--muted)]" htmlFor="mine-org-filter">
                  {t('home.orgFilter')}
                </label>
                <select
                  id="mine-org-filter"
                  value={filterOrgId}
                  onChange={(e) => setFilterOrgId(e.target.value)}
                  className="h-9 rounded-lg border-0 bg-[var(--surface)] px-3 text-[13px] text-[var(--ink)] outline-none ring-1 ring-[var(--line)]"
                >
                  <option value="">{t('home.orgFilterAll')}</option>
                  {orgOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <TemplateGrid
              templates={mineSkeleton ? [] : listForGrid}
              title={mineTitle}
              fileCountLabel={
                mineSkeleton
                  ? t('home.fileCount', { count: 0 })
                  : t('home.fileCount', { count: mineDisplayCount })
              }
              importing={!mineSkeleton && importing}
              importingName={importingName}
              loading={mineSkeleton}
              loadingMore={mineScrollLoad && projectsLoadingMore}
              hasMore={mineScrollLoad && projectsHasMore}
              onLoadMore={mineScrollLoad ? loadMoreProjects : undefined}
              onCreate={onCreate}
              createDisabled={importing}
              orgOptions={orgOptions}
              gridClassName={HOME_PROJECT_GRID}
            />
          </div>
        </main>
      ) : null}

      {showHome ? (
        <main className={cn(HOME_MAIN_SCROLL, 'flex flex-col')}>
          <div
            className={cn(
              HOME_MAIN_INSET,
              'flex h-full min-h-[min(100%,calc(100dvh-5rem))] w-full flex-1 flex-col items-center justify-center py-4 sm:py-6'
            )}
          >
            <HomeHero onSubmit={onAgentSubmit} />
          </div>
        </main>
      ) : null}

      {showInspiration && !isDesktopLocal() ? (
        <main className={HOME_MAIN_SCROLL}>
          <div className={HOME_MAIN_INSET}>
            <InspirationSection onOpenCase={onOpenCase} disabled={importing} />
          </div>
        </main>
      ) : null}
    </>
  );
}

export function useHomeNav() {
  const [nav, setNavState] = useQueryState('nav', homeNavParser);
  const [query, setQuery] = useQueryState('q', homeQueryParser);
  const [importing, setImporting] = useState(false);
  const [importingName, setImportingName] = useState('');

  const setNav = useCallback(
    (id: string) => {
      void setNavState(parseHomeNavParam(id));
    },
    [setNavState]
  );

  return { nav, setNav, query, setQuery, importing, setImporting, importingName, setImportingName };
}

const MemoizedHomeSidebar = memo(HomeSidebar);
export { MemoizedHomeSidebar as HomeSidebar };
const MemoizedHomeTemplateList = memo(HomeTemplateList);
export { MemoizedHomeTemplateList as HomeTemplateList };
