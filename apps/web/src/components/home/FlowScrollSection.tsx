import { Children, isValidElement, type ReactNode, memo } from 'react';
import { SoftGlowSurface } from '@/components/base';
import { cn } from '@/utils/classnames';
import {
  ScrollLoadFooter,
  useScrollLoadMore,
} from '@/components/home/InfiniteScroll';
import { useDeferredBusy } from '@/utils/useDeferredBusy';

export const FLOW_COLUMNS_CLASS =
  'grid w-full grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5';

/** Each card in a CSS-columns flow must avoid breaking across columns. */
export const FLOW_ITEM_CLASS = 'mb-5 break-inside-avoid';

export const FLOW_SKELETON_COUNT = 15;

const FLOW_SKELETON_ASPECTS = [
  'aspect-[3/4]',
  'aspect-[4/5]',
  'aspect-square',
  'aspect-[4/3]',
  'aspect-[5/6]',
] as const;

type FlowScrollSectionProps = {
  loading: boolean;
  loadingMore?: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  isEmpty?: boolean;
  empty?: ReactNode;
  /** Optional custom skeleton; defaults to plaza-style flow placeholders. */
  skeleton?: ReactNode;
  className?: string;
  /** Per call-site column breakpoints (Me vs Plaza differ). */
  columnsClassName?: string;
  children: ReactNode;
};

function flowItemClass(columnsClassName: string) {
  // Grid layouts use gap; CSS columns need per-item margin + break-inside.
  return columnsClassName.includes('grid') ? 'min-w-0' : FLOW_ITEM_CLASS;
}

/**
 * Scroll-load shell with CSS multi-column or grid flow layout.
 * Same loading / empty / sentinel pattern as {@link InfiniteScrollSection}
 * (including deferred skeleton via {@link useDeferredBusy}).
 */
function FlowScrollSection({
  loading,
  loadingMore = false,
  hasMore,
  onLoadMore,
  isEmpty = false,
  empty = null,
  skeleton,
  className,
  columnsClassName = FLOW_COLUMNS_CLASS,
  children,
}: FlowScrollSectionProps) {
  const showSkeleton = useDeferredBusy(loading);
  const blockLoadMore = loading || showSkeleton;
  const sentinelRef = useScrollLoadMore({
    hasMore,
    loading: blockLoadMore,
    loadingMore,
    onLoadMore,
  });
  const itemClass = flowItemClass(columnsClassName);

  if (showSkeleton) {
    return (
      <div className={cn(className)}>
        <div className={columnsClassName} aria-busy="true">
          {skeleton ?? <FlowFeedSkeleton itemClassName={itemClass} />}
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className={cn(className)} aria-busy="true" />;
  }

  if (isEmpty) {
    return <div className={cn(className)}>{empty}</div>;
  }

  return (
    <div className={cn(className)}>
      <div className={columnsClassName}>
        {Children.map(children, (child) => {
          if (!isValidElement(child)) return child;
          return (
            <div key={child.key ?? undefined} className={itemClass}>
              {child}
            </div>
          );
        })}
      </div>
      <ScrollLoadFooter
        sentinelRef={sentinelRef}
        hasMore={hasMore}
        loadingMore={loadingMore}
      />
    </div>
  );
}

/** Varied-aspect skeleton cards for plaza / liked flow feeds. */
function FlowFeedSkeleton({
  count = FLOW_SKELETON_COUNT,
  itemClassName = FLOW_ITEM_CLASS,
}: {
  count?: number;
  itemClassName?: string;
}) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={itemClassName} aria-busy="true">
          <SoftGlowSurface
            seed={i}
            className={cn(
              'w-full rounded-[8px] shadow-none',
              FLOW_SKELETON_ASPECTS[i % FLOW_SKELETON_ASPECTS.length]
            )}
            aria-hidden
          />
        </div>
      ))}
    </>
  );
}

/**
 * Cover frame for flow cards — height follows content aspect (not fixed 170px).
 */
export function plazaFlowThumbClass(extra?: string) {
  return cn(
    'relative w-full overflow-hidden rounded-[8px] border border-[var(--line)] bg-[var(--surface)]',
    'shadow-[0_2px_10px_rgba(15,23,42,0.06)] transition',
    'group-hover:shadow-[0_8px_22px_rgba(15,23,42,0.1)]',
    extra
  );
}

/** Prefer document page size for coverDocument aspect; fallback portrait. */
export function plazaCoverAspectStyle(document: unknown): { aspectRatio?: string } {
  if (!document || typeof document !== 'object') return { aspectRatio: '3 / 4' };
  const doc = document as {
    width?: unknown;
    height?: unknown;
    frames?: Array<{ width?: unknown; height?: unknown }>;
  };
  const frame = Array.isArray(doc.frames) ? doc.frames[0] : null;
  const w = Number(doc.width ?? frame?.width ?? 0);
  const h = Number(doc.height ?? frame?.height ?? 0);
  if (w > 0 && h > 0) return { aspectRatio: `${w} / ${h}` };
  return { aspectRatio: '3 / 4' };
}

const MemoizedFlowScrollSection = memo(FlowScrollSection);
export { MemoizedFlowScrollSection as FlowScrollSection };
const MemoizedFlowFeedSkeleton = memo(FlowFeedSkeleton);
export { MemoizedFlowFeedSkeleton as FlowFeedSkeleton };
