import { describe, expect, it, beforeEach } from 'vitest';
import type { SceneNodeInput } from '@/components/rcb/sceneNode';
import {
  clearShapeMeshCache,
  getOrBuildShapeMesh,
  getShapeMeshCacheSize,
} from '@/components/rcb/render/vector/meshCache';

describe('scaleMeshCache', () => {
  beforeEach(() => {
    clearShapeMeshCache();
  });

  it('builds 10k distinct ids then reuses cached meshes', () => {
    const N = 10_000;
    for (let i = 0; i < N; i += 1) {
      const id = `n${i}`;
      const node = {
        id,
        key: 'shape',
        width: 20 + (i % 50),
        height: 16 + (i % 40),
        attrs: {
          shapeType: i % 3 === 0 ? 'ellipse' : 'rect',
          'fill-color': '#abc',
          'stroke-enabled': false,
        },
      } as SceneNodeInput;
      const mesh = getOrBuildShapeMesh(id, node, {
        width: Number(node.width),
        height: Number(node.height),
      });
      expect(mesh).not.toBeNull();
    }
    // LRU max is 4096 — cache stays capped.
    expect(getShapeMeshCacheSize()).toBeLessThanOrEqual(4096);
    expect(getShapeMeshCacheSize()).toBeGreaterThan(1000);

    // Reuse last batch — should hit cache without growing past max.
    const before = getShapeMeshCacheSize();
    for (let i = N - 500; i < N; i += 1) {
      const id = `n${i}`;
      const node = {
        id,
        key: 'shape',
        width: 20 + (i % 50),
        height: 16 + (i % 40),
        attrs: {
          shapeType: i % 3 === 0 ? 'ellipse' : 'rect',
          'fill-color': '#abc',
          'stroke-enabled': false,
        },
      } as SceneNodeInput;
      const a = getOrBuildShapeMesh(id, node, {
        width: Number(node.width),
        height: Number(node.height),
      });
      const b = getOrBuildShapeMesh(id, node, {
        width: Number(node.width),
        height: Number(node.height),
      });
      expect(a).toBe(b);
    }
    expect(getShapeMeshCacheSize()).toBeLessThanOrEqual(Math.max(before, 4096));
  });
});
