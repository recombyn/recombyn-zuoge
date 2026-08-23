import { useMemo, type CSSProperties, type ReactNode, memo } from 'react';
import { createPortal } from 'react-dom';
import { SoftGlowSurface } from '@/components/base';
import { useRcbCamera, rcbCameraCssZoom } from '@/components/rcb';
import { radiiFromAttrs } from '@/components/rcb/scene/document/sceneRadii';
import { readScenePaintLocalSize } from '@/components/rcb/scene/paint/sceneToSvg';
import type { SceneNodeInput } from '@/components/rcb/sceneNode';

const PILL_BOTTOM_PAD_PX = 14;

/**
 * SoftGlow + status pill for a node whose `attrs.processStatus === 'running'`.
 * Must portal into that node's paint `<g>` (owned by RcbShapeHost) so:
 * - drag preview (`previewSvgNodeGeometry`) moves glow with the plate
 * - clearing processStatus unmounts the host paint → SoftGlow goes with it
 */
export function NodeProcessGlow({
  nodeId,
  node,
  paintHost,
}: {
  nodeId: string;
  node: SceneNodeInput;
  paintHost: SVGElement;
}): ReactNode {
  const fallback = {
    width: Math.max(1, Number(node.width) || 1),
    height: Math.max(1, Number(node.height) || 1),
  };
  const { width, height } = readScenePaintLocalSize(paintHost, fallback);
  const radii = radiiFromAttrs(node.attrs || {});
  const borderRadius = `${radii.tl}px ${radii.tr}px ${radii.br}px ${radii.bl}px`;
  const camera = useRcbCamera();
  const z = Math.max(0.05, rcbCameraCssZoom(camera));
  const inv = 1 / z;
  const label = String(node.attrs?.processLabel || '处理中');

  const shellStyle = useMemo(
    (): CSSProperties => ({
      position: 'relative',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      borderRadius,
      pointerEvents: 'none',
      // Opaque base — semi-transparent SoftGlow must not reveal canvas ink below.
      background: '#D5DEE6',
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

  // Counter-scale the pill so typography stays screen-constant under camera zoom.
  const pillStyle = useMemo(
    (): CSSProperties => ({
      position: 'absolute',
      left: '50%',
      bottom: PILL_BOTTOM_PAD_PX * inv,
      transform: `translateX(-50%) scale(${inv})`,
      transformOrigin: 'center bottom',
    }),
    [inv]
  );

  return createPortal(
    <foreignObject
      data-rcb-process-glow={nodeId}
      width={width}
      height={height}
      x={0}
      y={0}
      style={{ overflow: 'hidden', pointerEvents: 'none' }}
    >
      <div style={shellStyle}>
        <SoftGlowSurface
          data-image-process-shimmer
          tone="random"
          seed={nodeId}
          className="absolute inset-0"
          style={shimmerStyle}
          aria-hidden
        />
        <div
          data-image-process-label
          className="absolute z-[1] whitespace-nowrap rounded-full bg-[rgba(55,55,55,0.72)] px-2.5 py-1 text-[11px] font-medium leading-none text-white shadow-[0_2px_8px_rgba(15,23,42,0.18)]"
          style={pillStyle}
        >
          {label}
        </div>
      </div>
    </foreignObject>,
    paintHost
  );
}

export default memo(NodeProcessGlow);
