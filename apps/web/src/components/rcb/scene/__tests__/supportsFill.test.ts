import { describe, expect, it } from 'vitest';
import {
  supportsFill
} from '@/components/rcb/scene/document/nodeCapabilities';

describe('supportsFill', () => {
  it('is true for closed boolean path results', () => {
    expect(
      supportsFill({
        key: 'shape',
        attrs: {
          shapeType: 'path',
          closed: true,
          path: 'M0 0 H100 V100 H0 Z M20 20 L30 40 L10 40 Z',
          'fill-rule': 'evenodd',
        },
      })
    ).toBe(true);
  });

  it('is true when path d ends with Z even without closed attr', () => {
    expect(
      supportsFill({
        key: 'shape',
        attrs: { shapeType: 'path', path: 'M0 0 L10 0 L10 10 Z' },
      })
    ).toBe(true);
  });

  it('is false for open pen strokes', () => {
    expect(
      supportsFill({
        key: 'shape',
        attrs: { shapeType: 'pen', path: 'M0 0 L10 10', closed: false },
      })
    ).toBe(false);
  });

  it('is false for line / arrow / pencil', () => {
    for (const shapeType of ['line', 'arrow', 'pencil']) {
      expect(supportsFill({ key: 'shape', attrs: { shapeType } })).toBe(false);
    }
  });
});
