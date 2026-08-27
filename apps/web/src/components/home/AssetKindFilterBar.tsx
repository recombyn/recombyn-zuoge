import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineMagnifyingGlass } from 'react-icons/hi2';
import SegmentTabs from '@/components/home/SegmentTabs';
import { cn } from '@/utils/classnames';

export type AssetTabKind = 'all' | 'image' | 'video' | 'audio' | 'lottie';

const KIND_TABS: { id: AssetTabKind; labelKey: string; fallback: string }[] = [
  { id: 'all', labelKey: 'editor.assets.kind.all', fallback: '全部' },
  { id: 'image', labelKey: 'editor.assets.kind.image', fallback: '图片' },
  { id: 'video', labelKey: 'editor.assets.kind.video', fallback: '视频' },
  { id: 'audio', labelKey: 'editor.assets.kind.audio', fallback: '音频' },
  { id: 'lottie', labelKey: 'editor.assets.kind.lottie', fallback: '动效' },
];

const CHIP_FILL = 'bg-[color-mix(in_srgb,var(--ink)_8%,var(--surface))]';
const CHIP_HOVER = 'hover:bg-[color-mix(in_srgb,var(--ink)_12%,var(--surface))]';

type Props = {
  activeTab: AssetTabKind;
  onTabChange: (tab: AssetTabKind) => void;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  /** Editor panel — keep kind chips on one row. */
  tabsNowrap?: boolean;
  className?: string;
};

function AssetKindFilterBar({
  activeTab,
  onTabChange,
  searchInput,
  onSearchInputChange,
  tabsNowrap = false,
  className,
}: Props): ReactNode {
  const { t } = useTranslation();
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const hasQuery = searchInput.trim().length > 0;
  const expanded = searchOpen || hasQuery;
  const searchLabel = t('editor.assets.searchPlaceholder', {
    defaultValue: '请输入提示词关键词…',
  });

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return undefined;
    const closeIfOutside = (e: PointerEvent) => {
      if (searchRef.current?.contains(e.target as Node)) return;
      if (!hasQuery) setSearchOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !hasQuery) setSearchOpen(false);
    };
    window.addEventListener('pointerdown', closeIfOutside, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', closeIfOutside, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [searchOpen, hasQuery]);

  return (
    <div className={cn('flex w-full items-center justify-between gap-2', className)}>
      <SegmentTabs
        variant="chips"
        size="sm"
        nowrap={tabsNowrap}
        aria-label={t('editor.assets.filterByKind', { defaultValue: '按类型筛选' })}
        tabs={KIND_TABS.map((tab) => ({
          id: tab.id,
          label: t(tab.labelKey, { defaultValue: tab.fallback }),
        }))}
        value={activeTab}
        onChange={onTabChange}
      />

      <div
        ref={searchRef}
        className={cn(
          'relative shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
          expanded ? 'w-[250px]' : 'w-9'
        )}
      >
        {!expanded ? (
          <button
            type="button"
            aria-label={searchLabel}
            onClick={() => setSearchOpen(true)}
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:text-[var(--ink)]',
              CHIP_FILL,
              CHIP_HOVER,
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--accent)_28%,transparent)]'
            )}
          >
            <HiOutlineMagnifyingGlass className="h-4 w-4" strokeWidth={1.75} />
          </button>
        ) : (
          <>
            <HiOutlineMagnifyingGlass
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"
              aria-hidden
            />
            <input
              ref={inputRef}
              type="search"
              value={searchInput}
              onChange={(e) => onSearchInputChange(e.target.value)}
              placeholder={searchLabel}
              className={cn(
                'h-9 w-full rounded-lg border-0 pl-9 pr-3 text-[13px] text-[var(--ink)] placeholder:text-[var(--muted)] outline-none focus:border-0 focus:outline-none focus:ring-0',
                CHIP_FILL
              )}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default memo(AssetKindFilterBar);
