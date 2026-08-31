import { describe, expect, it, vi } from 'vitest';
import { createDragWriteCoalescer } from '../dragWriteCoalescer';

describe('createDragWriteCoalescer', () => {
  it('coalesces video live geom to one apply per animation frame', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const apply = vi.fn();
    const c = createDragWriteCoalescer(apply);

    const geom1 = {
      v1: { left: 10, top: 20, width: 100, height: 200, angle: 0 },
    };
    const geom2 = {
      v1: { left: 12, top: 22, width: 100, height: 200, angle: 0 },
    };
    c.queueVideoGeom(geom1);
    c.queueVideoGeom(geom2);
    expect(apply).not.toHaveBeenCalled();
    expect(c.getPendingVideoGeom()).toEqual(geom2);

    vi.runAllTimers();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ videoGeom: geom2 });

    vi.useRealTimers();
  });

  it('cancel drops pending without apply', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const apply = vi.fn();
    const c = createDragWriteCoalescer(apply);
    c.queueVideoGeom({
      v1: { left: 1, top: 2, width: 3, height: 4, angle: 0 },
    });
    c.cancel();
    vi.runAllTimers();
    expect(apply).not.toHaveBeenCalled();
    expect(c.getPendingVideoGeom()).toBeNull();
    vi.useRealTimers();
  });
});
