import type { ReactNode } from 'react';
import { useRef, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ZuogeWordmarkSvg,
  ZUOGE_WORDMARK_EN_ASPECT,
} from '@/components/base/AppBrandWordmark';
import HomeAgentComposer, {
  type HomeAgentCategory,
  type HomeAgentSubmitPayload,
} from '@/components/home/HomeAgentComposer';

type Props = {
  onSubmit: (payload: HomeAgentSubmitPayload) => void;
};

/** Home hero — Latin `zuoge` graphic + localized slogan. */
function HomeHero({ onSubmit }: Props): ReactNode {
  const { t } = useTranslation();
  const [category, setCategory] = useState<HomeAgentCategory>('poster');
  const lastDesignCategoryRef = useRef<HomeAgentCategory>('poster');

  const onComposerCategoryChange = (next: HomeAgentCategory) => {
    if (next === 'image' || next === 'video') {
      setCategory(next);
      return;
    }
    setCategorySafe(lastDesignCategoryRef.current || 'poster');
  };

  const setCategorySafe = (next: HomeAgentCategory) => {
    if (next !== 'image' && next !== 'video') lastDesignCategoryRef.current = next;
    setCategory(next);
  };

  return (
    <section className="home-hero-chat relative mx-auto flex w-full max-w-[820px] flex-col items-center">
      <h1
        className="mb-8 flex items-baseline justify-center gap-1.5 text-center text-[clamp(1.5rem,4vw,1.875rem)] font-normal tracking-[-0.02em] text-[var(--ink)]"
        aria-label={t('home.heroStartTitleAria')}
      >
        <span
          className="app-brand-wordmark-cjk inline-block shrink-0 self-center text-[var(--ink)]"
          style={{
            height: 'calc(1em - 6px)',
            width: `calc((1em - 6px) * ${ZUOGE_WORDMARK_EN_ASPECT})`,
          }}
        >
          <ZuogeWordmarkSvg height="100%" />
        </span>
        <span>{t('home.heroStartTitle')}</span>
      </h1>

      <div className="home-hero-chat__composer w-full">
        <HomeAgentComposer
          category={category}
          onCategoryChange={onComposerCategoryChange}
          onSubmit={onSubmit}
          className="!ring-0 focus-within:!ring-0"
        />
      </div>
    </section>
  );
}

export default memo(HomeHero);
