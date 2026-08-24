import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, memo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { parseAsString, parseAsStringLiteral, useQueryState } from 'nuqs';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineBell,
  HiOutlineBookOpen,
  HiOutlineChatBubbleLeftRight,
  HiOutlineFolder,
  HiOutlineHome,
  HiOutlinePlusCircle,
} from 'react-icons/hi2';
import { RiPuzzleLine } from 'react-icons/ri';
import { LuPanelLeftClose, LuPanelLeftOpen, LuUserRound } from 'react-icons/lu';
import { Dropdown, Tooltip } from '@/components/base';
import AppLogo from '@/components/base/AppLogo';
import { Icon } from '@/components/base/icon';
import HomeHero from '@/components/home/HomeHero';
import InspirationSection from '@/components/home/InspirationSection';
import MePage from '@/components/home/MePage';
import RecentProjectsSection from '@/components/home/RecentProjectsSection';
import SkillsLibraryPanel from '@/components/home/SkillsLibraryPanel';
import type { HomeAgentSubmitPayload } from '@/components/home/HomeAgentComposer';
import type { OfficialCaseMeta } from '@/utils/officialCases';
import TemplateGrid from '@/components/templates/TemplateGrid';
import { flushCurrentProjectNow } from '@/components/editor/useProjectCloudSync';
import { clearProjectsLibrary } from '@/store/modules/editor';
import { apiQuery } from '@/service/client';
import {
  clearProjectsListCache,
  type PaginatedProjects,
  type ProjectSummaryDto,
} from '@/service/projects';
import { normalizeProjectThumbnailUrls, collageOrSingleThumb } from '@/utils/projectThumb';
import { getToken } from '@/utils/token';
import { docsUrl, openExternalUrl } from '@/utils/docsUrl';
import { buildLoginUrl } from '@/utils/authReturnTo';
import { useIsDesktopShell } from '@/components/layout/DesktopTitlebar';
import {
  homeRailWidthPx,
  useHomeRailExpanded,
} from '@/components/layout/useHomeRailExpanded';
import { isDesktopLocal } from '@/utils/apiBase';
import { cn } from '@/utils/classnames';

const PROJECT_PAGE_SIZE = 20;

const HOME_NAV_KEYS = ['home', 'mine', 'account', 'skills'] as const;
type HomeNavKey = (typeof HOME_NAV_KEYS)[number];

function parseHomeNavParam(raw: string | null | undefined): HomeNavKey {
  if (raw === 'mine' || raw === 'account' || raw === 'skills' || raw === 'home') return raw;
  // Legacy location.state / typo — bounce to home.
  return 'home';
}

function homeLoginReturnPath(nav: HomeNavKey): string {
  if (nav === 'home') return '/home';
  return `/home?nav=${nav}`;
}

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

const RAIL_STROKE = 1.5;
/** Shared hit box for rail buttons. */
const RAIL_ICON_BOX = 'flex h-6 w-6 shrink-0 items-center justify-center';
/** Add (+) stays slightly larger. */
const RAIL_ICON = 'h-6 w-6';
/** Home / account — 22px. */
const RAIL_ICON_MD = 'h-[22px] w-[22px]';
/** Skills / mine — 20px (optically denser glyphs). */
const RAIL_ICON_SM = 'h-5 w-5';

const RAIL_HELP_WIKI =
  'https://my.feishu.cn/wiki/EuoxwPk4OighdZkmAVMc7Gisn8b?from=from_copylink';

function handleRailHelpClick(key: string) {
  if (key === 'guide') {
    openExternalUrl(docsUrl('/guide/getting-started'));
    return;
  }
  if (key === 'contact') {
    openExternalUrl('mailto:702680355@qq.com');
    return;
  }
  openExternalUrl(RAIL_HELP_WIKI);
}

function RailGlyph({ children }: { children: ReactNode }) {
  return <span className={RAIL_ICON_BOX}>{children}</span>;
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
        'group flex h-10 shrink-0 items-center rounded-xl transition-colors disabled:opacity-50',
        expanded
          ? 'w-full gap-3 px-2.5'
          : 'mx-auto w-10 justify-center rounded-full',
        active
          ? 'bg-[color-mix(in_srgb,var(--ink)_6%,var(--rail))] text-[var(--ink)]'
          : 'text-[var(--ink)]/55 hover:bg-[color-mix(in_srgb,var(--ink)_3%,var(--rail))] hover:text-[var(--ink)]'
      )}
    >
      <RailGlyph>{icon}</RailGlyph>
      {expanded ? (
        <span className="min-w-0 truncate text-[13px] font-medium leading-none tracking-tight">
          {label}
        </span>
      ) : null}
    </button>
  );

  if (expanded) return button;
  return (
    <Tooltip tip={label} placement="right" offset={10}>
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
      <div className="mb-3 flex h-10 shrink-0 items-center gap-2 px-1">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <AppLogo size={26} />
          <span
            className="truncate text-[15px] font-semibold leading-none tracking-tight text-[var(--ink)] [font-family:var(--font-hero)]"
            aria-hidden
          >
            {t('app.name')}
          </span>
        </div>
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
      <Tooltip tip={t('home.railExpand')} placement="right" offset={10}>
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

function RailDivider({ expanded }: { expanded?: boolean }) {
  return (
    <div
      className={cn(
        'my-1 h-px bg-[var(--line)]',
        expanded ? 'mx-2.5' : 'mx-auto w-6'
      )}
      aria-hidden
    />
  );
}

function RailHelpMenu({ expanded }: { expanded: boolean }) {
  const { t } = useTranslation();
  const desktopLocal = isDesktopLocal();

  const items = useMemo(
    () => [
      {
        key: 'guide',
        label: (
          <span className="inline-flex items-center gap-2">
            <HiOutlineBookOpen className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.75} />
            {t('home.railHelpGuide')}
          </span>
        ),
      },
      {
        key: 'contact',
        label: (
          <span className="inline-flex items-center gap-2">
            <HiOutlineChatBubbleLeftRight className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.75} />
            {t('home.railHelpContact')}
          </span>
        ),
      },
      ...(desktopLocal
        ? []
        : [
            {
              key: 'updates',
              label: (
                <span className="inline-flex items-center gap-2">
                  <HiOutlineBell className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.75} />
                  {t('home.railHelpUpdates')}
                </span>
              ),
            },
          ]),
    ],
    [t, desktopLocal]
  );

  const trigger = (
    <button
      type="button"
      aria-label={t('home.railHelp')}
      className={cn(
        'flex h-10 items-center rounded-xl text-[var(--ink)]/55 transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_3%,var(--rail))] hover:text-[var(--ink)]',
        expanded ? 'w-full gap-3 px-2.5' : 'mx-auto w-10 justify-center'
      )}
    >
      <span className={RAIL_ICON_BOX}>
        <Icon name="home-help-circle" className="h-6 w-6" />
      </span>
      {expanded ? (
        <span className="min-w-0 truncate text-[13px] font-medium leading-none tracking-tight">
          {t('home.railHelp')}
        </span>
      ) : null}
    </button>
  );

  return (
    <Dropdown
      trigger="hover"
      placement="right-end"
      offset={12}
      floatingClassName="z-[600]"
      items={items}
      onClick={handleRailHelpClick}
    >
      {expanded ? (
        trigger
      ) : (
        <Tooltip tip={t('home.railHelp')} placement="right" offset={10}>
          {trigger}
        </Tooltip>
      )}
    </Dropdown>
  );
}

/** Side rail / top bar → force-refetch project list (same file; avoid prop drilling). */
let openProjectsListHandler: (() => void) | null = null;
let remountMeHandler: (() => void) | null = null;
let remountSkillsHandler: (() => void) | null = null;

/** Re-fetch Home / Projects list (no session cache). */
export function refreshHomeProjectsList() {
  openProjectsListHandler?.();
}

/** Remount Me / Skills so they refetch (no session cache). */
export function refreshHomeNavPanel(id: 'account' | 'skills') {
  if (id === 'account') remountMeHandler?.();
  else remountSkillsHandler?.();
}

/** Side rail — logo, Add, nav icons; help (?) stays at the bottom. */
function HomeSidebar({
  nav,
  setNav,
  importing,
  onCreate,
}: {
  nav: string;
  setNav: (id: string) => void;
  importing?: boolean;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const desktop = useIsDesktopShell();
  const [expanded, setExpanded] = useHomeRailExpanded();
  const railW = homeRailWidthPx(expanded);
  const userId = useSelector((state: any) => state.auth?.user?.id) as string | undefined;
  const authed = Boolean(userId && getToken());

  const goNav = (id: 'home' | 'mine' | 'account' | 'skills') => {
    if ((id === 'mine' || id === 'account' || id === 'skills') && !authed) {
      navigate(buildLoginUrl(homeLoginReturnPath(id)));
      return;
    }
    // Already on a list panel — effect won't re-run; force refresh on click.
    if ((id === 'home' || id === 'mine') && nav === id) {
      openProjectsListHandler?.();
      return;
    }
    if ((id === 'account' || id === 'skills') && nav === id) {
      refreshHomeNavPanel(id);
      return;
    }
    setNav(id);
  };

  return (
    <>
      {/* Web mobile brand only — Tauri already shows mark + name in the titlebar. */}
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

      {/* Desktop rail — expandable; logo hover reveals expand control when collapsed. */}
      <aside
        className="pointer-events-none absolute inset-y-0 left-0 z-30 hidden flex-col overflow-visible border-r border-[var(--line)] transition-[width] duration-200 ease-out md:flex"
        style={{ width: railW }}
        aria-label={t('app.name')}
        data-expanded={expanded ? 'true' : 'false'}
      >
        <div
          className={cn(
            'pointer-events-auto flex h-full flex-col items-stretch overflow-hidden bg-[var(--rail)] pb-5 pt-4',
            expanded ? 'px-3' : 'px-2'
          )}
        >
          <RailBrandHeader
            expanded={expanded}
            onExpand={() => setExpanded(true)}
            onCollapse={() => setExpanded(false)}
          />
          <nav
            className="flex min-h-0 flex-1 flex-col items-stretch gap-1.5 overflow-y-auto overflow-x-hidden"
            aria-label={t('app.name')}
          >
            <RailItem
              expanded={expanded}
              label={t('home.railAdd')}
              disabled={importing}
              onClick={onCreate}
              icon={
                <HiOutlinePlusCircle
                  className={RAIL_ICON}
                  strokeWidth={RAIL_STROKE}
                  aria-hidden
                />
              }
            />
            <RailItem
              expanded={expanded}
              label={t('home.navHome')}
              active={nav === 'home'}
              onClick={() => goNav('home')}
              icon={
                <HiOutlineHome className={RAIL_ICON_MD} strokeWidth={RAIL_STROKE} aria-hidden />
              }
            />
            <RailItem
              expanded={expanded}
              label={t('home.mine')}
              active={nav === 'mine'}
              onClick={() => goNav('mine')}
              icon={
                <HiOutlineFolder
                  className={RAIL_ICON_SM}
                  strokeWidth={RAIL_STROKE}
                  aria-hidden
                />
              }
            />
            <RailItem
              expanded={expanded}
              label={t('home.railSkills')}
              active={nav === 'skills'}
              onClick={() => goNav('skills')}
              icon={
                <RiPuzzleLine
                  // Remix Line is fill-based (~2px); soften to match hi2/lu stroke 1.5.
                  className={cn(
                    RAIL_ICON_MD,
                    'fill-current text-current opacity-[0.78] transition-opacity',
                    'group-hover:opacity-100 group-aria-[current=page]:opacity-100'
                  )}
                  aria-hidden
                />
              }
            />
            <RailDivider expanded={expanded} />
            <RailItem
              expanded={expanded}
              label={t('home.account')}
              active={nav === 'account'}
              onClick={() => goNav('account')}
              icon={
                <LuUserRound className={RAIL_ICON_MD} strokeWidth={RAIL_STROKE} aria-hidden />
              }
            />
          </nav>
          <div className={cn('mt-auto flex shrink-0 pt-3', expanded ? 'justify-stretch' : 'justify-center')}>
            <RailHelpMenu expanded={expanded} />
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
  const [meMountKey, setMeMountKey] = useState(0);
  const [skillsMountKey, setSkillsMountKey] = useState(0);
  /** Filter "我的项目" by team org (empty = all accessible). */
  const [filterOrgId, setFilterOrgId] = useState('');
  /** Tracks Home/Projects surface enter/leave so we don't double-fetch on cold mount. */
  const onProjectsSurfaceRef = useRef(false);
  const skippedInitialProjectsRefreshRef = useRef(false);

  /** Guest must not stay on Projects / Me — bounce home + open login. */
  useEffect(() => {
    if (authed) return;
    if (nav !== 'mine' && nav !== 'account' && nav !== 'skills') return;
    const returnTo = homeLoginReturnPath(nav);
    setNav('home');
    navigate(buildLoginUrl(returnTo));
  }, [authed, nav, navigate, setNav]);

  const showAccount = nav === 'account' && Boolean(authed);
  const showMine = nav === 'mine' && Boolean(authed);
  const showSkills = nav === 'skills' && Boolean(authed);
  const showHome = !showAccount && !showMine && !showSkills;
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
  const projectsQuery = useInfiniteQuery({
    ...apiQuery.projectsListMyProjects.infiniteOptions({
      input: (pageParam: number) => ({
        query: {
          page: pageParam,
          pageSize: PROJECT_PAGE_SIZE,
          ...(showMine && filterOrgId ? { orgId: filterOrgId } : {}),
        },
      }),
      initialPageParam: 1,
      getNextPageParam: (last: unknown) => {
        const page = last as PaginatedProjects;
        return page?.hasMore ? (page.page || 0) + 1 : undefined;
      },
    }),
    enabled: projectsListEnabled,
  });
  const refetchProjects = projectsQuery.refetch;
  const projectsHasMore = Boolean(projectsQuery.hasNextPage);
  const projectsLoadingMore = projectsQuery.isFetchingNextPage;

  const { items: projectListItems, total: projectsTotal } = useMemo(() => {
    // Match Me published list: keep last data in Query cache, but never render it on error.
    if (projectsQuery.isError) return { items: [] as ProjectListItem[], total: 0 };
    return mergeProjectPages(projectsQuery.data?.pages as unknown[] | undefined);
  }, [projectsQuery.data?.pages, projectsQuery.isError]);

  const projectsReady =
    !authed ||
    projectsQuery.isError ||
    Boolean(projectsQuery.data) ||
    !projectsQuery.isPending;

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
    if (!projectsQuery.isStale && projectsQuery.data) return;
    await refetchProjects();
  }, [authed, projectsQuery.data, projectsQuery.isStale, refetchProjects]);

  useEffect(() => {
    openProjectsListHandler = () => {
      void softRefreshProjectsList();
    };
    remountMeHandler = () => setMeMountKey((k) => k + 1);
    remountSkillsHandler = () => setSkillsMountKey((k) => k + 1);
    return () => {
      if (openProjectsListHandler) openProjectsListHandler = null;
      remountMeHandler = null;
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
    // Re-enter from Skills / Me — force refresh (staleTime may still be warm).
    void refreshProjectsList({ flush: false });
    // Intentionally keyed by tab visibility.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshProjectsList stable via refetch
  }, [authed, dispatch, showHome, showMine]);

  const loadMoreProjects = useCallback(() => {
    if (!authed || !projectsHasMore || projectsLoadingMore || !projectsReady) return;
    projectsQuery.fetchNextPage();
  }, [
    authed,
    projectsHasMore,
    projectsLoadingMore,
    projectsQuery.fetchNextPage,
    projectsReady,
  ]);

  const listForGrid = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projectListItems;
    return projectListItems.filter((item) =>
      (item.name || '').toLowerCase().includes(q)
    );
  }, [projectListItems, query]);

  const homeProjectsLoading = Boolean(authed) && !projectsReady;
  const mineTitle = t('home.mine');
  const mineSkeleton = Boolean(authed) && !projectsReady;
  const mineScrollLoad = !query.trim();
  const importBonus = importing ? 1 : 0;
  const mineDisplayCount = mineScrollLoad
    ? projectsTotal + importBonus
    : listForGrid.length + importBonus;

  return (
    <>
      {showAccount ? <MePage key={meMountKey} onOpenCase={onOpenCase} /> : null}

      {showSkills ? (
        <main className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-transparent">
          <div className="relative mx-auto w-full min-w-0 max-w-[1700px] px-5 pb-10 pt-16 sm:px-8 sm:pt-20 md:px-24 lg:px-[100px] xl:px-[120px]">
            <SkillsLibraryPanel key={skillsMountKey} />
          </div>
        </main>
      ) : null}

      {showMine ? (
        <main className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-transparent">
          <div className="relative mx-auto w-full min-w-0 max-w-[1700px] space-y-8 px-5 pb-10 pt-16 sm:px-8 sm:pt-20 md:px-24 lg:px-[100px] xl:px-[120px]">
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
              gridClassName="grid w-full grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5"
            />
          </div>
        </main>
      ) : null}

      {showHome ? (
        <main className="relative min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-transparent">
          <div className="relative mx-auto flex w-full min-w-0 max-w-[1700px] flex-col items-stretch px-5 pb-10 pt-0 sm:px-8 md:px-24 lg:px-[100px] xl:px-[120px]">
            <HomeHero onSubmit={onAgentSubmit} />
            <div className="flex flex-col space-y-6 sm:space-y-12">
              <RecentProjectsSection
                projects={authed ? projectListItems : []}
                loading={homeProjectsLoading}
                disabled={importing}
                onCreate={onCreate}
                onViewAll={() => {
                  if (!authed) {
                    navigate(buildLoginUrl(homeLoginReturnPath('mine')));
                    return;
                  }
                  if (nav === 'mine') openProjectsListHandler?.();
                  else setNav('mine');
                }}
              />
              {!isDesktopLocal() ? (
                <InspirationSection onOpenCase={onOpenCase} disabled={importing} />
              ) : null}
            </div>
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
