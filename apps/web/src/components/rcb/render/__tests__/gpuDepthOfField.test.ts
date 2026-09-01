import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createEmptyDocument, addNodeToDocument } from '@/components/rcb/scene/document/sceneDocument';
import {
  buildNormalizedDepthLookup,
  circleOfConfusionPx,
  getGpuDepthOfFieldParams,
  gpuDofSkipsSoaTileBake,
  resetGpuDepthOfFieldParams,
  resolveGpuDofBackend,
  setGpuDepthOfFieldParams,
  shouldRunGpuDepthOfField,
  subscribeGpuDepthOfField,
} from '../gpuDepthOfField';

describe('gpuDepthOfField', () => {
  beforeEach(() => {
    resetGpuDepthOfFieldParams();
  });

  it('circleOfConfusionPx peaks at focal mismatch', () => {
    const params = { focalDepth: 0.5, aperture: 1, maxCoCPx: 20 };
    expect(circleOfConfusionPx(0.5, params)).toBe(0);
    expect(circleOfConfusionPx(0, params)).toBe(10);
    expect(circleOfConfusionPx(1, params)).toBe(10);
  });

  it('buildNormalizedDepthLookup orders stack z to [0,1]', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'back', {
      id: 'back',
      key: 'shape',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      attrs: { shapeType: 'rect' },
      children: [],
    });
    doc = addNodeToDocument(doc, 'front', {
      id: 'front',
      key: 'shape',
      x: 20,
      y: 0,
      width: 10,
      height: 10,
      attrs: { shapeType: 'rect' },
      children: [],
    });
    const lookup = buildNormalizedDepthLookup(doc, ['back', 'front']);
    expect(lookup.depthForId('back')).toBeLessThan(lookup.depthForId('front'));
  });

  it('gpuDofSkipsSoaTileBake follows enabled flag', () => {
    expect(gpuDofSkipsSoaTileBake()).toBe(false);
    setGpuDepthOfFieldParams({ enabled: true });
    expect(shouldRunGpuDepthOfField()).toBe(
      String(import.meta.env.VITE_GPU_DOF ?? '').toLowerCase() === '1' ||
        String(import.meta.env.VITE_GPU_DOF ?? '').toLowerCase() === 'true' ||
        String(import.meta.env.VITE_GPU_DOF ?? '').toLowerCase() === 'on'
    );
  });

  it('setGpuDepthOfFieldParams merges and clamps', () => {
    setGpuDepthOfFieldParams({ focalDepth: 0.3, maxCoCPx: 16 });
    expect(getGpuDepthOfFieldParams().focalDepth).toBe(0.3);
    expect(getGpuDepthOfFieldParams().maxCoCPx).toBe(16);
    expect(getGpuDepthOfFieldParams().aperture).toBe(1);
    setGpuDepthOfFieldParams({ focalDepth: 9, aperture: -1, maxCoCPx: 999 });
    expect(getGpuDepthOfFieldParams().focalDepth).toBe(1);
    expect(getGpuDepthOfFieldParams().aperture).toBe(0);
    expect(getGpuDepthOfFieldParams().maxCoCPx).toBe(64);
  });

  it('subscribeGpuDepthOfField fires on set', () => {
    const spy = vi.fn();
    const unsub = subscribeGpuDepthOfField(spy);
    setGpuDepthOfFieldParams({ aperture: 1.5 });
    expect(spy).toHaveBeenCalled();
    unsub();
    setGpuDepthOfFieldParams({ aperture: 1.6 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('resolveGpuDofBackend is null when DOF off', () => {
    setGpuDepthOfFieldParams({ enabled: false });
    expect(resolveGpuDofBackend()).toBe(null);
  });
});
