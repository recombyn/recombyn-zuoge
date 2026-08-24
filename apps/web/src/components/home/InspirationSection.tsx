import { useEffect, useMemo, useState, type MouseEvent, type ReactNode, memo } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  HiHeart,
  HiOutlineDocumentArrowDown,
  HiOutlinePhoto,
} from 'react-icons/hi2';
import { Icon } from '@/components/base/icon';
import {
  plazaDisplayCoverUrls,
} from '@/models/plaza';
import {
  caseAuthorLabel,
  resolveCasePrompt,
  resolveCaseTitle,
  type OfficialCaseCategory,
  type OfficialCaseMeta,
  normalizeCaseCategory,
} from '@/utils/officialCases';
import InspirationCasePreview from '@/components/home/InspirationCasePreview';
import EmptyState from '@/components/home/EmptyState';
import PlazaCoverThumb from '@/components/home/PlazaCoverThumb';
import { FlowScrollSection, FlowFeedSkeleton } from '@/components/home/FlowScrollSection';
import SegmentTabs from '@/components/home/SegmentTabs';
import { Dropdown, message } from '@/components/base';
import type { MenuItemType } from '@/components/base/dropdown/MenuItem';
import { apiQuery } from '@/service/client';
import { cn } from '@/utils/classnames';
import { buildLoginUrl } from '@/utils/authReturnTo';
import { imageSrcToFile } from '@/utils/uploadImage';

import { HOME_INSPIRATION_COLUMNS } from '@/components/home/homeLayout';

type Props = {
  onOpenCase: (meta: OfficialCaseMeta) => void;
  disabled?: boolean;
};

const TABS = ['all', 'poster', 'mobile', 'image', 'video'] as const;
type PlazaTab = (typeof TABS)[number];
const PAGE_SIZE = 15;

type PlazaFeedItem = {
  id: string;
  userId?: string;
  title: string;
  category: string;
  authorName: string;
  authorAvatar?: string | null;
  coverDocument?: unknown | null;
  thumbnailUrl?: string | string[] | null;
  customCoverImageUrl?: string | null;
  panelUrls?: Array<{ id: string; name?: string; url: string }> | null;
  createdAt: number;
  likeCount?: number;
  useCount?: number;
  updatedAt?: number;
  document?: unknown | null;
};

type PlazaFeedPage = {
  items?: PlazaFeedItem[];
  hasMore?: boolean;
  page?: number;
};

function formatStatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

function coverImageUrl(meta: OfficialCaseMeta): string {
  const fromList =
    Array.isArray(meta.thumbnailUrls) && meta.thumbnailUrls.length
      ? meta.thumbnailUrls.find((u) => String(u || '').trim())
      : '';
  const fromThumb = String(meta.thumbnail || '').trim();
  const fromPanel = meta.panelUrls?.find((p) => String(p?.url || '').trim())?.url;
  return String(fromList || fromThumb || fromPanel || '').trim();
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = String(text || '').trim();
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

async function copyImageToClipboard(url: string): Promise<boolean> {
  const src = String(url || '').trim();
  if (!src) return false;
  try {
    // COS/plaza covers lack browser CORS 鈥?go through /api/v1/uploads/content.
    const file = await imageSrcToFile(src, 'inspiration.png');
    const type = file.type && file.type.startsWith('image/') ? file.type : 'image/png';
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      await navigator.clipboard.writeText(src);
      return true;
    }
    await navigator.clipboard.write([new ClipboardItem({ [type]: file })]);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(src);
      return true;
    } catch {
      return false;
    }
  }
}

function feedToMeta(item: PlazaFeedItem): OfficialCaseMeta {
  const urls = plazaDisplayCoverUrls(item);
  return {
    id: item.id,
    name: item.title,
    category: normalizeCaseCategory(item.category) as OfficialCaseCategory,
    source: 'plaza',
    authorName: item.authorName,
    authorAvatar: item.authorAvatar,
    coverDocument: item.coverDocument ?? null,
    thumbnailUrls: urls,
    thumbnail: urls[0] || null,
    panelUrls: item.panelUrls ?? null,
    authorUserId: item.userId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    likeCount: Number(item.likeCount) || 0,
    useCount: Number(item.useCount) || 0,
  };
}

function resolveNextLikeCount(
  current: number,
  wasLiked: boolean,
  nowLiked: boolean,
  serverCount: number
): number {
  if (Number.isFinite(serverCount)) return Math.max(0, serverCount);
  const base = current;
  if (nowLiked) return wasLiked ? base : base + 1;
  return wasLiked ? Math.max(0, base - 1) : base;
}

function httpStatusFromError(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const anyErr = err as {
    status?: number;
    response?: { status?: number };
    data?: { status?: number };
  };
  return anyErr.status ?? anyErr.response?.status ?? anyErr.data?.status;
}

function InspirationCaseCard({
  meta,
  liked,
  likes,
  title,
  author,
  disabled,
  likeBusy,
  onOpenPreview,
  onToggleLike,
  t,
}: {
  meta: OfficialCaseMeta;
  liked: boolean;
  likes: number;
  title: string;
  author: string;
  disabled?: boolean;
  likeBusy: boolean;
  onOpenPreview: (meta: OfficialCaseMeta) => void;
  onToggleLike: (meta: OfficialCaseMeta, e?: MouseEvent) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}): ReactNode {
  const initial = (author[0] || 'R').toUpperCase();
  const useMenuItems: MenuItemType[] = [
    {
      key: 'prompt',
      label: (
        <span className="inline-flex items-center gap-2">
          <HiOutlineDocumentArrowDown className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t('home.cases.usePrompt')}
        </span>
      ),
    },
    {
      key: 'image',
      label: (
        <span className="inline-flex items-center gap-2">
          <HiOutlinePhoto className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t('home.cases.useImage')}
        </span>
      ),
    },
  ];

  const onUseMenu = async (key: string) => {
    if (key === 'prompt') {
      const prompt = resolveCasePrompt(meta, t);
      const ok = await copyTextToClipboard(prompt);
      if (ok) {
        message.success(t('home.cases.promptCopied'));
        async function recordPlazaUseAfterPromptCopy() {
          try {
            await apiQuery.plazaPlazaItemUse.call({
              params: { submission_id: meta.id },
            });
          } catch {
            /* ignore */
          }
        }
        recordPlazaUseAfterPromptCopy();
      } else {
        message.error(t('home.cases.copyFailed'));
      }
      return;
    }
    if (key === 'image') {
      const url = coverImageUrl(meta);
      if (!url) {
        message.error(t('home.cases.copyFailed'));
        return;
      }
      const ok = await copyImageToClipboard(url);
      if (ok) {
        message.success(t('home.cases.imageCopied'));
        async function recordPlazaUseAfterImageCopy() {
          try {
            await apiQuery.plazaPlazaItemUse.call({
              params: { submission_id: meta.id },
            });
          } catch {
            /* ignore */
          }
        }
        recordPlazaUseAfterImageCopy();
      } else {
        message.error(t('home.cases.copyFailed'));
      }
    }
  };

  return (
    <article className="group min-w-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onOpenPreview(meta)}
        className="block w-full text-left disabled:opacity-60"
        aria-label={title}
      >
        <PlazaCoverThumb
          coverDocument={meta.coverDocument}
          thumbnail={
            (Array.isArray(meta.thumbnailUrls) && meta.thumbnailUrls[0]) ||
            meta.thumbnail ||
            null
          }
          version={Number(meta.updatedAt) || Number(meta.createdAt) || undefined}
          layout="flow"
        >
          {/* Hover title 鈥?bottom scrim gradient (see plaza showcase covers). */}
          <span
            className={cn(
              'pointer-events-none absolute inset-x-0 bottom-0 z-10',
              'bg-gradient-to-t from-black/70 via-black/35 to-transparent',
              'px-2.5 pb-2.5 pt-10',
              'opacity-0 transition-opacity duration-300 group-hover:opacity-100'
            )}
          >
            <span className="line-clamp-2 text-left text-[12px] font-medium leading-snug text-white">
              {title}
            </span>
          </span>
        </PlazaCoverThumb>
      </button>

      {/* Flow footer 鈥?avatar + author; like + use (prompt/image) menu. */}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onOpenPreview(meta)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-60"
        >
          {meta.authorAvatar ? (
            <img
              src={meta.authorAvatar}
              alt=""
              className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-[var(--line)]"
            />
          ) : (
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-[9px] font-bold text-[var(--on-brand)]"
              aria-hidden
            >
              {initial}
            </span>
          )}
          <span className="min-w-0 truncate text-[12px] font-medium text-[var(--ink)]">
            {author}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2.5 text-[12px] tabular-nums text-[var(--muted)]">
          <button
            type="button"
            aria-pressed={liked}
            aria-label={liked ? t('home.cases.unlike') : t('home.cases.like')}
            disabled={likeBusy}
            onClick={(e) => onToggleLike(meta, e)}
            className={cn(
              'inline-flex items-center gap-0.5 transition hover:text-[var(--ink)] disabled:opacity-50',
              liked && 'text-[#e11d48]'
            )}
          >
            <HiHeart className={cn('h-3.5 w-3.5', liked && 'fill-current')} aria-hidden />
            {formatStatCount(likes)}
          </button>
          <Dropdown
            trigger="click"
            placement="bottom-end"
            strategy="fixed"
            offset={4}
            items={useMenuItems}
            onClick={onUseMenu}
            floatingClassName="z-[600]"
            popupClassName="min-w-[9.5rem] rounded-xl !bg-[var(--surface)] p-1.5 shadow-[0_8px_28px_rgba(15,23,42,0.14)] ring-1 ring-[var(--line)]"
          >
            <button
              type="button"
              disabled={disabled}
              aria-haspopup="menu"
              aria-label={t('home.cases.use')}
              title={t('home.cases.use')}
              className="inline-flex h-5 w-5 items-center justify-center text-[#BCBCBC] transition hover:text-[var(--ink)] disabled:opacity-50"
            >
              <Icon name="home-use-case-menu" className="h-[14px] w-[14px]" />
            </button>
          </Dropdown>
        </div>
      </div>
    </article>
  );
}

function InspirationSection({ onOpenCase, disabled }: Props): ReactNode {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useSelector((s: any) => s.auth?.user);
  const userId = user?.id as string | undefined;
  const [tab, setTab] = useState<PlazaTab>('all');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [likeBusyId, setLikeBusyId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const likedQuery = useQuery(
    apiQuery.meMeLikedIds.queryOptions({
      enabled: !!userId,
    })
  );

  const feedQuery = useInfiniteQuery(
    apiQuery.plazaPlazaFeed.infiniteOptions({
      input: (page: number) => ({
        query: {
          page,
          pageSize: PAGE_SIZE,
          tab: 'latest',
          ...(tab !== 'all' ? { category: tab } : {}),
        },
      }),
      initialPageParam: 1,
      getNextPageParam: (last: unknown) => {
        const page = last as PlazaFeedPage;
        return page?.hasMore ? (page.page || 0) + 1 : undefined;
      },
    })
  );

  const previewQuery = useQuery(
    apiQuery.plazaPlazaItem.queryOptions({
      input: { params: { submission_id: previewId || '' } },
      enabled: Boolean(previewId),
    })
  );

  useEffect(() => {
    if (!feedQuery.isError) return;
    const status = httpStatusFromError(feedQuery.error);
    if (status) message.error(t('home.casesLoadFailed'));
  }, [feedQuery.isError, feedQuery.error, t]);

  const likedIds = useMemo(() => {
    if (!userId) return new Set<string>();
    const ids = (likedQuery.data as { ids?: string[] } | undefined)?.ids || [];
    return new Set(ids);
  }, [likedQuery.data, userId]);

  const cases = useMemo(() => {
    const pages = (feedQuery.data?.pages || []) as PlazaFeedPage[];
    return pages.flatMap((p) => (p.items || []).map(feedToMeta));
  }, [feedQuery.data]);

  const previewMeta = useMemo(
    () => (previewId ? cases.find((c) => c.id === previewId) || null : null),
    [cases, previewId]
  );

  const previewItem = (previewQuery.data as { item?: PlazaFeedItem } | undefined)?.item;
  const previewDocument =
    previewItem && previewId && previewItem.id === previewId
      ? (previewItem.document ?? null)
      : null;
  const previewPanelUrls =
    previewItem && previewId && previewItem.id === previewId && Array.isArray(previewItem.panelUrls)
      ? previewItem.panelUrls
      : null;

  const displayPreviewMeta = useMemo(() => {
    if (!previewMeta) return null;
    if (!previewPanelUrls?.length) return previewMeta;
    return { ...previewMeta, panelUrls: previewPanelUrls };
  }, [previewMeta, previewPanelUrls]);

  const feedInfiniteKey = apiQuery.plazaPlazaFeed.infiniteKey({
    input: (page: number) => ({
      query: {
        page,
        pageSize: PAGE_SIZE,
        tab: 'latest',
        ...(tab !== 'all' ? { category: tab } : {}),
      },
    }),
    initialPageParam: 1,
  });

  function patchFeedItem(
    submissionId: string,
    patch: (item: PlazaFeedItem) => PlazaFeedItem
  ) {
    queryClient.setQueryData(feedInfiniteKey, (old) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page) => {
          const feedPage = page as PlazaFeedPage;
          return {
            ...feedPage,
            items: (feedPage.items || []).map((item) =>
              item.id === submissionId ? patch(item) : item
            ),
          };
        }),
      };
    });
  }

  const openPreview = (meta: OfficialCaseMeta) => {
    if (disabled) return;
    setPreviewId(meta.id);
  };

  const remix = async (meta: OfficialCaseMeta) => {
    if (disabled || openingId) return;
    setOpeningId(meta.id);
    try {
      async function trackRemixUse() {
        try {
          const res = (await apiQuery.plazaPlazaItemUse.call({
            params: { submission_id: meta.id },
          })) as { useCount?: number };
          const n = Number(res.useCount);
          if (!Number.isFinite(n)) return;
          patchFeedItem(meta.id, (item) => ({ ...item, useCount: n }));
        } catch {
          /* ignore */
        }
      }
      trackRemixUse();
      setPreviewId(null);
      // Skill chip 鈫?chat; blank canvas (handled by HomePage). No document clone.
      onOpenCase(meta);
    } catch {
      message.error(t('home.casesOpenFailed'));
    } finally {
      setOpeningId(null);
    }
  };

  const toggleLikeMutation = useMutation({
    mutationFn: async (meta: OfficialCaseMeta) => {
      const wasLiked = likedIds.has(meta.id);
      const input = { params: { submission_id: meta.id } };
      const res = (await (wasLiked
        ? apiQuery.meMeUnlike.call(input)
        : apiQuery.meMeLike.call(input))) as {
        liked?: boolean;
        likeCount?: number;
      };
      return { meta, wasLiked, res };
    },
    onSuccess: ({ meta, wasLiked, res }) => {
      const nowLiked = Boolean(res?.liked);
      const serverCount = Number(res?.likeCount);
      queryClient.setQueryData(apiQuery.meMeLikedIds.queryKey(), (old: unknown) => {
        const prev = old as { ids?: string[] } | undefined;
        const next = new Set(prev?.ids || []);
        if (nowLiked) next.add(meta.id);
        else next.delete(meta.id);
        return { ...(prev && typeof prev === 'object' ? prev : {}), ids: [...next] };
      });
      patchFeedItem(meta.id, (item) => ({
        ...item,
        likeCount: resolveNextLikeCount(
          Number(item.likeCount) || 0,
          wasLiked,
          nowLiked,
          serverCount
        ),
      }));
      message.success(nowLiked ? t('home.cases.likedToast') : t('home.cases.unlikedToast'));
    },
    onError: () => {
      message.error(t('home.casesLoadFailed'));
    },
    onSettled: () => {
      setLikeBusyId(null);
    },
  });

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

  const onTabClick = (next: PlazaTab) => {
    if (next === tab) return;
    setTab(next);
  };

  const onLoadMore = () => {
    if (!feedQuery.hasNextPage || feedQuery.isPending || feedQuery.isFetchingNextPage) return;
    feedQuery.fetchNextPage();
  };

  const loading = feedQuery.isPending && cases.length === 0;
  const loadingMore = feedQuery.isFetchingNextPage;
  const hasMore = Boolean(feedQuery.hasNextPage);

  return (
    <section className="w-full min-w-0">
      <h2 className="mb-3 truncate text-[24px] font-bold leading-tight tracking-tight text-[var(--ink)]">
        {t('home.cases.title')}
      </h2>
      <SegmentTabs
        className="mb-5"
        variant="chips"
        size="sm"
        aria-label={t('home.cases.title')}
        tabs={TABS.map((id) => ({ id, label: t(`home.cases.cat.${id}`) }))}
        value={tab}
        onChange={onTabClick}
      />

      <FlowScrollSection
        loading={loading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
        isEmpty={!loading && cases.length === 0}
        empty={<EmptyState hint={t('home.cases.empty')} />}
        columnsClassName={HOME_INSPIRATION_COLUMNS}
        skeleton={<FlowFeedSkeleton />}
      >
        {cases.map((c) => {
          const meta =
            previewId === c.id && previewPanelUrls?.length
              ? { ...c, panelUrls: previewPanelUrls }
              : c;
          return (
            <InspirationCaseCard
              key={c.id}
              meta={meta}
              liked={likedIds.has(c.id)}
              likes={Math.max(0, Number(c.likeCount) || 0)}
              title={resolveCaseTitle(c, t)}
              author={caseAuthorLabel(c, t)}
              disabled={disabled}
              likeBusy={likeBusyId === c.id}
              onOpenPreview={openPreview}
              onToggleLike={onToggleLike}
              t={t}
            />
          );
        })}
      </FlowScrollSection>

      <InspirationCasePreview
        open={!!displayPreviewMeta}
        caseMeta={displayPreviewMeta}
        projectDocument={displayPreviewMeta ? previewDocument : null}
        likedIds={likedIds}
        likeBusy={!!displayPreviewMeta && likeBusyId === displayPreviewMeta.id}
        remixing={!!openingId}
        onClose={() => {
          setPreviewId(null);
        }}
        onRemix={(meta) => remix(meta)}
        onToggleLike={(meta) => onToggleLike(meta)}
      />
    </section>
  );
}

export default memo(InspirationSection);

const MemoizedInspirationCaseCard = memo(InspirationCaseCard);
export { MemoizedInspirationCaseCard as InspirationCaseCard };
