import type { ReactNode } from 'react';
import { useMemo, useRef, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import HomeAgentComposer, {
  type HomeAgentCategory,
  type HomeAgentComposerHandle,
  type HomeAgentSubmitPayload,
  exampleChipKeysForCategory,
} from '@/components/home/HomeAgentComposer';

type Props = {
  onSubmit: (payload: HomeAgentSubmitPayload) => void;
};

function caseCategoryFor(category: HomeAgentCategory): HomeAgentCategory {
  if (category === 'image' || category === 'video') return category;
  return 'poster';
}

/** Home hero — centered prompt, composer with mode picker, case cards. */
function HomeHero({ onSubmit }: Props): ReactNode {
  const { t } = useTranslation();
  const composerRef = useRef<HomeAgentComposerHandle | null>(null);
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

  const caseKeys = useMemo(
    () => exampleChipKeysForCategory(caseCategoryFor(category)),
    [category]
  );

  const casePrompt = (chipKey: string) => {
    const long = t(`home.casePrompts.${chipKey}`, { defaultValue: '' });
    if (long && !long.startsWith('home.casePrompts.')) return long;
    return t(`home.chipPrompts.${chipKey}`);
  };

  return (
    <section className="home-hero-chat relative mx-auto flex w-full max-w-[820px] flex-col items-center">
      <h1 className="mb-8 text-center text-[clamp(1.5rem,4vw,1.875rem)] font-normal tracking-[-0.02em] text-[var(--ink)]">
        {t('home.heroStartTitle')}
      </h1>

      <div className="home-hero-chat__composer w-full">
        <HomeAgentComposer
          ref={composerRef}
          category={category}
          onCategoryChange={onComposerCategoryChange}
          onSubmit={onSubmit}
          className="rounded-[18px] !ring-0 focus-within:!ring-0"
        />
      </div>

      <div className="mt-5 grid w-full grid-cols-3 gap-2.5">
        {caseKeys.map((chipKey) => (
          <button
            key={`${category}:${chipKey}`}
            type="button"
            onClick={() => composerRef.current?.applyExampleChip(chipKey)}
            className="home-hero-chat__case"
          >
            <span className="line-clamp-[8]">{casePrompt(chipKey)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default memo(HomeHero);
