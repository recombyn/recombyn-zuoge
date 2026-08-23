/**
 * Scene-geometry chrome pick must sit on the same lattice as rotate-L / knob ink.
 * SVG pe/GBR under camera scale(zoom) is not the source of truth.
 */
import { describe, expect, it } from 'vitest';
import {
  chromePaintMetrics,
  cornerLLocalBars,
  pickChromeHandleByGeometry,
} from '../SelectionChrome';

function outerLSample(
  corner: 'nw' | 'ne' | 'se' | 'sw',
  box: { left: number; top: number; width: number; height: number },
  zoom: number
) {
  const m = chromePaintMetrics(box.width, box.height, zoom, 0);
  const bars = cornerLLocalBars(corner, box.width, box.height, m.lArm, m.lThick, m.lClear);
  // Horizontal arm tip farthest from the white knob (avoid resize disc).
  const horiz = bars[0];
  const tipLocal =
    corner === 'ne' || corner === 'se'
      ? { x: horiz.x + Math.min(horiz.w * 0.12, m.lThick), y: horiz.y + horiz.h / 2 }
      : {
          x: horiz.x + horiz.w - Math.min(horiz.w * 0.12, m.lThick),
          y: horiz.y + horiz.h / 2,
        };
  return {
    m,
    bars,
    scene: { x: box.left + tipLocal.x, y: box.top + tipLocal.y },
  };
}

describe('pickChromeHandleByGeometry (ink lattice)', () => {
  const box = { left: 100, top: 50, width: 523, height: 683 };
  const zoom = 0.63; // same regime as DevTools stroke-width ≈ 1.5/zoom

  it('hits rotate on the painted NE L tip (outside resize disc)', () => {
    const { scene } = outerLSample('ne', box, zoom);
    const rot = pickChromeHandleByGeometry(scene.x, scene.y, {
      box,
      zoom,
      showHandles: true,
      showRotate: true,
    });
    expect(rot).toEqual(
      expect.objectContaining({ kind: 'rotate', corner: 'ne' })
    );
  });

  it('prefers corner resize over rotate when on the white knob center', () => {
    const pick = pickChromeHandleByGeometry(box.left + box.width, box.top, {
      box,
      zoom,
      showHandles: true,
      showRotate: true,
    });
    expect(pick).toEqual(
      expect.objectContaining({ kind: 'resize', handle: 'ne' })
    );
  });

  it('keeps L tip hit on ink after zoom changes (screen-constant arms)', () => {
    for (const z of [0.25, 0.63, 1, 4, 40]) {
      const { scene } = outerLSample('se', box, z);
      const pick = pickChromeHandleByGeometry(scene.x, scene.y, {
        box,
        zoom: z,
        showHandles: true,
        showRotate: true,
      });
      expect(pick?.kind).toBe('rotate');
      if (pick?.kind === 'rotate') expect(pick.corner).toBe('se');
    }
  });
});
