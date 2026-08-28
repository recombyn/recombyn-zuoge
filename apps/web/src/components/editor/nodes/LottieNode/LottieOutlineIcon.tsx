/**
 * LottieFiles mark: outline plate + solid S (same geometry as SiLottiefiles).
 */
import type { SVGProps } from 'react';

/** Outer rounded plate only (from SiLottiefiles). */
const PLATE_PATH =
  'M17.928 0H6.072A6.076 6.076 0 0 0 0 6.073v11.854A6.076 6.076 0 0 0 6.073 24h11.854A6.076 6.076 0 0 0 24 17.927V6.073A6.076 6.076 0 0 0 17.927 0Z';

/**
 * Inner S curve 鈥?absolute start = plate end (17.927,0) + relative m(1.42,7.013).
 * Filled solid (was the cutout in the brand badge).
 */
const CURVE_PATH =
  'M19.347 7.013a1.4 1.4 0 0 1-.26.39c-.11.11-.24.2-.39.26-.14.06-.3.09-.45.09-2.511 0-3.482 1.53-4.792 4.042l-.8 1.51c-1.231 2.382-2.762 5.323-6.894 5.323-.31 0-.62-.12-.84-.35a1.188 1.188 0 0 1 .84-2.031c2.511 0 3.482-1.53 4.792-4.042l.8-1.51c1.231-2.382 2.762-5.323 6.894-5.323q.24 0 .45.09c.14.06.27.15.39.26.11.11.2.24.26.39a1.17 1.17 0 0 1 0 .9Z';

type Props = SVGProps<SVGSVGElement> & {
  size?: number | string;
  strokeWidth?: number | string;
};

export function LottieOutlineIcon({
  size = '1em',
  strokeWidth = 1.5,
  className,
  style,
  ...rest
}: Props) {
  const sw = Number(strokeWidth) || 1.5;
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={style}
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      <path
        d={PLATE_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinejoin="round"
      />
      <path d={CURVE_PATH} fill="currentColor" stroke="none" />
    </svg>
  );
}

export default LottieOutlineIcon;
