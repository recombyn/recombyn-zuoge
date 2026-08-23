import { memo } from 'react';

type Props = {
  /** 0–100 position along the track. */
  leftPct: number;
};

/** Thin theme-colored tick for hue / alpha strips. */
export const ColorSliderThumb = memo(({ leftPct }: Props) => (
  <div
    className="pointer-events-none absolute top-0 h-full w-[2px] -translate-x-1/2 rounded-[1px]"
    style={{
      left: `${leftPct}%`,
      background: 'var(--ink)',
      boxShadow: '0 0 0 1px #fff, 0 0 0 2px color-mix(in srgb, var(--ink) 18%, transparent)',
    }}
  />
));

ColorSliderThumb.displayName = 'ColorSliderThumb';
