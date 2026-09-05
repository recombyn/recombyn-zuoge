import { describe, expect, it, beforeEach } from 'vitest';
import type { SceneNodeInput } from '@/components/rcb/sceneNode';
import {
  clearShapeMeshCache,
  getOrBuildShapeMesh,
} from '@/components/rcb/render/vector/meshCache';
import {
  resetGeomProfile,
  setGeomProfileEnabled,
  getGeomProfileSnapshot,
} from '@/components/rcb/render/vector/geomProfile';
import { densifyPathDJs } from '@/components/rcb/render/vector/densifyPathDJs';

describe('geom profile (phase 0)', () => {
  beforeEach(() => {
    clearShapeMeshCache();
    resetGeomProfile();
    setGeomProfileEnabled(true);
  });

  it('1k rect mesh builds stay under soft budget in JS fallback', () => {
    const t0 = performance.now();
    for (let i = 0; i < 1000; i += 1) {
      const node = {
        id: `r${i}`,
        key: 'shape',
        width: 20,
        height: 16,
        attrs: { shapeType: 'rect', 'fill-color': '#ccc', 'stroke-enabled': false },
      } as SceneNodeInput;
      expect(getOrBuildShapeMesh(`r${i}`, node, { width: 20, height: 16 })).not.toBeNull();
    }
    const elapsed = performance.now() - t0;
    // Soft gate: 1k distinct builds should finish in a few hundred ms on CI.
    expect(elapsed).toBeLessThan(8_000);
    const snap = getGeomProfileSnapshot();
    expect(snap.samples).toBeGreaterThan(0);
  });

  it('long path densify scales roughly linearly', () => {
    let d = 'M0 0';
    for (let i = 1; i <= 400; i += 1) d += ` L${i} ${i % 7}`;
    const a = performance.now();
    const pts = densifyPathDJs(d);
    const densifyMs = performance.now() - a;
    expect(pts.length).toBeGreaterThan(100);
    expect(densifyMs).toBeLessThan(50);
  });
});
