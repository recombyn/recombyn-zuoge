import { useMemo, type CSSProperties, type ReactNode, memo } from 'react';
import { PROCESS_PILL_BOTTOM_PAD_PX, PROCESS_PILL_CLASS } from './processGlow';

export type ProcessGlowShellProps = {
  seed: string;
  label: string;
  /** Scene-local width for pill max-width (defaults to 120). */
  width?: number;
  /** Camera css zoom — counter-scales the status pill (default 1). */
  zoom?: number;
  borderRadius?: string;
  labelDataAttr?: string;
  className?: string;
};

/**
 * Status pill for canvas processing chrome (nodes + artboards).
 * Gradient bloom is painted in SVG — this shell is label-only.
 */
export function ProcessGlowShell({
  label,
  width = 120,
  zoom = 1,
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
      pointerEvents: 'none',
    }),
    []
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
      <div {...{ [labelDataAttr]: true }} className={PROCESS_PILL_CLASS} style={pillStyle}>
        {label}
      </div>
    </div>
  );
}

export default memo(ProcessGlowShell);
