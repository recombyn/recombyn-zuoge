import { useMemo, type CSSProperties, type ReactNode, memo } from 'react';
import { createPortal } from 'react-dom';
import { useRcbCamera, rcbCameraCssZoom } from '@/components/rcb';
import { radiiFromAttrs } from '@/components/rcb/scene/document/sceneRadii';
import { readScenePaintLocalSize } from '@/components/rcb/scene/paint/sceneToSvg';
import type { SceneNodeInput } from '@/components/rcb/sceneNode';
import { ProcessGlowShell } from '@/components/rcb/process/ProcessGlowShell';
import { processGlowForeignObjectBounds } from '@/components/rcb/process/processGlow';

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
  const foBox = processGlowForeignObjectBounds(width, height);
  const radii = radiiFromAttrs(node.attrs || {});
  const borderRadius = `${radii.tl}px ${radii.tr}px ${radii.br}px ${radii.bl}px`;
  const camera = useRcbCamera();
  const z = Math.max(0.05, rcbCameraCssZoom(camera));
  const label = String(node.attrs?.processLabel || '处理中');

  const foStyle = useMemo(
    (): CSSProperties => ({
      overflow: 'hidden',
      pointerEvents: 'none',
    }),
    []
  );

  return createPortal(
    <foreignObject
      data-rcb-process-glow={nodeId}
      width={foBox.width}
      height={foBox.height}
      x={foBox.x}
      y={foBox.y}
      style={foStyle}
    >
      <ProcessGlowShell
        seed={nodeId}
        label={label}
        width={width}
        zoom={z}
        borderRadius={borderRadius}
      />
    </foreignObject>,
    paintHost
  );
}

export default memo(NodeProcessGlow);
