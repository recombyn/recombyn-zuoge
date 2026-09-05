import { describe, expect, it, beforeEach } from 'vitest';
import {
  __setWasmGeomApiForTests,
  simplifyRdpClosedWasm,
  simplifyRdpWasm,
  traceRgbaContoursWasm,
  setWasmGeomForceJs,
  getWasmGeomBackend,
} from '@/components/rcb/render/vector/wasmGeom';

describe('text outline wasm helpers', () => {
  beforeEach(() => {
    __setWasmGeomApiForTests(null);
    setWasmGeomForceJs(false);
  });

  it('simplify helpers return null without wasm', () => {
    expect(getWasmGeomBackend()).toBe('js');
    expect(
      simplifyRdpWasm(
        [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
        0.1
      )
    ).toBeNull();
    expect(
      simplifyRdpClosedWasm(
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        0.5
      )
    ).toBeNull();
  });

  it('decodes mock closed rdp', () => {
    __setWasmGeomApiForTests({
      densify_path_d: () => new Float32Array(0),
      tessellate_fill: () => new Float32Array(0),
      tessellate_fill_with_holes: () => new Float32Array(0),
      tessellate_stroke: () => new Float32Array(0),
      tessellate_batch_fill: () => new Float32Array(0),
      simplify_rdp_closed: () => new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]),
    });
    const pts = simplifyRdpClosedWasm(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      0.5
    );
    expect(pts).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
  });

  it('decodes mock rgba contours', () => {
    __setWasmGeomApiForTests({
      densify_path_d: () => new Float32Array(0),
      tessellate_fill: () => new Float32Array(0),
      tessellate_fill_with_holes: () => new Float32Array(0),
      tessellate_stroke: () => new Float32Array(0),
      tessellate_batch_fill: () => new Float32Array(0),
      trace_rgba_contours: () =>
        new Float32Array([1, 4, 0, 0, 8, 0, 8, 8, 0, 8]),
    });
    const rgba = new Uint8Array(8 * 8 * 4);
    const list = traceRgbaContoursWasm(rgba, 8, 8, 20);
    expect(list).not.toBeNull();
    expect(list!.length).toBe(1);
    expect(list![0]!.length).toBe(4);
  });
});
