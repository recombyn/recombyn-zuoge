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

  it('VS and FS declare the same float precision for shared uZoom', () => {
    // ANGLE rejects link when VS defaults highp and FS uses mediump for uZoom.
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.join(__dirname, '../webglSceneRenderer.ts');
    const text = fs.readFileSync(file, 'utf8');
    const vsBlock = text.slice(text.indexOf('const VS ='), text.indexOf('const FS ='));
    const fsBlock = text.slice(text.indexOf('const FS ='), text.indexOf('const UNIT_QUAD'));
    expect(vsBlock).toMatch(/precision\s+mediump\s+float\s*;/);
    expect(fsBlock).toMatch(/precision\s+mediump\s+float\s*;/);
    expect(vsBlock).toMatch(/uniform\s+float\s+uZoom\s*;/);
    expect(fsBlock).toMatch(/uniform\s+float\s+uZoom\s*;/);
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
