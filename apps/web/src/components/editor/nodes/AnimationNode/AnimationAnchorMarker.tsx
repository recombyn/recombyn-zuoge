/**
 * Canvas marker for Animation workbench anchor preset.
 * World position = transform pivot (does not orbit when R changes).
 * Glyph stays screen-upright — never rotates with the node.
 */
import { memo, useMemo, type CSSProperties } from 'react';
import {
  RcbOverlayPortal,
  rcbSceneToScreen,
  useRcbCamera,
  useRcbDevicePixelRatio,
} from '@/components/rcb';
import {
  anchorPresetToFrac,
  parseAnchorPreset,
  type LottieAnchorPreset,
} from '@/components/editor/nodes/AnimationNode/animationFrameSync';

type SceneBox = { left: number; top: number; width: number; height: number };

type Props = {
  box: SceneBox;
  preset?: unknown;
  hidden?: boolean;
};

function AnimationAnchorMarker({ box, preset, hidden }: Props) {
  const camera = useRcbCamera();
  const dpr = useRcbDevicePixelRatio();
  const parsed: LottieAnchorPreset = parseAnchorPreset(preset);
  const { fx, fy } = useMemo(() => anchorPresetToFrac(parsed), [parsed]);

  if (hidden) return null;

  // Pivot in unrotated node box — same point `reapplySceneTransform` rotates about.
  const world = {
    x: box.left + box.width * fx,
    y: box.top + box.height * fy,
  };
  const screen = rcbSceneToScreen(camera, world.x, world.y, dpr);
  const style: CSSProperties = {
    position: 'absolute',
    left: screen.x,
    top: screen.y,
    transform: 'translate(-50%, -50%)',
    zIndex: 44,
    pointerEvents: 'none',
  };

  // Selection-blue crosshair (matches chrome), distinct from resize knobs.
  const stroke = '#3388ff';

  return (
    <RcbOverlayPortal>
      <div style={style} data-lottie-anchor-marker aria-hidden>
        <svg width="18" height="18" viewBox="0 0 18 18" className="overflow-visible">
          <circle cx="9" cy="9" r="3.25" fill="none" stroke={stroke} strokeWidth="1.5" />
          <path
            d="M9 1.5v3.5M9 13v3.5M1.5 9h3.5M13 9h3.5"
            fill="none"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="square"
          />
        </svg>
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(AnimationAnchorMarker);
