/**
 * Path-edit anchors: scene AABB registry via pickChromeKnobHit (ADR 0027).
 * No HTML hit-pad DOM for pen-edit knobs.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  clearChromeHitPads,
  clearChromeKnobHits,
  pickChromeKnobHit,
  setChromeKnobHits,
} from '../../selection/SelectionChrome';
import { rcbCameraCssZoom } from '@/components/rcb/core/math';

describe('path-edit knob geometry hit (no HTML pads)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    clearChromeHitPads('pen-edit:n1');
    clearChromeKnobHits('pen-edit:n1');
  });
  afterEach(() => {
    clearChromeHitPads('pen-edit:n1');
    clearChromeKnobHits('pen-edit:n1');
    document.body.innerHTML = '';
  });

  it('pickChromeKnobHit hits pen-anchor AABB at extreme zoom', () => {
    const camera = { x: 10, y: -4, zoom: 74.43 };
    const z = rcbCameraCssZoom(camera);
    const ax = 33.0;
    const ay = 44.0;
    const half = 24 / (2 * z);
    setChromeKnobHits('pen-edit:n1', [
      {
        ownerId: 'pen-edit:n1',
        kind: 'pen-anchor',
        key: 'pen-anchor-0-0',
        x: ax,
        y: ay,
        half,
      },
    ]);
    const hit = pickChromeKnobHit(ax, ay);
    expect(hit?.kind).toBe('pen-anchor');
    if (hit?.kind === 'pen-anchor') {
      expect(hit.sub).toBe(0);
      expect(hit.index).toBe(0);
    }
    expect(pickChromeKnobHit(ax + half + 0.01, ay)).toBeNull();
  });

  it('does not rely on HTML pads under overlay for pen-edit', () => {
    setChromeKnobHits('pen-edit:n1', [
      {
        ownerId: 'pen-edit:n1',
        kind: 'pen-handle',
        key: 'pen-handle-0-1-out',
        x: 10,
        y: 20,
        half: 2,
      },
    ]);
    expect(document.querySelectorAll('[data-rcb-hit-pad]').length).toBe(0);
    expect(pickChromeKnobHit(10, 20)?.kind).toBe('pen-handle');
  });
});
