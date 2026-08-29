/**
 * Floating assets panel — AI-generated image / video / audio from GET /api/v1/assets.
 * Click previews; drag onto canvas places via placeMediaAsset (same drop path as chat images).
 */
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { HiOutlineXMark } from 'react-icons/hi2';
import { message } from '@/components/base';
import { cn } from '@/utils/classnames';
import EmptyState from '@/components/home/EmptyState';
import { InfiniteScrollSection } from '@/components/home/InfiniteScroll';
import {
  UserAssetCard,
  UserAssetCardSkeleton,
  UserAssetMediaPreview,
  USER_ASSET_SKELETON_COUNT,
} from '@/components/home/UserAssetMediaCard';
import type { UserAsset } from '@/models/assets';
import { apiQuery } from '@/service/client';
import AssetKindFilterBar, { type AssetTabKind } from '@/components/home/AssetKindFilterBar';
import AssetDayGroupedGrid from '@/components/home/AssetDayGroupedGrid';
import { groupUserAssetsByDay } from '@/utils/assetDateGroups';
import {
  setMediaAssetDragData,
  scheduleClearMediaAssetDragData,
} from '@/utils/chatImageDrag';
import { parseLottieAnimationData } from '@/components/rcb/scene/document/nodeFactories';

const PAGE_SIZE = 30;
const ASSET_GRID_FLOW =
  'grid w-full grid-cols-5 gap-2 [&_[data-asset-card]]:mb-0';
/** Outside-click ignore — panel, toggle, media portals, toasts. */
const DISMISS_IGNORE =
  '[data-asset-panel],[data-assets-toggle],[data-asset-card],[data-asset-media-preview],[data-asset-audio-inline-preview],[data-asset-audio-inline-player],[data-asset-video-inline-player],[aria-label="Image preview"],.ant-message,.ant-message-notice,.vjs-modal-dialog';

function isMediaKind(kind: string): kind is 'image' | 'video' | 'audio' | 'lottie' {
  return kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'lottie';
}

function eventInsideDismissIgnore(e: Event): boolean {
  for (const node of e.composedPath()) {
    if (!(node instanceof Element)) continue;
    if (node.matches?.(DISMISS_IGNORE) || node.closest?.(DISMISS_IGNORE)) return true;
  }
  return false;
}

type Props = {
  onClose: () => void;
  /** Cap panel height (e.g. when timeline lifts the bottom HUD). */
  maxHeightPx?: number;
};

function AssetPanel({ onClose, maxHeightPx }: Props): ReactNode {
  const { t, i18n } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [searchInput, setSearchInput] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [activeTab, setActiveTab] = useState<AssetTabKind>('all');
  const [preview, setPreview] = useState<UserAsset | null>(null);
  const previewOpenRef = useRef(false);
  previewOpenRef.current = preview !== null;
  const draggedRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQ(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (previewOpenRef.current) return;
      if (eventInsideDismissIgnore(e)) return;
      const el = rootRef.current;
      const target = e.target;
      if (el && target instanceof Node && el.contains(target)) return;
      onCloseRef.current();
    };
    // Defer bind so the opening click cannot immediately dismiss; bubble (not capture)
    // so portaled media chrome can stopPropagation first.
    const timer = window.setTimeout(() => {
      window.addEventListener('pointerdown', onPointer);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (previewOpenRef.current) {
        setPreview(null);
        return;
      }
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const assetsListInput = (pageParam: number) => ({
    query: {
      page: pageParam,
      pageSize: PAGE_SIZE,
      ...(activeTab !== 'all' ? { kind: activeTab } : {}),
      ...(searchQ ? { q: searchQ } : {}),
    },
  });

  const assetsQuery = useInfiniteQuery({
    ...apiQuery.assetsListMyAssets.infiniteOptions({
      input: assetsListInput,
      initialPageParam: 1,
      getNextPageParam: (last: { hasMore?: boolean; page?: number }) =>
        last?.hasMore ? (last.page || 0) + 1 : undefined,
    }),
    queryKey: apiQuery.assetsListMyAssets.infiniteKey({
      input: assetsListInput,
      initialPageParam: 1,
    }),
    staleTime: searchQ ? 0 : undefined,
  });

  const items = useMemo(() => {
    const out: UserAsset[] = [];
    for (const page of assetsQuery.data?.pages || []) {
      for (const a of (page as { items?: UserAsset[] }).items || []) {
        if (isMediaKind(String(a.kind || ''))) out.push(a);
      }
    }
    return out;
  }, [assetsQuery.data?.pages]);

  const assetDayGroups = useMemo(
    () => groupUserAssetsByDay(items, i18n.language, t),
    [items, i18n.language, t]
  );

  const loading = assetsQuery.isLoading;
  const loadingMore = assetsQuery.isFetchingNextPage;
  const hasMore = Boolean(assetsQuery.hasNextPage);

  useEffect(() => {
    if (assetsQuery.isError) {
      message.error(t('editor.assets.loadFail', { defaultValue: '资产加载失败' }));
    }
  }, [assetsQuery.isError, t]);

  const onCardActivate = (asset: UserAsset) => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    if (asset.kind === 'audio' || asset.kind === 'lottie') return;
    if (!String(asset.url || '').trim()) return;
    setPreview(asset);
  };

  const onCardDragStart = (e: ReactDragEvent<HTMLElement>, asset: UserAsset) => {
    const url = String(asset.url || '').trim();
    const uploadKey = String(asset.objectKey || '').trim();
    const lottieData =
      asset.kind === 'lottie'
        ? parseLottieAnimationData(asset.animationData ?? asset.meta?.animationData)
        : null;
    if (!isMediaKind(asset.kind) || (!url && !uploadKey && !lottieData)) {
      e.preventDefault();
      return;
    }
    draggedRef.current = true;
    const prompt = String(asset.prompt || '').trim();
    const duration = Number((asset.meta as { duration?: unknown } | null)?.duration);
    setMediaAssetDragData(e.dataTransfer, {
      kind: asset.kind,
      src: url,
      uploadKey: uploadKey || undefined,
      width: asset.width,
      height: asset.height,
      prompt: prompt || undefined,
      name: prompt.slice(0, 40) || undefined,
      duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
      ...(lottieData ? { animationData: lottieData } : {}),
    });
  };

  const emptyHint = searchQ
    ? t('editor.assets.searchEmpty', { defaultValue: '没有匹配的资产' })
    : t('editor.assets.empty');

  return (
    <>
      <div
        ref={rootRef}
        role="dialog"
        aria-label={t('editor.assets.panelTitle', { defaultValue: '资源' })}
        className={cn(
          'pointer-events-auto mb-2 flex shrink-0 flex-col overflow-hidden',
          'w-[min(680px,calc(100vw-2rem))] rounded-xl bg-[var(--surface)]',
          'shadow-[0_12px_40px_rgba(15,23,42,0.18)] ring-1 ring-[var(--line)]'
        )}
        style={{
          height: maxHeightPx && maxHeightPx > 0 ? Math.min(400, maxHeightPx) : 400,
          maxHeight: maxHeightPx && maxHeightPx > 0 ? maxHeightPx : undefined,
        }}
        data-asset-panel
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-[var(--line)] bg-[var(--surface)] px-4 pb-3 pt-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="min-w-0 truncate text-[15px] font-semibold leading-none text-[var(--ink)]">
              {t('editor.assets.panelTitle', { defaultValue: '资源' })}
            </h2>
            <button
              type="button"
              aria-label={t('editor.assets.close', { defaultValue: '关闭' })}
              onClick={onClose}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
            >
              <HiOutlineXMark className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
          <AssetKindFilterBar
            tabsNowrap
            activeTab={activeTab}
            onTabChange={setActiveTab}
            searchInput={searchInput}
            onSearchInputChange={setSearchInput}
          />
        </div>

        <div className="rcb-edge-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <InfiniteScrollSection
            loading={loading && items.length === 0}
            loadingMore={loadingMore}
            hasMore={hasMore}
            onLoadMore={() => {
              if (!loading && !loadingMore && hasMore) assetsQuery.fetchNextPage();
            }}
            isEmpty={items.length === 0}
            empty={<EmptyState hint={emptyHint} className="px-1.5 py-6 text-[12px]" />}
            gridClassName={ASSET_GRID_FLOW}
            skeleton={Array.from({ length: USER_ASSET_SKELETON_COUNT }, (_, i) => (
              <UserAssetCardSkeleton key={i} index={i} dense />
            ))}
          >
            <AssetDayGroupedGrid
              groups={assetDayGroups}
              renderItem={(asset) => (
                <UserAssetCard
                  key={asset.id}
                  asset={asset}
                  dense
                  editorMediaPreview
                  onActivate={onCardActivate}
                  onDragStart={isMediaKind(asset.kind) ? onCardDragStart : undefined}
                  onDragEnd={() => {
                    scheduleClearMediaAssetDragData(300);
                    draggedRef.current = false;
                  }}
                />
              )}
            />
          </InfiniteScrollSection>
        </div>
      </div>

      <UserAssetMediaPreview asset={preview} onClose={() => setPreview(null)} />
    </>
  );
}

export default memo(AssetPanel);
