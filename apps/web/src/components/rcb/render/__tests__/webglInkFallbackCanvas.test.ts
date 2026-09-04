import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  resetSoaWebglInkShaderProbeForTests,
  soaWebglInkShadersOk,
} from '../webglSceneRenderer';
import { createSceneRenderer } from '../sceneRenderer';
import { setSoaCanvasShapesEnabledForTests } from '../sceneRenderBuffer';
import { createEmptyDocument } from '@/components/rcb/scene/document/sceneDocument';

describe('webgl ink fallback without tainting stage canvas', () => {
  beforeEach(() => {
    resetSoaWebglInkShaderProbeForTests();
    setSoaCanvasShapesEnabledForTests(true);
  });
  afterEach(() => {
    resetSoaWebglInkShaderProbeForTests();
    setSoaCanvasShapesEnabledForTests(null);
  });

  it('soaWebglInkShadersOk runs on a probe canvas (does not throw)', () => {
    // happy-dom / jsdom may lack WebGL2 — either true or false is fine.
    expect(typeof soaWebglInkShadersOk()).toBe('boolean');
  });

  it('createSceneRenderer(webgl) yields a working renderer without poisoning 2d', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const renderer = createSceneRenderer('webgl', {
      canvas,
      getDocument: () => createEmptyDocument({ emptyWorld: true }),
      getZoom: () => 1,
      listNodeIds: () => [],
      getNodeBox: () => null,
      paintGrid: false,
      drawCanvasIdle: true,
    });
    expect(renderer).toBeTruthy();
    expect(renderer.backend === 'webgl' || renderer.backend === 'canvas2d').toBe(true);
    // Critical: fallback must not have claimed webgl2 on the stage canvas.
    if (renderer.backend === 'canvas2d') {
      expect(canvas.getContext('webgl2')).toBeNull();
    }
    renderer.dispose();
  });
});
