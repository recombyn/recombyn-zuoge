/**
 * Animation board tool icon — LottieFiles-style S curve only (no outer plate).
 */
import type { SVGProps } from 'react';

/**
 * Inner S curve from SiLottiefiles geometry (absolute coords in 24×24).
 * Filled solid; outer rounded plate intentionally omitted.
 */
const CURVE_PATH =
  'M19.347 7.013a1.4 1.4 0 0 1-.26.39c-.11.11-.24.2-.39.26-.14.06-.3.09-.45.09-2.511 0-3.482 1.53-4.792 4.042l-.8 1.51c-1.231 2.382-2.762 5.323-6.894 5.323-.31 0-.62-.12-.84-.35a1.188 1.188 0 0 1 .84-2.031c2.511 0 3.482-1.53 4.792-4.042l.8-1.51c1.231-2.382 2.762-5.323 6.894-5.323q.24 0 .45.09c.14.06.27.15.39.26.11.11.2.24.26.39a1.17 1.17 0 0 1 0 .9Z';

type Props = SVGProps<SVGSVGElement> & {
  size?: number | string;
  /** Kept for ToolIcon API parity; curve is fill-only. */
  strokeWidth?: number | string;
};

export function AnimationOutlineIcon({
  size = '1em',
  className,
  style,
  strokeWidth: _strokeWidth,
  ...rest
}: Props) {
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
      <path d={CURVE_PATH} fill="currentColor" stroke="none" />
    </svg>
  );
}

export default AnimationOutlineIcon;
