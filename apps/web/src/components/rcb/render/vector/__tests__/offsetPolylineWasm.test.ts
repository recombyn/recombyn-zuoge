import { describe, expect, it, beforeEach } from 'vitest';
import {
  __setWasmGeomApiForTests,
  offsetPolylineWasm,
  setWasmGeomForceJs,
  getWasmGeomBackend,
} from '@/components/rcb/render/vector/wasmGeom';

describe('offsetPolylineWasm', () => {
  beforeEach(() => {
    __setWasmGeomApiForTests(null);
    setWasmGeomForceJs(false);
  });

  it('returns null when wasm missing', () => {
    expect(getWasmGeomBackend()).toBe('js');
    expect(
      offsetPolylineWasm(
        [
          [0, 0],
          [40, 0],
        ],
        4,
        false
      )
    ).toBeNull();
  });

  it('decodes mock offset into a ring', () => {
    __setWasmGeomApiForTests({
      densify_path_d: () => new Float32Array(0),
      tessellate_fill: () => new Float32Array(0),
      tessellate_fill_with_holes: () => new Float32Array(0),
      tessellate_stroke: () => new Float32Array(0),
      tessellate_batch_fill: () => new Float32Array(0),
      offset_polyline: () =>
        new Float32Array([
          1, 1, 4, 0, -2, 40, -2, 40, 2, 0, 2,
        ]),
    });
    const mp = offsetPolylineWasm(
      [
        [0, 0],
        [40, 0],
      ],
      4,
      false,
      { linejoin: 'miter', linecap: 'butt' }
    );
    expect(mp).not.toBeNull();
    expect(mp!.length).toBe(1);
    expect(mp![0]![0]!.length).toBeGreaterThanOrEqual(4);
  });
});
