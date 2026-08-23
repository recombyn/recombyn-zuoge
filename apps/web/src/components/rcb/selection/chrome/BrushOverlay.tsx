/**
 * Marquee brush overlay on the screen overlay (ADR 0027).
 * Absolute scene coords under CameraTransform scale — stroke = px/zoom.
 */
import { useRcbCamera } from '@/components/rcb/camera/context';
import {
  CHROME_STROKE_PX,
  WorldSvgFrame,
  type SceneBox,
} from '../SelectionChrome';

const BRUSH_FILL = 'rgba(51,136,255,0.08)';
const BRUSH_STROKE = '#3388ff';

export default function BrushOverlay({ box }: { box: SceneBox | null }) {
  const camera = useRcbCamera();
  if (!box || !(box.width > 0) || !(box.height > 0)) return null;

  const z = Math.max(0.05, camera.zoom || 1);
  const stroke = CHROME_STROKE_PX / z;

  return (
    <WorldSvgFrame
      left={box.left}
      top={box.top}
      width={box.width}
      height={box.height}
      pad={stroke}
      zClass="z-[11]"
    >
      <rect
        x={box.left}
        y={box.top}
        width={Math.max(1, box.width)}
        height={Math.max(1, box.height)}
        fill={BRUSH_FILL}
        stroke={BRUSH_STROKE}
        strokeWidth={stroke}
      />
    </WorldSvgFrame>
  );
}
