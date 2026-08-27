import { useEffect, useMemo, useState, type MouseEvent, type ReactNode, memo } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import EmptyState from '@/components/home/EmptyState';
import InspirationCasePreview from '@/components/home/InspirationCasePreview';
import { InspirationCaseCard } from '@/components/home/InspirationSection';
import { FlowScrollSection, FlowFeedSkeleton, FLOW_COLUMNS_CLASS } from '@/components/home/FlowScrollSection';
import {
  UserAssetCard,
  UserAssetCardSkeleton,
  UserAssetMediaPreview,
} from '@/components/home/UserAssetMediaCard';
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
  const [assetPreview, setAssetPreview] = useState<UserAsset | null>(null);
  const [assetDeleteTarget, setAssetDeleteTarget] = useState<UserAsset | null>(null);
  const [assetBusyId, setAssetBusyId] = useState<string | null>(null);

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
        query: { page: pageParam, pageSize: ASSETS_PAGE_SIZE },
      }),
      initialPageParam: 1,
      getNextPageParam: (last: unknown) => {
        const page = last as AssetsListPage;
        return page?.hasMore ? (page.page || 0) + 1 : undefined;
      },
      enabled: isAssets && authed,
    }),
    ...LIVE_HOME_LIST_OPTS,
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
        message.destructive(t('editor.assets.deleteOk'));
      },
      onError: () => {
        message.error(t('editor.assets.deleteFail'));
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
      <h2 className="mb-5 truncate text-[24px] font-bold leading-tight tracking-tight text-[var(--ink)]">
        {title}
      </h2>

      {isAssets ? (
        !authed ? (
          <EmptyState hint={t('me.needLogin')} />
        ) : (
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
            empty={<EmptyState hint={t('home.moreEmptyAssets')} />}
            columnsClassName={FLOW_COLUMNS_CLASS}
            skeleton={
              <>
                {Array.from({ length: 12 }, (_, i) => (
                  <UserAssetCardSkeleton key={i} index={i} />
                ))}
              </>
            }
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
          </FlowScrollSection>
        )
      ) : !authed ? (
        <EmptyState hint={t('home.cases.likeNeedLogin')} />
      ) : (
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

      <UserAssetMediaPreview asset={assetPreview} onClose={() => setAssetPreview(null)} />

      <Dialog
        show={Boolean(assetDeleteTarget)}
        onClose={() => {
          if (assetBusyId) return;
          setAssetDeleteTarget(null);
        }}
        width={400}
        title={t('editor.assets.deleteConfirmTitle')}
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
              loading={Boolean(assetBusyId)}
              onClick={() => {
                if (assetDeleteTarget) void onDeleteAsset(assetDeleteTarget);
              }}
            >
              {t('editor.assets.delete')}
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          {t('editor.assets.deleteConfirmBody')}
        </p>
      </Dialog>
    </section>
  );
}

export default memo(MoreSection);
