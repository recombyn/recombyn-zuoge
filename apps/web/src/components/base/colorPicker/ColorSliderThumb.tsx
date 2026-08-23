import { memo } from 'react';

type Props = {
  /** 0–100 position along the track. */
  leftPct: number;
};

/**
 * High-contrast thumb for hue / alpha strips — visible on both light and saturated tracks.
 */
export const ColorSliderThumb = memo(({ leftPct }: Props) => (
  <div
    className="pointer-events-none absolute top-1/2 h-[14px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-[2px]"
    style={{
      left: `${leftPct}%`,
      background: '#3388ff',
      boxShadow: '0 0 0 2px #fff, 0 0 0 3px rgba(15, 23, 42, 0.4)',
    }}
  />
));

ColorSliderThumb.displayName = 'ColorSliderThumb';
