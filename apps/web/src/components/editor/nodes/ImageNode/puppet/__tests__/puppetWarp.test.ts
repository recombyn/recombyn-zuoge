/**
 * Unit tests for puppet pin model + IDW warp field.
 */
import { describe, expect, it } from 'vitest';
import {
  isPuppetEnabled,
  nodeNeedsPuppetWarp,
  pinsHaveDisplacement,
  readPuppetPins,
  samplePuppetPinsAtFrame,
  upsertPuppetTrackKeyframe,
} from '@/components/editor/nodes/ImageNode/puppet/puppetModel';
import { buildPuppetWarpGrid, samplePinField } from '@/components/rcb/scene/paint/puppetWarp';

describe('puppetModel', () => {
  it('reads pins and density flags', () => {
    const attrs = {
      puppetEnabled: true,
      puppetPins: [
        { id: 'a', u: 0.2, v: 0.3, dx: 0.1, dy: -0.05 },
        { id: '', u: 0.5, v: 0.5 },
      ],
    };
    expect(isPuppetEnabled(attrs)).toBe(true);
    const pins = readPuppetPins(attrs);
    expect(pins).toHaveLength(1);
    expect(pins[0]!.dx).toBeCloseTo(0.1);
    expect(pinsHaveDisplacement(pins)).toBe(true);
    expect(nodeNeedsPuppetWarp({ key: 'image', attrs })).toBe(true);
    expect(nodeNeedsPuppetWarp({ key: 'shape', attrs })).toBe(false);
  });

  it('samples and upserts track keyframes', () => {
    const pins0 = [{ id: 'a', u: 0.5, v: 0.5, dx: 0, dy: 0 }];
    const pins10 = [{ id: 'a', u: 0.5, v: 0.5, dx: 0.2, dy: 0 }];
    let track = upsertPuppetTrackKeyframe([], 0, pins0);
    track = upsertPuppetTrackKeyframe(track, 10, pins10);
    const mid = samplePuppetPinsAtFrame({ puppetTrack: track, puppetPins: pins0 }, 5);
    expect(mid[0]!.dx).toBeCloseTo(0.1, 5);
  });
});

describe('puppetWarp', () => {
  it('IDW blends pin deltas by distance', () => {
    const pins = [
      { id: 'a', u: 0, v: 0, dx: 0.2, dy: 0 },
      { id: 'b', u: 1, v: 1, dx: 0, dy: 0 },
    ];
    const nearA = samplePinField(0, 0, pins);
    const nearB = samplePinField(1, 1, pins);
    expect(nearA.du).toBeGreaterThan(nearB.du);
    expect(nearA.du).toBeCloseTo(0.2, 1);
  });

  it('builds a dense dest grid from pins', () => {
    const pins = [{ id: 'a', u: 0.25, v: 0.25, dx: 0.1, dy: 0.05 }];
    const grid = buildPuppetWarpGrid(pins, 4);
    expect(grid.density).toBe(4);
    expect(grid.restUv.length).toBe(5 * 5 * 2);
    expect(grid.destUv.length).toBe(grid.restUv.length);
  });
});
