/**
 * Hit-pad placement on the screen overlay (ADR 0027):
 * left/top = worldToScreen(scene); size = screenPx (no 1/zoom).
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  placeHitPadAtScene,
  RCB_HIT_SCENE_X_ATTR,
  RCB_HIT_SCENE_Y_ATTR,
  RCB_HIT_SIZE_ATTR,
} from '../SelectionChrome';
import { rcbSceneToScreen } from '@/components/rcb/core/math';

describe('placeHitPadAtScene (overlay screen space)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('sets left/top via worldToScreen — camera pan/zoom baked in', () => {
    const layer = document.createElement('div');
    document.body.appendChild(layer);
    const pad = document.createElement('div');
    layer.appendChild(pad);

    const camera = { x: 12.3, y: -40.7, zoom: 2.5 };
    expect(placeHitPadAtScene(pad, 100, 80, 16, camera, layer, 1)).toBe(true);

    const screen = rcbSceneToScreen(camera, 100, 80, 1);
    expect(pad.style.left).toBe(`${screen.x}px`);
    expect(pad.style.top).toBe(`${screen.y}px`);
    expect(pad.style.width).toBe('16px');
    expect(pad.style.height).toBe('16px');
    expect(pad.style.transform).toBe('translate(-50%, -50%)');
    expect(pad.getAttribute(RCB_HIT_SCENE_X_ATTR)).toBe('100');
    expect(pad.getAttribute(RCB_HIT_SCENE_Y_ATTR)).toBe('80');
    expect(pad.getAttribute(RCB_HIT_SIZE_ATTR)).toBe('16');
  });

  it('keeps screen-px size constant at extreme zoom (no 1/zoom)', () => {
    const layer = document.createElement('div');
    document.body.appendChild(layer);
    const pad = document.createElement('div');
    layer.appendChild(pad);

    const camera = { x: -5000, y: -3000, zoom: 100 };
    expect(placeHitPadAtScene(pad, 52.5, 41.25, 8, camera, layer, 1)).toBe(true);

    const screen = rcbSceneToScreen(camera, 52.5, 41.25, 1);
    expect(pad.style.left).toBe(`${screen.x}px`);
    expect(pad.style.top).toBe(`${screen.y}px`);
    expect(Number(pad.style.width.replace('px', ''))).toBeCloseTo(8, 5);
  });
});
