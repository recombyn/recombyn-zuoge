import { describe, expect, it, beforeEach } from 'vitest';
import {
  __setWasmGeomApiForTests,
  booleanPolygonsWasm,
  setWasmGeomForceJs,
  getWasmGeomBackend,
} from '@/components/rcb/render/vector/wasmGeom';
import { densifyPathDJs } from '@/components/rcb/render/vector/densifyPathDJs';

describe('booleanPolygonsWasm', () => {
  beforeEach(() => {
    __setWasmGeomApiForTests(null);
    setWasmGeomForceJs(false);
  });

  it('returns null when wasm is missing (JS fallback path)', () => {
    expect(getWasmGeomBackend()).toBe('js');
    expect(
      booleanPolygonsWasm('union', [
        [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
            [0, 0],
          ],
        ],
        [
          [
            [1, 1],
            [3, 1],
            [3, 3],
            [1, 3],
            [1, 1],
          ],
        ],
      ])
    ).toBeNull();
  });

  it('decodes mock wasm union into a multipolygon', () => {
    __setWasmGeomApiForTests({
      densify_path_d: (d) => {
        const pts = densifyPathDJs(d);
        const flat = new Float32Array(pts.length * 2);
        pts.forEach((p, i) => {
          flat[i * 2] = p.x;
          flat[i * 2 + 1] = p.y;
        });
        return flat;
      },
      tessellate_fill: () => new Float32Array(0),
      tessellate_fill_with_holes: () => new Float32Array(0),
      tessellate_stroke: () => new Float32Array(0),
      tessellate_batch_fill: () => new Float32Array(0),
      // Echo a fixed union square [0,0]-[3,3]
      boolean_polygons: () =>
        new Float32Array([
          1, // polyCount
          1, // ringCount
          4, // verts
          0, 0, 3, 0, 3, 3, 0, 3,
        ]),
    });
    expect(getWasmGeomBackend()).toBe('wasm');
    const mp = booleanPolygonsWasm('union', [
      [[[0, 0], [2, 0], [2, 2], [0, 2]]],
      [[[1, 1], [3, 1], [3, 3], [1, 3]]],
    ]);
    expect(mp).not.toBeNull();
    expect(mp!.length).toBe(1);
    expect(mp![0]![0]!.length).toBeGreaterThanOrEqual(4);
    expect(mp![0]![0]![0]).toEqual([0, 0]);
  });

  it('decodes mock wasm empty success ([0]) as []', () => {
    __setWasmGeomApiForTests({
      densify_path_d: () => new Float32Array(0),
      tessellate_fill: () => new Float32Array(0),
      tessellate_fill_with_holes: () => new Float32Array(0),
      tessellate_stroke: () => new Float32Array(0),
      tessellate_batch_fill: () => new Float32Array(0),
      boolean_polygons: () => new Float32Array([0]),
    });
    const mp = booleanPolygonsWasm('intersection', [
      [[[0, 0], [1, 0], [1, 1], [0, 1]]],
      [[[2, 2], [3, 2], [3, 3], [2, 3]]],
    ]);
    expect(mp).toEqual([]);
  });

  it('treats length-0 wasm output as hard failure', () => {
    __setWasmGeomApiForTests({
      densify_path_d: () => new Float32Array(0),
      tessellate_fill: () => new Float32Array(0),
      tessellate_fill_with_holes: () => new Float32Array(0),
      tessellate_stroke: () => new Float32Array(0),
      tessellate_batch_fill: () => new Float32Array(0),
      boolean_polygons: () => new Float32Array([]),
    });
    expect(
      booleanPolygonsWasm('union', [
        [[[0, 0], [1, 0], [1, 1], [0, 1]]],
        [[[0, 0], [1, 0], [1, 1], [0, 1]]],
      ])
    ).toBeNull();
  });
});
