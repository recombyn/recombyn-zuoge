import type { ReactNode } from 'react';
import { useMemo, useRef, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { HiChevronDown } from 'react-icons/hi2';
import { Dropdown, DropdownPanel, DropdownPanelItem } from '@/components/base';
import HomeAgentComposer, {
  type HomeAgentCategory,
  type HomeAgentSubmitPayload,
} from '@/components/home/HomeAgentComposer';
import { cn } from '@/utils/classnames';

type Props = {
  onSubmit: (payload: HomeAgentSubmitPayload) => void;
};

const CATEGORIES: Array<{
  id: HomeAgentCategory;
  labelKey: string;
}> = [
  { id: 'poster', labelKey: 'homeCategories.poster' },
  { id: 'mobile', labelKey: 'homeCategories.mobile' },
  { id: 'image', labelKey: 'homeCategories.image' },
  { id: 'video', labelKey: 'homeCategories.video' },
];

function resolveHeroLang(langRaw: string) {
  const lang = langRaw || '';
  const isZh = lang === 'zh-CN' || lang === 'zh-TW' || lang.startsWith('zh');
  const isJa = lang === 'ja' || lang.startsWith('ja');
  return { isZh, isJa };
}

/**
 * Home hero — category dropdown + tagline, soft-glow composer.
 */
function HomeHero({ onSubmit }: Props): ReactNode {
  const { t, i18n } = useTranslation();
  const [category, setCategory] = useState<HomeAgentCategory>('poster');
  const [categoryOpen, setCategoryOpen] = useState(false);
  const lastDesignCategoryRef = useRef<HomeAgentCategory>('poster');
  const { isZh, isJa } = resolveHeroLang(
    i18n.resolvedLanguage || i18n.language || ''
  );

  const setCategorySafe = (next: HomeAgentCategory) => {
    if (next !== 'image' && next !== 'video') lastDesignCategoryRef.current = next;
    setCategory(next);
    setCategoryOpen(false);
  };

  /** Composer Image / Video mode ↔ hero category. */
  const onComposerCategoryChange = (next: HomeAgentCategory) => {
    if (next === 'image' || next === 'video') {
      setCategory(next);
      return;
    }
    setCategorySafe(lastDesignCategoryRef.current || 'poster');
  };

  const activeCategory = useMemo(
    () => CATEGORIES.find((c) => c.id === category) || CATEGORIES[0]!,
    [category]
  );
  const categoryLabel = t(activeCategory.labelKey);

  return (
    <section className="relative mx-auto mb-8 flex w-full max-w-[820px] shrink-0 flex-col items-center self-center px-1 pb-2 pt-[160px] text-center sm:mb-12 md:mb-[65px] md:pt-[190px]">
      <div className="mb-8 flex w-full flex-col items-center">
        <h1
          className={cn(
            'inline-flex flex-wrap items-center justify-center gap-x-[0.35em] gap-y-2 font-semibold text-[var(--ink)]',
            'text-[26px] leading-[1.35] tracking-[-0.01em] sm:text-[30px]',
            (isZh || isJa) && 'tracking-[0.02em]'
          )}
          style={{ fontFamily: 'var(--font-hero)' }}
        >
          <span className="inline-flex flex-wrap items-center justify-center gap-x-[0.2em]">
            <span>{t('home.heroGeneratePrefix')}</span>
            <Dropdown
              trigger="click"
              placement="bottom"
              strategy="fixed"
              open={categoryOpen}
              onOpenChange={setCategoryOpen}
              items={[]}
              floatingClassName="z-[70]"
              referenceClassName="inline-flex"
              popupRender={() => (
                <DropdownPanel className="min-w-[9.5rem] p-1.5">
                  {CATEGORIES.map(({ id, labelKey }) => (
                    <DropdownPanelItem
                      key={id}
                      selected={category === id}
                      onClick={() => setCategorySafe(id)}
                    >
                      {t(labelKey)}
                    </DropdownPanelItem>
                  ))}
                </DropdownPanel>
              )}
            >
              <button
                type="button"
                aria-expanded={categoryOpen}
                aria-haspopup="listbox"
                aria-label={t('home.heroCategoryAria', { category: categoryLabel })}
                className={cn(
                  'inline-flex items-center gap-0.5 rounded-lg px-1 py-0.5 text-[var(--home-cta)] transition-colors',
                  'hover:bg-[color-mix(in_srgb,var(--home-cta)_10%,transparent)]',
                  categoryOpen && 'bg-[color-mix(in_srgb,var(--home-cta)_12%,transparent)]'
                )}
              >
                <span>{categoryLabel}</span>
                <HiChevronDown
                  className={cn(
                    'h-[0.7em] w-[0.7em] shrink-0 transition-transform',
                    categoryOpen && 'rotate-180'
                  )}
                  strokeWidth={2.25}
                  aria-hidden
                />
              </button>
            </Dropdown>
          </span>
          <span>{t('home.heroGenerateSuffix')}</span>
        </h1>
        <p
          className={cn(
            'mt-3 max-w-[36rem] text-[14px] leading-[1.55] text-[var(--muted)] sm:text-[15px]',
            (isZh || isJa) && 'tracking-[0.02em]'
          )}
          data-home-hero-subtitle=""
        >
          {t('home.heroSubtitle')}
        </p>
      </div>

      <div className="rcb-home-composer-glow relative mx-auto w-full max-w-[760px]">
        <div className="relative z-[1] text-left">
          <HomeAgentComposer
            category={category}
            onCategoryChange={onComposerCategoryChange}
            onSubmit={onSubmit}
          />
        </div>
      </div>
    </section>
  );
}

export default memo(HomeHero);
