import { useMemo, type CSSProperties, type ReactNode, memo } from 'react';
import {
  PROCESS_GLOW_BLEED_PX,
  PROCESS_PILL_BOTTOM_PAD_PX,
  PROCESS_PILL_CLASS,
} from './processGlow';

export type ProcessGlowShellProps = {
  seed: string;
  label: string;
  /** Scene-local plate width for pill max-width (defaults to 120). */
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
 *
 * The parent foreignObject is oversized by {@link PROCESS_GLOW_BLEED_PX} for
 * gradient AA. The label is inset to the plate AABB and clipped so tips like
 *「上传中」never spill outside the node (bleed used to sit under `bottom`,
 * and at high zoom that gap became a large screen offset).
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
  const bleed = PROCESS_GLOW_BLEED_PX;
  const plateW = Math.max(1, Number(width) || 1);
  const maxPillWidth = Math.max(24, plateW * z - 16);

  const outerStyle = useMemo(
    (): CSSProperties => ({
      position: 'relative',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      pointerEvents: 'none',
    }),
    []
  );

  // Plate-sized clip box inside the bled foreignObject.
  const plateStyle = useMemo(
    (): CSSProperties => ({
      position: 'absolute',
      left: bleed,
      top: bleed,
      right: bleed,
      bottom: bleed,
      overflow: 'hidden',
      pointerEvents: 'none',
    }),
    [bleed]
  );

  const pillStyle = useMemo(
    (): CSSProperties => ({
      left: '50%',
      // Pad from the plate bottom (not the bled FO bottom).
      bottom: PROCESS_PILL_BOTTOM_PAD_PX * inv,
      transform: `translateX(-50%) scale(${inv})`,
      transformOrigin: 'center bottom',
      maxWidth: maxPillWidth,
    }),
    [inv, maxPillWidth]
  );

  return (
    <div className={className} style={outerStyle}>
      <div style={plateStyle}>
        <div {...{ [labelDataAttr]: true }} className={PROCESS_PILL_CLASS} style={pillStyle}>
          {label}
        </div>
      </div>
    </div>
  );
}

export default memo(ProcessGlowShell);
