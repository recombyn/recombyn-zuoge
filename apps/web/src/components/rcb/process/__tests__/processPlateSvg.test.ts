import { describe, expect, it } from 'vitest';
import { createSvgRoot, svgEl } from '@/components/rcb/scene/paint/svgDom';
import {
  appendProcessPlatePaths,
  processPlateGradientIds,
  syncProcessPlateGeometry,
} from '../processPlateSvg';

describe('processPlateSvg', () => {
  it('creates gradient defs and three plate paths', () => {
    const { root } = createSvgRoot(200, 100);
    const g = svgEl('g');
    root.appendChild(g);
    appendProcessPlatePaths(g, root, 'node-a', 'M0 0 H100 V50 H0 Z', {
      color: '#c5d3e4',
      width: 1,
    });

    const ids = processPlateGradientIds('node-a');
    expect(root.querySelector(`#${ids.coreId}`)).toBeTruthy();
    expect(root.querySelector(`#${ids.softId}`)).toBeTruthy();
    expect(g.querySelectorAll('[data-process-plate-base]').length).toBe(1);
    expect(g.querySelectorAll('[data-process-plate-glow]').length).toBe(2);
  });

  it('syncProcessPlateGeometry updates all plate paths together', () => {
    const { root } = createSvgRoot(200, 100);
    const g = svgEl('g');
    root.appendChild(g);
    appendProcessPlatePaths(g, root, 'node-b', 'M0 0 H10 V10 H0 Z');

    syncProcessPlateGeometry(g, 'M0 0 H200 V100 H0 Z');
    const paths = Array.from(g.querySelectorAll('path')).map((p) => p.getAttribute('d'));
    expect(paths).toEqual(['M0 0 H200 V100 H0 Z', 'M0 0 H200 V100 H0 Z', 'M0 0 H200 V100 H0 Z']);
  });
});
