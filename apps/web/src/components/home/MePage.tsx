import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, memo } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { useQuery, useInfiniteQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiQuery } from '@/service/client';
import { Icon } from '@/components/base/icon';
import EditProfileDialog from '@/components/home/EditProfileDialog';
import EmptyState from '@/components/home/EmptyState';
import InspirationCasePreview from '@/components/home/InspirationCasePreview';
import {
  InspirationCaseCard,
} from '@/components/home/InspirationSection';
import { FlowScrollSection } from '@/components/home/FlowScrollSection';
import {
  InfiniteScrollSection,
  GRID_SKELETON_COUNT,
} from '@/components/home/InfiniteScroll';
import {
  UserAssetCard,
  UserAssetCardSkeleton,
  UserAssetMediaPreview,
} from '@/components/home/UserAssetMediaCard';
import SegmentTabs from '@/components/home/SegmentTabs';
import { UserAvatar } from '@/components/layout/UserAccountPanel';
import { buildLoginUrl } from '@/utils/authReturnTo';
import type { UserAsset } from '@/models/assets';
import {
  plazaDisplayCoverUrls,
} from '@/models/plaza';
import {
  caseAuthorLabel,
  resolveCaseTitle,
  normalizeCaseCategory,
  type OfficialCaseMeta,
} from '@/utils/officialCases';
import { Button, Dialog, message } from '@/components/base';
import { getToken } from '@/utils/token';

/** Me profile feed 鈥?same scale as Skills: 2 鈫?3 鈫?4 鈫?5 (2xl). */
const ME_FLOW_COLUMNS =
  'w-full columns-2 gap-4 md:columns-3 lg:columns-4 2xl:columns-5';

const PAGE_SIZE = 20;
const ASSETS_PAGE_SIZE = 30;

type ProfileTab = 'published' | 'liked' | 'assets';

const PROFILE_TABS = ['published', 'liked', 'assets'] as const;

const meTabParser = parseAsStringLiteral(PROFILE_TABS)
  .withDefault('published')
  .withOptions({ history: 'replace', clearOnDefault: true });

function isMediaAssetKind(kind: string): kind is 'image' | 'video' | 'audio' | 'lottie' {
  return kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'lottie';
}

type LikedCaseItem = OfficialCaseMeta & { likedAt: number };

type Props = {
  onOpenCase: (meta: OfficialCaseMeta) => void;
};

const LIKED_LOCAL_PREFIX = 'recombyn-liked-cases-v1:';

/** One-shot migrate local likes 鈫?API, then clear localStorage. */
function loadLocalLikedIds(userId: string): string[] {
  try {
    const raw = localStorage.getItem(`${LIKED_LOCAL_PREFIX}${userId}`);
    if (!raw) return [];
    const list = JSON.parse(raw) as Array<{ id?: string }>;
    if (!Array.isArray(list)) return [];
    return list.map((x) => String(x?.id || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function clearLocalLiked(userId: string) {
  try {
    localStorage.removeItem(`${LIKED_LOCAL_PREFIX}${userId}`);
  } catch {
    /* ignore */
  }
}

function resolveNextLikeCount(
  current: number,
  wasLiked: boolean,
  nowLiked: boolean,
  serverCount: number
): number {
  if (Number.isFinite(serverCount)) return Math.max(0, serverCount);
  if (nowLiked) return wasLiked ? current : current + 1;
  return wasLiked ? Math.max(0, current - 1) : current;
}

function mapLikedItem(x: {
  id: string;
  title?: string;
  category: string;
  authorName?: string;
  authorAvatar?: string | null;
  coverDocument?: unknown | null;
  thumbnailUrl?: string | string[] | null;
  customCoverImageUrl?: string | null;
  panelUrls?: OfficialCaseMeta['panelUrls'];
  userId?: string;
  createdAt: number;
  updatedAt?: number;
  likedAt?: number;
  likeCount?: number;
  useCount?: number;
}): LikedCaseItem {
  const urls = plazaDisplayCoverUrls(x);
  return {
    id: x.id,
    name: x.title || '',
    category: normalizeCaseCategory(x.category),
    source: 'plaza',
    authorName: x.authorName,
    authorAvatar: x.authorAvatar,
    coverDocument: x.coverDocument ?? null,
    thumbnailUrls: urls,
    thumbnail: urls[0] || null,
    panelUrls: x.panelUrls ?? null,
    authorUserId: x.userId,
    createdAt: x.createdAt,
    updatedAt: x.updatedAt,
    likeCount: Number(x.likeCount) || 0,
    useCount: Number(x.useCount) || 0,
    likedAt: x.likedAt || Date.now(),
  };
}

function mapPublishedSubmission(x: {
  id: string;
  title: string;
  category: string;
  authorName?: string;
  authorAvatar?: string | null;
  coverDocument?: unknown | null;
  thumbnailUrl?: string | string[] | null;
  customCoverImageUrl?: string | null;
  panelUrls?: OfficialCaseMeta['panelUrls'];
  createdAt: number;
  updatedAt?: number;
  likeCount?: number;
  useCount?: number;
}): OfficialCaseMeta {
  const urls = plazaDisplayCoverUrls(x);
  return {
    id: x.id,
    name: x.title,
    category: normalizeCaseCategory(x.category),
    source: 'plaza',
    authorName: x.authorName,
    authorAvatar: x.authorAvatar,
    coverDocument: x.coverDocument ?? null,
    thumbnailUrls: urls,
    thumbnail: urls[0] || null,
    panelUrls: x.panelUrls ?? null,
    createdAt: x.createdAt,
    updatedAt: x.updatedAt,
    likeCount: Number(x.likeCount) || 0,
    useCount: Number(x.useCount) || 0,
  };
}

type PlazaMinePage = {
  items?: Array<Parameters<typeof mapPublishedSubmission>[0] & { status?: string }>;
};

type LikedListPage = {
  items?: Array<Parameters<typeof mapLikedItem>[0]>;
  page?: number;
  hasMore?: boolean;
};

type AssetsListPage = {
  items?: UserAsset[];
  page?: number;
  hasMore?: boolean;
};

type PlazaItemPayload = {
  item?: {
    document?: unknown | null;
    panelUrls?: OfficialCaseMeta['panelUrls'];
  };
};

type LikeToggleResult = {
  liked?: boolean;
  likeCount?: number;
};

function applyPanelUrls<T extends OfficialCaseMeta>(
  items: T[],
  panelUrlsById: Record<string, OfficialCaseMeta['panelUrls']>
): T[] {
  if (!Object.keys(panelUrlsById).length) return items;
  return items.map((c) => {
    const panels = panelUrlsById[c.id];
    return panels ? { ...c, panelUrls: panels } : c;
  });
}

function patchMineLikeCount(
  old: unknown,
  submissionId: string,
  wasLiked: boolean,
  nowLiked: boolean,
  serverCount: number
): unknown {
  const data = old as PlazaMinePage | null | undefined;
  if (!data?.items) return old;
  return {
    ...data,
    items: data.items.map((item) =>
      item.id !== submissionId
        ? item
        : {
            ...item,
            likeCount: resolveNextLikeCount(
              Number(item.likeCount) || 0,
              wasLiked,
              nowLiked,
              serverCount
            ),
          }
    ),
  };
}

function patchLikedPages(
  old: unknown,
  submissionId: string,
  wasLiked: boolean,
  nowLiked: boolean,
  serverCount: number
): unknown {
  const data = old as { pages?: LikedListPage[]; pageParams?: unknown } | null | undefined;
  if (!data?.pages) return old;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: nowLiked
        ? (page.items || []).map((item) =>
            item.id !== submissionId
              ? item
              : {
                  ...item,
                  likeCount: resolveNextLikeCount(
                    Number(item.likeCount) || 0,
                    wasLiked,
                    nowLiked,
                    serverCount
                  ),
                }
          )
        : (page.items || []).filter((item) => item.id !== submissionId),
    })),
  };
}

/** 銆屾垜鐨勩€嶉〉锛氳祫鏂欏尯 + 宸插彂甯?/ 鎴戠殑鍠滄 / 璧勪骇 鈥?鍗＄墖涓庨瑙堝悓骞垮満锛涜祫浜ц法椤圭洰銆?*/
function MePage({ onOpenCase }: Props): ReactNode {
  const { t, i18n } = useTranslation();
  const user = useSelector((s: any) => s.auth.user);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useQueryState('meTab', meTabParser);
  const [editOpen, setEditOpen] = useState(false);

  const [publishedVisible, setPublishedVisible] = useState(PAGE_SIZE);
  const [publishedLoadingMore, setPublishedLoadingMore] = useState(false);

  const [assetBusyId, setAssetBusyId] = useState<string | null>(null);
  const [assetPreview, setAssetPreview] = useState<UserAsset | null>(null);
  const [assetDeleteTarget, setAssetDeleteTarget] = useState<UserAsset | null>(null);

  const [likeBusyId, setLikeBusyId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [panelUrlsById, setPanelUrlsById] = useState<
    Record<string, OfficialCaseMeta['panelUrls']>
  >({});
  const [remixingId, setRemixingId] = useState<string | null>(null);

  const likedMigratedRef = useRef(false);

  const displayName = user?.name || user?.email?.split('@')[0] || t('home.account');
  const userId = user?.id as string | undefined;
  const authed = Boolean(userId && getToken());

  useEffect(() => {
    setPublishedVisible(PAGE_SIZE);
    setAssetPreview(null);
    setAssetDeleteTarget(null);
    setPreviewId(null);
    setPanelUrlsById({});
    likedMigratedRef.current = false;
  }, [userId]);

  useEffect(() => {
    if (!authed || !userId || likedMigratedRef.current) return;
    async function migrateLocalLiked() {
      const localIds = loadLocalLikedIds(userId!);
      likedMigratedRef.current = true;
      if (!localIds.length) return;
      try {
        await apiQuery.meMeLikedSync.call({ body: { ids: localIds } });
        clearLocalLiked(userId!);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: apiQuery.meMeLikedList.key() }),
          queryClient.invalidateQueries({ queryKey: apiQuery.meMeLikedIds.key() }),
        ]);
      } catch {
        /* ignore migrate failures 鈥?list can still load */
      }
    }
    migrateLocalLiked();
  }, [authed, userId, queryClient]);

  const publishedQuery = useQuery({
    ...apiQuery.plazaPlazaMine.queryOptions({
      enabled: Boolean(userId),
    }),
    select: (data: unknown) => {
      const res = data as PlazaMinePage;
      return (res.items || [])
        .filter((x) => x.status === 'approved')
        .map(mapPublishedSubmission);
    },
  });

  const likedIdsQuery = useQuery({
    ...apiQuery.meMeLikedIds.queryOptions({
      enabled: Boolean(authed),
    }),
  });

  const likedQuery = useInfiniteQuery(
    apiQuery.meMeLikedList.infiniteOptions({
      input: (pageParam: number) => ({
        query: { page: pageParam, pageSize: PAGE_SIZE },
      }),
      initialPageParam: 1,
      getNextPageParam: (last: any) =>
        last?.hasMore ? (last.page || 0) + 1 : undefined,
      enabled: tab === 'liked' && authed,
    })
  );

  const assetsQuery = useInfiniteQuery(
    apiQuery.assetsListMyAssets.infiniteOptions({
      input: (pageParam: number) => ({
        query: { page: pageParam, pageSize: ASSETS_PAGE_SIZE },
      }),
      initialPageParam: 1,
      getNextPageParam: (last: any) =>
        last?.hasMore ? (last.page || 0) + 1 : undefined,
      enabled: tab === 'assets' && authed,
    })
  );

  const previewItemQuery = useQuery({
    ...apiQuery.plazaPlazaItem.queryOptions({
      input: { params: { submission_id: previewId || '' } },
      enabled: Boolean(previewId),
    }),
  });

  useEffect(() => {
    if (likedQuery.isError) message.error(t('home.casesLoadFailed'));
  }, [likedQuery.isError, t]);

  useEffect(() => {
    if (assetsQuery.isError) message.error(t('me.assetsLoadFail'));
  }, [assetsQuery.isError, t]);

  useEffect(() => {
    if (!previewId || !previewItemQuery.data) return;
    const item = (previewItemQuery.data as PlazaItemPayload).item;
    if (!item) return;
    if (Array.isArray(item.panelUrls) && item.panelUrls.length) {
      const panels = item.panelUrls;
      setPanelUrlsById((prev) =>
        prev[previewId] === panels ? prev : { ...prev, [previewId]: panels }
      );
    }
  }, [previewId, previewItemQuery.data]);

  const likedIds = useMemo(() => {
    const ids = (likedIdsQuery.data as { ids?: string[] } | undefined)?.ids || [];
    return new Set(ids.map(String));
  }, [likedIdsQuery.data]);

  const publishedAll = useMemo(() => {
    const list = publishedQuery.isError ? [] : publishedQuery.data || [];
    return applyPanelUrls(list, panelUrlsById);
  }, [publishedQuery.data, publishedQuery.isError, panelUrlsById]);

  const liked = useMemo(() => {
    const pages = likedQuery.data?.pages || [];
    const items: LikedCaseItem[] = [];
    const seen = new Set<string>();
    for (const page of pages) {
      const res = page as LikedListPage;
      for (const x of res.items || []) {
        const mapped = mapLikedItem(x as Parameters<typeof mapLikedItem>[0]);
        if (seen.has(mapped.id)) continue;
        seen.add(mapped.id);
        items.push(mapped);
      }
    }
    return applyPanelUrls(items, panelUrlsById);
  }, [likedQuery.data, panelUrlsById]);

  const assets = useMemo(() => {
    const pages = assetsQuery.data?.pages || [];
    const items: UserAsset[] = [];
    const seen = new Set<string>();
    for (const page of pages) {
      const res = page as AssetsListPage;
      for (const a of res.items || []) {
        if (!isMediaAssetKind(String(a.kind || ''))) continue;
        if (seen.has(a.id)) continue;
        seen.add(a.id);
        items.push(a);
      }
    }
    return items;
  }, [assetsQuery.data]);

  const onProfileTabChange = (id: string) => {
    const next = id as ProfileTab;
    void setTab(next);
    async function refreshTab() {
      if (next === 'liked') {
        await queryClient.invalidateQueries({ queryKey: apiQuery.meMeLikedList.key() });
      } else if (next === 'published') {
        setPublishedVisible(PAGE_SIZE);
        await queryClient.invalidateQueries({ queryKey: apiQuery.plazaPlazaMine.key() });
      } else if (next === 'assets') {
        await queryClient.invalidateQueries({ queryKey: apiQuery.assetsListMyAssets.key() });
      }
    }
    void refreshTab();
  };

  const publishedSlice = publishedAll.slice(0, publishedVisible);
  const publishedHasMore = publishedVisible < publishedAll.length;
  const publishedLoading = Boolean(userId) && publishedQuery.isPending;

  const loadMorePublished = () => {
    if (!publishedHasMore || publishedLoading || publishedLoadingMore) return;
    setPublishedLoadingMore(true);
    window.setTimeout(() => {
      setPublishedVisible((n) => Math.min(n + PAGE_SIZE, publishedAll.length));
      setPublishedLoadingMore(false);
    }, 180);
  };

  const loadMoreLiked = () => {
    if (!likedQuery.hasNextPage || likedQuery.isPending || likedQuery.isFetchingNextPage) return;
    likedQuery.fetchNextPage();
  };

  const loadMoreAssets = () => {
    if (!assetsQuery.hasNextPage || assetsQuery.isPending || assetsQuery.isFetchingNextPage) return;
    assetsQuery.fetchNextPage();
  };

  const deleteAssetMutation = useMutation(
    apiQuery.assetsDeleteMyAsset.mutationOptions({
      onSuccess: async (_data, variables) => {
        const id = String(variables.params.asset_id || '').trim();
        queryClient.setQueriesData(
          { queryKey: apiQuery.assetsListMyAssets.key() },
          (old: unknown) => {
            const data = old as { pages?: AssetsListPage[]; pageParams?: unknown } | null | undefined;
            if (!data?.pages) return old;
            return {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                items: (page.items || []).filter((a) => a.id !== id),
              })),
            };
          }
        );
        await queryClient.invalidateQueries({ queryKey: apiQuery.assetsListMyAssets.key() });
        if (assetPreview?.id === id) setAssetPreview(null);
        setAssetDeleteTarget(null);
        message.destructive(t('me.deleteAssetOk'));
      },
      onError: () => {
        message.error(t('me.deleteAssetFail'));
      },
      onSettled: () => {
        setAssetBusyId(null);
      },
    })
  );

  const toggleLikeMutation = useMutation({
    mutationFn: async (meta: OfficialCaseMeta) => {
      const wasLiked = likedIds.has(meta.id);
      const input = { params: { submission_id: meta.id } };
      const res = (await (wasLiked
        ? apiQuery.meMeUnlike.call(input)
        : apiQuery.meMeLike.call(input))) as LikeToggleResult;
      return { meta, wasLiked, res };
    },
    onSuccess: async ({ meta, wasLiked, res }) => {
      const nowLiked = Boolean(res?.liked);
      const serverCount = Number(res?.likeCount);

      queryClient.setQueryData(apiQuery.meMeLikedIds.queryKey(), (old: unknown) => {
        const prev = old as { ids?: string[] } | null | undefined;
        const next = new Set((prev?.ids || []).map(String));
        if (nowLiked) next.add(meta.id);
        else next.delete(meta.id);
        return { ids: [...next] };
      });

      queryClient.setQueriesData(
        { queryKey: apiQuery.plazaPlazaMine.key() },
        (old) => patchMineLikeCount(old, meta.id, wasLiked, nowLiked, serverCount)
      );
      queryClient.setQueriesData(
        { queryKey: apiQuery.meMeLikedList.key() },
        (old) => patchLikedPages(old, meta.id, wasLiked, nowLiked, serverCount)
      );

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: apiQuery.meMeLikedIds.key() }),
        queryClient.invalidateQueries({ queryKey: apiQuery.meMeLikedList.key() }),
      ]);

      if (!nowLiked && previewId === meta.id) setPreviewId(null);
      message.success(nowLiked ? t('home.cases.likedToast') : t('home.cases.unlikedToast'));
    },
    onError: () => {
      message.error(t('home.casesLoadFailed'));
    },
    onSettled: () => {
      setLikeBusyId(null);
    },
  });

  const onDeleteAsset = async (asset: UserAsset) => {
    const id = String(asset.id || '').trim();
    if (!id || assetBusyId) return;
    setAssetBusyId(id);
    await deleteAssetMutation.mutateAsync({ params: { asset_id: id } });
  };

  const openAssetPreview = (asset: UserAsset) => {
    const url = String(asset.url || '').trim();
    if (!url && asset.kind !== 'audio') return;
    setAssetPreview(asset);
  };

  const listForPreview = tab === 'liked' ? liked : publishedAll;

  const previewMeta = useMemo(
    () => (previewId ? listForPreview.find((c) => c.id === previewId) || null : null),
    [listForPreview, previewId]
  );

  const previewDocument = previewMeta
    ? ((previewItemQuery.data as PlazaItemPayload | undefined)?.item?.document ?? null)
    : null;

  const openPreview = (meta: OfficialCaseMeta) => {
    setPreviewId(meta.id);
  };

  const onToggleLike = async (meta: OfficialCaseMeta, e?: MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!userId) {
      message.warning(t('home.cases.likeNeedLogin'));
      navigate(buildLoginUrl('/home'));
      return;
    }
    if (likeBusyId === meta.id) return;
    setLikeBusyId(meta.id);
    await toggleLikeMutation.mutateAsync(meta);
  };

  const remix = async (meta: OfficialCaseMeta) => {
    if (remixingId) return;
    setRemixingId(meta.id);
    try {
      async function trackRemixUse() {
        try {
          await apiQuery.plazaPlazaItemUse.call({
            params: { submission_id: meta.id },
          });
        } catch {
          /* ignore */
        }
      }
      void trackRemixUse();
      setPreviewId(null);
      onOpenCase(meta);
    } catch {
      message.error(t('home.casesOpenFailed'));
    } finally {
      setRemixingId(null);
    }
  };

  const openProfile = () => {
    if (!user) {
      navigate(buildLoginUrl('/home'));
      return;
    }
    setEditOpen(true);
  };

  const profileTabs: { id: ProfileTab; label: string }[] = [
    { id: 'published', label: t('me.tabPublished') },
    { id: 'liked', label: t('me.tabLiked') },
    { id: 'assets', label: t('me.tabAssets') },
  ];

  return (
    <main className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-transparent [scrollbar-gutter:stable]">
      <div className="mx-auto w-full min-w-0 max-w-[1700px] px-5 pb-10 pt-20 sm:px-8 sm:pt-24 md:px-24 lg:px-[100px] xl:px-[120px]">
        <header className="mx-auto flex w-full max-w-[760px] flex-col items-center gap-4 text-center">
          <button
            type="button"
            onClick={openProfile}
            className="shrink-0 rounded-full outline-none ring-offset-2 transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--ink)]/30"
            aria-label={t('me.editProfile')}
          >
            <UserAvatar
              name={user?.name}
              email={user?.email}
              avatar={user?.avatar}
              size={64}
            />
          </button>
          <div className="flex min-w-0 items-center justify-center gap-2">
            <h1 className="truncate text-[28px] font-semibold tracking-tight text-[var(--ink)]">
              {displayName}
            </h1>
            <button
              type="button"
              aria-label={t('me.editProfile')}
              onClick={openProfile}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] ring-1 ring-[var(--line)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
            >
              <Icon name="home-profile-edit" className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        <div className="mt-8 flex w-full justify-start">
          <SegmentTabs
            size="md"
            tabs={profileTabs}
            value={tab}
            onChange={onProfileTabChange}
          />
        </div>

        <div className="mt-6 w-full">
          {tab === 'published' ? (
            <div role="tabpanel">
              {!userId ? (
                <EmptyState hint={t('plaza.needLogin')} />
              ) : (
                <FlowScrollSection
                  loading={publishedLoading}
                  loadingMore={publishedLoadingMore}
                  hasMore={publishedHasMore}
                  onLoadMore={loadMorePublished}
                  isEmpty={publishedAll.length === 0}
                  empty={<EmptyState hint={t('me.emptyPublished')} />}
                  columnsClassName={ME_FLOW_COLUMNS}
                >
                  {publishedSlice.map((c) => (
                    <InspirationCaseCard
                      key={c.id}
                      meta={c}
                      liked={likedIds.has(c.id)}
                      likes={Math.max(0, Number(c.likeCount) || 0)}
                      title={resolveCaseTitle(c, t)}
                      author={caseAuthorLabel(c, t)}
                      likeBusy={likeBusyId === c.id}
                      onOpenPreview={openPreview}
                      onToggleLike={onToggleLike}
                      t={t}
                    />
                  ))}
                </FlowScrollSection>
              )}
            </div>
          ) : null}

          {tab === 'liked' ? (
            <div role="tabpanel">
              {!userId ? (
                <EmptyState hint={t('home.cases.likeNeedLogin')} />
              ) : (
                <FlowScrollSection
                  loading={likedQuery.isPending}
                  loadingMore={likedQuery.isFetchingNextPage}
                  hasMore={Boolean(likedQuery.hasNextPage)}
                  onLoadMore={loadMoreLiked}
                  isEmpty={liked.length === 0}
                  empty={<EmptyState hint={t('me.emptyLiked')} />}
                  columnsClassName={ME_FLOW_COLUMNS}
                >
                  {liked.map((c) => (
                    <InspirationCaseCard
                      key={c.id}
                      meta={c}
                      liked={likedIds.has(c.id)}
                      likes={Math.max(0, Number(c.likeCount) || 0)}
                      title={resolveCaseTitle(c, t)}
                      author={caseAuthorLabel(c, t)}
                      likeBusy={likeBusyId === c.id}
                      onOpenPreview={openPreview}
                      onToggleLike={onToggleLike}
                      t={t}
                    />
                  ))}
                </FlowScrollSection>
              )}
            </div>
          ) : null}

          {tab === 'assets' ? (
            <div role="tabpanel">
              {!userId ? (
                <EmptyState hint={t('plaza.needLogin')} />
              ) : (
                <InfiniteScrollSection
                  loading={assetsQuery.isPending}
                  loadingMore={assetsQuery.isFetchingNextPage}
                  hasMore={Boolean(assetsQuery.hasNextPage)}
                  onLoadMore={loadMoreAssets}
                  isEmpty={assets.length === 0}
                  empty={<EmptyState hint={t('me.emptyAssets')} />}
                  gridClassName={ME_FLOW_COLUMNS}
                  skeleton={Array.from({ length: GRID_SKELETON_COUNT }, (_, i) => (
                    <UserAssetCardSkeleton key={i} index={i} />
                  ))}
                >
                  {assets.map((asset) => (
                    <UserAssetCard
                      key={asset.id}
                      asset={asset}
                      locale={i18n.language || 'zh'}
                      deleteBusy={assetBusyId === asset.id}
                      onActivate={openAssetPreview}
                      onDelete={(a) => setAssetDeleteTarget(a)}
                    />
                  ))}
                </InfiniteScrollSection>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <InspirationCasePreview
        open={!!previewMeta}
        caseMeta={previewMeta}
        projectDocument={previewDocument}
        likedIds={likedIds}
        likeBusy={!!previewMeta && likeBusyId === previewMeta.id}
        remixing={!!remixingId}
        onClose={() => setPreviewId(null)}
        onRemix={(meta) => remix(meta)}
        onToggleLike={(meta) => onToggleLike(meta)}
      />

      <UserAssetMediaPreview
        asset={assetPreview}
        onClose={() => setAssetPreview(null)}
      />

      <Dialog
        show={Boolean(assetDeleteTarget)}
        onClose={() => {
          if (assetBusyId) return;
          setAssetDeleteTarget(null);
        }}
        width={400}
        title={t('me.deleteAssetConfirmTitle')}
        titleClassName="!text-[16px] !font-semibold !pb-2"
        className="!bg-[var(--surface)] !p-5"
        footer={
          <>
            <Button
              size="small"
              type="default"
              disabled={Boolean(assetBusyId)}
              onClick={() => setAssetDeleteTarget(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              size="small"
              type="primary"
              destructive
              disabled={Boolean(assetBusyId)}
              onClick={() => {
                if (assetDeleteTarget) onDeleteAsset(assetDeleteTarget);
              }}
            >
              {t('me.deleteAsset')}
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          {t('me.deleteAssetConfirmBody')}
        </p>
      </Dialog>

      <EditProfileDialog open={editOpen} onClose={() => setEditOpen(false)} />
    </main>
  );
}

export default memo(MePage);
