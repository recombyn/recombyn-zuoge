import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTransformPreviewCoalescer,
  type TransformPreviewBatch,
} from '../SelectionFeature';

describe('createTransformPreviewCoalescer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('merges pointermove batches and flushes once per animation frame', () => {
    const frames: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(() => cb(0));
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames[id - 1] = () => {};
    });

    const chrome: TransformPreviewBatch[] = [];
    const geom: unknown[] = [];
    const angles: unknown[] = [];
    const c = createTransformPreviewCoalescer({
      applyChrome: (b) => chrome.push(b),
      applyGeom: (patches, opts) => geom.push({ patches, opts }),
      applyAngles: (a) => angles.push(a),
    });

    c.queue({
      union: { left: 0, top: 0, width: 10, height: 10 },
      geom: [{ nodeId: 'a', left: 0, top: 0, width: 10, height: 10 }],
    });
    c.queue({
      union: { left: 5, top: 5, width: 10, height: 10 },
      geom: [{ nodeId: 'a', left: 5, top: 5, width: 10, height: 10 }],
      angles: [{ nodeId: 'a', angle: 12 }],
    });
    expect(chrome).toHaveLength(0);
    expect(frames).toHaveLength(1);

    frames[0]();
    expect(chrome).toHaveLength(1);
    expect(chrome[0].union).toEqual({ left: 5, top: 5, width: 10, height: 10 });
    expect(angles).toEqual([[{ nodeId: 'a', angle: 12 }]]);
    expect(geom).toEqual([
      {
        patches: [{ nodeId: 'a', left: 5, top: 5, width: 10, height: 10 }],
        opts: undefined,
      },
    ]);
  });

  it('applies angles before geom on the same frame', () => {
    const frames: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(() => cb(0));
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});

    const order: string[] = [];
    const c = createTransformPreviewCoalescer({
      applyChrome: () => order.push('chrome'),
      applyGeom: () => order.push('geom'),
      applyAngles: () => order.push('angles'),
    });
    c.queue({
      geom: [{ nodeId: 'ln', left: 0, top: 0, width: 40, height: 1 }],
      angles: [{ nodeId: 'ln', angle: 30 }],
    });
    frames[0]();
    expect(order).toEqual(['chrome', 'angles', 'geom']);
  });

  it('cancel drops pending work without applying', () => {
    const frames: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(() => cb(0));
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      frames.length = 0;
    });

    let applied = 0;
    const c = createTransformPreviewCoalescer({
      applyChrome: () => {
        applied += 1;
      },
      applyGeom: () => {},
      applyAngles: () => {},
    });
    c.queue({ union: { left: 1, top: 1, width: 1, height: 1 } });
    c.cancel();
    expect(frames).toHaveLength(0);
    expect(applied).toBe(0);
  });
});
