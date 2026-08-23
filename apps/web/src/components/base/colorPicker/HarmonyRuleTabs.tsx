import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/classnames';
import {
  HARMONY_RULES,
  harmonyRuleLabelKey,
  type ColorHarmonyRule,
} from './colorHarmony';

type Props = {
  value: ColorHarmonyRule;
  onChange: (rule: ColorHarmonyRule) => void;
};

function HarmonyIcon({ rule }: { rule: ColorHarmonyRule }) {
  const ring = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20';
  const dot = (cx: number, cy: number, r = 1.6) => (
    <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="currentColor" />
  );
  const line = (x1: number, y1: number, x2: number, y2: number) => (
    <line
      key={`${x1}-${y1}`}
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke="currentColor"
      strokeWidth="1.2"
    />
  );

  const center = 12;
  const nodes: Record<ColorHarmonyRule, React.ReactNode> = {
    custom: (
      <>
        {dot(8, 9)}
        {dot(14, 7)}
        {dot(16, 14)}
      </>
    ),
    analogous: (
      <>
        {line(center, center, 10, 6)}
        {line(center, center, 12, 5)}
        {line(center, center, 14, 6)}
        {line(center, center, 16, 8)}
        {line(center, center, 17, 11)}
        {dot(10, 6)}
        {dot(12, 5)}
        {dot(14, 6)}
        {dot(16, 8)}
        {dot(17, 11)}
      </>
    ),
    monochromatic: (
      <>
        {line(center, center, center, 4)}
        {line(center, center, center, 20)}
        {dot(center, 4)}
        {dot(center, 20)}
      </>
    ),
    complementary: (
      <>
        {line(center, center, center, 4)}
        {line(center, center, center, 20)}
        {dot(center, 4)}
        {dot(center, 20)}
      </>
    ),
    triad: (
      <>
        {line(center, center, center, 4)}
        {line(center, center, 18, 16)}
        {line(center, center, 6, 16)}
        {dot(center, 4)}
        {dot(18, 16)}
        {dot(6, 16)}
      </>
    ),
    square: (
      <>
        {line(center, center, center, 4)}
        {line(center, center, 20, center)}
        {line(center, center, center, 20)}
        {line(center, center, 4, center)}
        {dot(center, 4)}
        {dot(20, center)}
        {dot(center, 20)}
        {dot(4, center)}
      </>
    ),
    split: (
      <>
        {line(center, center, center, 4)}
        {line(center, center, 17, 15)}
        {line(center, center, 7, 15)}
        {dot(center, 4)}
        {dot(17, 15)}
        {dot(7, 15)}
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
      <path d={ring} fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
      {nodes[rule]}
    </svg>
  );
}

function HarmonyRuleTabs({ value, onChange }: Props) {
  const { t } = useTranslation();

  return (
    <div className="space-y-1.5">
      <p className="text-center text-[11px] text-[var(--muted)]">
        {t('editor.colorHarmony.label', { defaultValue: '色彩和谐' })}：
        {t(harmonyRuleLabelKey(value), { defaultValue: value })}
      </p>
      <div className="flex gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {HARMONY_RULES.map((rule) => {
          const active = rule === value;
          return (
            <button
              key={rule}
              type="button"
              title={t(harmonyRuleLabelKey(rule), { defaultValue: rule })}
              aria-label={t(harmonyRuleLabelKey(rule), { defaultValue: rule })}
              aria-pressed={active}
              onClick={() => onChange(rule)}
              className={cn(
                'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--ink)] transition-colors',
                active
                  ? 'ring-2 ring-[var(--ink)] ring-offset-1'
                  : 'hover:bg-[var(--accent-soft)]/80'
              )}
            >
              <HarmonyIcon rule={rule} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default memo(HarmonyRuleTabs);
