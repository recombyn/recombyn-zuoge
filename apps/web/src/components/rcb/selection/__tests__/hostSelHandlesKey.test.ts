/**
 * Pan/zoom must not tear down resize knobs when box/flags are unchanged.
 */
import { describe, expect, it } from 'vitest';
import { hostSelHandlesKey, type ShapeOutlineItem } from '../HostPathChrome';

function item(partial: Partial<ShapeOutlineItem> = {}): ShapeOutlineItem {
  return {
    id: 'n1',
    pathD: 'M0 0 H10 V8 Z',
    box: { left: 1, top: 2, width: 10, height: 8 },
    angle: 0,
    withHandles: true,
    showRotate: true,
    ...partial,
  };
}

describe('hostSelHandlesKey', () => {
  it('is stable for identical outline + stroke/inv', () => {
    const o = item();
    expect(hostSelHandlesKey(o, 0.1, 1, o.pathD)).toBe(
      hostSelHandlesKey(o, 0.1, 1, o.pathD)
    );
  });

  it('changes when box or zoom (inv) changes, not merely by identity', () => {
    const o = item();
    const a = hostSelHandlesKey(o, 0.1, 1, o.pathD);
    const b = hostSelHandlesKey(
      item({ box: { ...o.box, width: 11 } }),
      0.1,
      1,
      o.pathD
    );
    const c = hostSelHandlesKey(o, 0.1, 0.5, o.pathD);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
