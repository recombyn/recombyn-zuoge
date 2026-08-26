import { useMemo, type CSSProperties, type ReactNode, memo } from 'react';
import { SoftGlowSurface } from '@/components/base';
import { PROCESS_PILL_BOTTOM_PAD_PX, PROCESS_PILL_CLASS } from './processGlow';

export type ProcessGlowShellProps = {
  seed: string;
  label: string;
  /** Scene-local width for pill max-width (defaults to 120). */
  width?: number;
  /** Camera css zoom — counter-scales the status pill (default 1). */
  zoom?: number;
  borderRadius?: string;
  shimmerDataAttr?: string;
  labelDataAttr?: string;
  className?: string;
};

/**
 * Shared SoftGlow + status pill for canvas processing chrome (nodes + artboards).
 * Parent must size the shell (100% fill or explicit foreignObject bounds).
 */
export function ProcessGlowShell({
  seed,
  label,
  width = 120,
  zoom = 1,
  borderRadius = '0',
  shimmerDataAttr = 'data-image-process-shimmer',
  labelDataAttr = 'data-image-process-label',
  className,
}: ProcessGlowShellProps): ReactNode {
  const z = Math.max(0.05, zoom);
  const inv = 1 / z;
  const maxPillWidth = Math.max(32, width * z - 16);

  const shellStyle = useMemo(
    (): CSSProperties => ({
      position: 'relative',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      borderRadius,
      pointerEvents: 'none',
    }),
    [borderRadius]
  );

  const shimmerStyle = useMemo(
    (): CSSProperties => ({
      position: 'absolute',
      inset: 0,
      borderRadius,
    }),
    [borderRadius]
  );

  const pillStyle = useMemo(
    (): CSSProperties => ({
      left: '50%',
      bottom: PROCESS_PILL_BOTTOM_PAD_PX * inv,
      transform: `translateX(-50%) scale(${inv})`,
      transformOrigin: 'center bottom',
      maxWidth: maxPillWidth,
    }),
    [inv, maxPillWidth]
  );

  return (
    <div className={className} style={shellStyle}>
      <SoftGlowSurface
        {...{ [shimmerDataAttr]: true }}
        tone="canvas"
        seed={seed}
        className="absolute inset-0"
        style={shimmerStyle}
        data-rcb-process="1"
        aria-hidden
      />
      <div {...{ [labelDataAttr]: true }} className={PROCESS_PILL_CLASS} style={pillStyle}>
        {label}
      </div>
    </div>
  );
}

export default memo(ProcessGlowShell);
