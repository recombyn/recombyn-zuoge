import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, memo } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HiOutlineListBullet } from 'react-icons/hi2';
import EmptyState from '@/components/home/EmptyState';
import AssetKindFilterBar, { type AssetTabKind } from '@/components/home/AssetKindFilterBar';
import { BatchSelectBottomBar, BatchSelectControls } from '@/components/home/BatchSelectControls';
import InspirationCasePreview from '@/components/home/InspirationCasePreview';
import { InspirationCaseCard } from '@/components/home/InspirationSection';
import { FlowScrollSection, FlowFeedSkeleton, FLOW_COLUMNS_CLASS } from '@/components/home/FlowScrollSection';
import {
  UserAssetCard,
  UserAssetCardSkeleton,
} from '@/components/home/UserAssetMediaCard';
import AssetDayGroupedGrid from '@/components/home/AssetDayGroupedGrid';
import { groupUserAssetsByDay } from '@/utils/assetDateGroups';
import { Button, Dialog, message } from '@/components/base';
import { apiQuery } from '@/service/client';
import { plazaDisplayCoverUrls } from '@/models/plaza';
import type { UserAsset } from '@/models/assets';
import {
  caseAuthorLabel,
  resolveCaseTitle,
  normalizeCaseCategory,
  type OfficialCaseMeta,
} from '@/utils/officialCases';
import { buildLoginUrl } from '@/utils/authReturnTo';
import { cn } from '@/utils/classnames';
import type { HomeMoreKey } from '@/components/layout/homeNav';

const PAGE_SIZE = 20;
const ASSETS_PAGE_SIZE = 30;

type Props = {
  section: HomeMoreKey;
  onOpenCase: (meta: OfficialCaseMeta) => void;
};

type LikedCaseItem = OfficialCaseMeta & { likedAt: number };

type LikedListPage = {
  items?: Array<{
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
  }>;
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

function isMediaAssetKind(kind: string): kind is 'image' | 'video' | 'audio' | 'lottie' {
  return kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'lottie';
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

function mapLikedItem(x: NonNullable<LikedListPage['items']>[number]): LikedCaseItem {
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

const LIVE_HOME_LIST_OPTS = {
  staleTime: 0,
  gcTime: 60_000,
  refetchOnMount: 'always' as const,
};

/** Home More sub-page — assets or likes, same shell as 灵感. */
function MoreSection({ section, onOpenCase }: Props): ReactNode {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = useSelector((s: any) => s.auth?.user?.id as string | undefined);
  const authed = Boolean(userId);
  const isAssets = section === 'assets';

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [likeBusyId, setLikeBusyId] = useState<string | null>(null);
  const [remixingId, setRemixingId] = useState<string | null>(null);
  const [assetSelectMode, setAssetSelectMode] = useState(false);
  const [assetSelected, setAssetSelected] = useState<string[]>([]);
  const [assetBatchDeleteOpen, setAssetBatchDeleteOpen] = useState(false);
  const [assetDeleting, setAssetDeleting] = useState(false);
  const [assetSearchInput, setAssetSearchInput] = useState('');
  const [assetSearchQ, setAssetSearchQ] = useState('');
  const [assetActiveTab, setAssetActiveTab] = useState<AssetTabKind>('all');
  const assetSearchTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isAssets) return undefined;
    if (assetSearchTimerRef.current) window.clearTimeout(assetSearchTimerRef.current);
    assetSearchTimerRef.current = window.setTimeout(() => {
      setAssetSearchQ(assetSearchInput.trim());
    }, 300);
    return () => {
      if (assetSearchTimerRef.current) window.clearTimeout(assetSearchTimerRef.current);
    };
  }, [assetSearchInput, isAssets]);

  const likedIdsQuery = useQuery({
    ...apiQuery.meMeLikedIds.queryOptions({
      enabled: Boolean(authed) && !isAssets,
    }),
    ...LIVE_HOME_LIST_OPTS,
  });

  const likedQuery = useInfiniteQuery({
    ...apiQuery.meMeLikedList.infiniteOptions({
      input: (pageParam: number) => ({
        query: { page: pageParam, pageSize: PAGE_SIZE },
      }),
      initialPageParam: 1,
      getNextPageParam: (last: unknown) => {
        const page = last as LikedListPage;
        return page?.hasMore ? (page.page || 0) + 1 : undefined;
      },
      enabled: !isAssets && authed,
    }),
    ...LIVE_HOME_LIST_OPTS,
  });

  const assetsQuery = useInfiniteQuery({
    ...apiQuery.assetsListMyAssets.infiniteOptions({
      input: (pageParam: number) => ({
        query: {
          page: pageParam,
          pageSize: ASSETS_PAGE_SIZE,
          ...(assetActiveTab !== 'all' ? { kind: assetActiveTab } : {}),
          ...(assetSearchQ ? { q: assetSearchQ } : {}),
        },
      }),
      initialPageParam: 1,
      getNextPageParam: (last: unknown) => {
        const page = last as AssetsListPage;
        return page?.hasMore ? (page.page || 0) + 1 : undefined;
      },
      enabled: isAssets && authed,
    }),
    ...LIVE_HOME_LIST_OPTS,
    staleTime: assetSearchQ ? 0 : LIVE_HOME_LIST_OPTS.staleTime,
  });

  const previewItemQuery = useQuery(
    apiQuery.plazaPlazaItem.queryOptions({
      input: { params: { submission_id: previewId || '' } },
      enabled: Boolean(previewId),
    })
  );

  useEffect(() => {
    if (likedQuery.isError) message.error(t('home.casesLoadFailed'));
  }, [likedQuery.isError, t]);

  useEffect(() => {
    if (assetsQuery.isError) message.error(t('editor.assets.loadFail'));
  }, [assetsQuery.isError, t]);

  const likedIds = useMemo(() => {
    const ids = (likedIdsQuery.data as { ids?: string[] } | undefined)?.ids || [];
    return new Set(ids.map(String));
  }, [likedIdsQuery.data]);

  const liked = useMemo(() => {
    const pages = likedQuery.data?.pages || [];
    const items: LikedCaseItem[] = [];
    const seen = new Set<string>();
    for (const page of pages) {
      const res = page as LikedListPage;
      for (const x of res.items || []) {
        const mapped = mapLikedItem(x);
        if (seen.has(mapped.id)) continue;
        seen.add(mapped.id);
        items.push(mapped);
      }
    }
    return items;
  }, [likedQuery.data]);

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

  const assetDayGroups = useMemo(
    () => groupUserAssetsByDay(assets, i18n.language, t),
    [assets, i18n.language, t]
  );

  useEffect(() => {
    const ids = new Set(assets.map((item) => item.id));
    setAssetSelected((prev) => prev.filter((id) => ids.has(id)));
  }, [assets]);

  useEffect(() => {
    if (assetSelectMode && assets.length === 0) {
      setAssetSelectMode(false);
      setAssetSelected([]);
    }
  }, [assets.length, assetSelectMode]);

  const toggleAssetSelection = (id: string) => {
    setAssetSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const exitAssetSelectMode = () => {
    setAssetSelectMode(false);
    setAssetSelected([]);
  };

  const allAssetsSelected = assets.length > 0 && assetSelected.length === assets.length;

  const selectAllAssets = () => {
    if (allAssetsSelected) setAssetSelected([]);
    else setAssetSelected(assets.map((a) => a.id));
  };

  const batchDeleteAssets = async () => {
    const ids = [...assetSelected];
    if (!ids.length) return;
    setAssetDeleting(true);
    try {
      await Promise.all(
        ids.map((id) => apiQuery.assetsDeleteMyAsset.call({ params: { asset_id: id } }))
      );
      const idSet = new Set(ids);
      queryClient.setQueriesData(
        { queryKey: apiQuery.assetsListMyAssets.key() },
        (old: unknown) => {
          const data = old as { pages?: AssetsListPage[]; pageParams?: unknown } | null | undefined;
          if (!data?.pages) return old;
          return {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: (page.items || []).filter((a) => !idSet.has(a.id)),
            })),
          };
        }
      );
      await queryClient.invalidateQueries({ queryKey: apiQuery.assetsListMyAssets.key() });
      message.destructive(t('home.batchDeleted', { count: ids.length }));
      exitAssetSelectMode();
      setAssetBatchDeleteOpen(false);
    } catch {
      message.error(t('editor.assets.deleteFail'));
    } finally {
      setAssetDeleting(false);
    }
  };

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

  const previewMeta = useMemo(
    () => (previewId ? liked.find((c) => c.id === previewId) || null : null),
    [liked, previewId]
  );

  const previewDocument = previewMeta
    ? ((previewItemQuery.data as PlazaItemPayload | undefined)?.item?.document ?? null)
    : null;

  const onToggleLike = async (meta: OfficialCaseMeta, e?: MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!userId) {
      message.warning(t('home.cases.likeNeedLogin'));
      navigate(buildLoginUrl('/home?nav=liked'));
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

  const title = isAssets ? t('home.railAssets') : t('home.railLiked');

  return (
    <section className="w-full min-w-0">
      {isAssets ? (
        !authed ? (
          <>
            <h2 className="mb-3 truncate text-[24px] font-bold leading-tight tracking-tight text-[var(--ink)]">
              {title}
            </h2>
            <EmptyState hint={t('me.needLogin')} />
          </>
        ) : (
          <>
            <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-[24px] font-bold leading-tight tracking-tight text-[var(--ink)]">
                  {title}
                </h2>
                <button
                  type="button"
                  title={assetSelectMode ? t('home.cancelSelect') : t('home.batchSelect')}
                  aria-pressed={assetSelectMode}
                  disabled={!assets.length && !assetSelectMode}
                  onClick={(e) => {
                    if (assetSelectMode) {
                      exitAssetSelectMode();
                      e.currentTarget.blur();
                      return;
                    }
                    if (!assets.length) return;
                    setAssetSelectMode(true);
                  }}
                  className={cn(
                    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--line)]',
                    assetSelectMode
                      ? 'bg-[var(--accent-soft)] text-[var(--ink)]'
                      : 'bg-transparent text-[var(--muted)] [@media(hover:hover)]:hover:bg-[var(--accent-soft)] [@media(hover:hover)]:hover:text-[var(--ink)]',
                    !assets.length &&
                      !assetSelectMode &&
                      'cursor-not-allowed opacity-40 [@media(hover:hover)]:hover:bg-transparent'
                  )}
                >
                  <HiOutlineListBullet className="h-5 w-5" />
                </button>
                {assetSelectMode && assetSelected.length > 0 ? (
                  <span className="shrink-0 text-[12px] text-[var(--muted)] lg:hidden">
                    {t('home.selectedCount', { count: assetSelected.length })}
                  </span>
                ) : null}
              </div>

              {assetSelectMode && assets.length > 0 ? (
                <BatchSelectControls
                  className="hidden lg:inline-flex"
                  total={assets.length}
                  selectedCount={assetSelected.length}
                  allSelected={allAssetsSelected}
                  deleting={assetDeleting}
                  onToggleSelectAll={selectAllAssets}
                  onClearSelection={() => setAssetSelected([])}
                  onDelete={() => {
                    if (!assetSelected.length) return;
                    setAssetBatchDeleteOpen(true);
                  }}
                  onCancel={exitAssetSelectMode}
                />
              ) : null}
            </div>

            <AssetKindFilterBar
              className="mb-5"
              activeTab={assetActiveTab}
              onTabChange={setAssetActiveTab}
              searchInput={assetSearchInput}
              onSearchInputChange={setAssetSearchInput}
            />
            <FlowScrollSection
              loading={assetsQuery.isPending}
              loadingMore={assetsQuery.isFetchingNextPage}
              hasMore={Boolean(assetsQuery.hasNextPage)}
              onLoadMore={() => {
                if (!assetsQuery.hasNextPage || assetsQuery.isPending || assetsQuery.isFetchingNextPage)
                  return;
                void assetsQuery.fetchNextPage();
              }}
              isEmpty={assets.length === 0}
              empty={
                <EmptyState
                  hint={
                    assetSearchQ
                      ? t('editor.assets.searchEmpty')
                      : t('home.moreEmptyAssets')
                  }
                />
              }
              columnsClassName="flex flex-col gap-6"
              skeleton={
                <div className={FLOW_COLUMNS_CLASS}>
                  {Array.from({ length: 12 }, (_, i) => (
                    <UserAssetCardSkeleton key={i} index={i} />
                  ))}
                </div>
              }
            >
              <AssetDayGroupedGrid
                layout="nested"
                groups={assetDayGroups}
                gridClassName={FLOW_COLUMNS_CLASS}
                renderItem={(asset) => (
                  <UserAssetCard
                    key={asset.id}
                    asset={asset}
                    selectMode={assetSelectMode}
                    selected={assetSelected.includes(asset.id)}
                    onToggle={() => toggleAssetSelection(asset.id)}
                  />
                )}
              />
            </FlowScrollSection>

            {assetSelectMode && assets.length > 0 ? (
              <>
                <div className="h-16 lg:hidden" aria-hidden />
                <BatchSelectBottomBar
                  total={assets.length}
                  selectedCount={assetSelected.length}
                  allSelected={allAssetsSelected}
                  deleting={assetDeleting}
                  onToggleSelectAll={selectAllAssets}
                  onClearSelection={() => setAssetSelected([])}
                  onDelete={() => {
                    if (!assetSelected.length) return;
                    setAssetBatchDeleteOpen(true);
                  }}
                  onCancel={exitAssetSelectMode}
                />
              </>
            ) : null}

            <Dialog
              show={assetBatchDeleteOpen}
              onClose={() => {
                if (assetDeleting) return;
                setAssetBatchDeleteOpen(false);
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
                    disabled={assetDeleting}
                    onClick={() => setAssetBatchDeleteOpen(false)}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    destructive
                    loading={assetDeleting}
                    onClick={() => void batchDeleteAssets()}
                  >
                    {t('common.delete')}
                  </Button>
                </>
              }
            >
              <p className="text-[13px] leading-relaxed text-[var(--muted)]">
                {t('home.batchDeleteConfirmBody', { count: assetSelected.length })}
              </p>
            </Dialog>
          </>
        )
      ) : !authed ? (
        <>
          <h2 className="mb-3 truncate text-[24px] font-bold leading-tight tracking-tight text-[var(--ink)]">
            {title}
          </h2>
          <EmptyState hint={t('home.cases.likeNeedLogin')} />
        </>
      ) : (
        <>
          <h2 className="mb-3 truncate text-[24px] font-bold leading-tight tracking-tight text-[var(--ink)]">
            {title}
          </h2>
          <FlowScrollSection
            loading={likedQuery.isPending}
            loadingMore={likedQuery.isFetchingNextPage}
            hasMore={Boolean(likedQuery.hasNextPage)}
            onLoadMore={() => {
              if (!likedQuery.hasNextPage || likedQuery.isPending || likedQuery.isFetchingNextPage)
                return;
              void likedQuery.fetchNextPage();
            }}
            isEmpty={liked.length === 0}
            empty={<EmptyState hint={t('home.moreEmptyLiked')} />}
            columnsClassName={FLOW_COLUMNS_CLASS}
            skeleton={<FlowFeedSkeleton />}
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
                onOpenPreview={(meta) => setPreviewId(meta.id)}
                onToggleLike={onToggleLike}
                t={t}
              />
            ))}
          </FlowScrollSection>
        </>
      )}

      <InspirationCasePreview
        open={!!previewMeta}
        caseMeta={previewMeta}
        projectDocument={previewDocument}
        likedIds={likedIds}
        likeBusy={!!previewMeta && likeBusyId === previewMeta.id}
        remixing={!!remixingId}
        onClose={() => setPreviewId(null)}
        onRemix={(meta) => void remix(meta)}
        onToggleLike={(meta) => void onToggleLike(meta)}
      />

    </section>
  );
}

export default memo(MoreSection);
