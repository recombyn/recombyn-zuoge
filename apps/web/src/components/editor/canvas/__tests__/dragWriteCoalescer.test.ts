import { describe, expect, it, vi } from 'vitest';
import { createDragWriteCoalescer } from '../dragWriteCoalescer';

describe('createDragWriteCoalescer', () => {
  it('applies video live geom synchronously (no rAF lag vs SVG preview)', () => {
    const apply = vi.fn();
    const c = createDragWriteCoalescer(apply);

    const geom = {
      v1: { left: 10, top: 20, width: 100, height: 200, angle: 0 },
    };
    c.queueVideoGeom(geom);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ videoGeom: geom });
    expect(c.getPendingVideoGeom()).toEqual(geom);
  });
});
