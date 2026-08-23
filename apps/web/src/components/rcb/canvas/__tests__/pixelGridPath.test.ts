import { describe, expect, it } from 'vitest';
import { buildPixelGridPathD } from '../RcbCanvas';

describe('buildPixelGridPathD', () => {
  it('emits lines on integer multiples of gridSize', () => {
    const d = buildPixelGridPathD(10.2, 20.7, 5, 5, 1);
    // Verticals at 10..16, horizontals at 20..26 (floor origins)
    expect(d).toContain('M 10 20 V 25.7');
    expect(d).toContain('M 15 20 V 25.7');
    expect(d).toContain('M 10 20 H 15.2');
    expect(d).toContain('M 10 25 H 15.2');
    // No pattern / fractional mid-cell origins
    expect(d).not.toMatch(/M 10\.5 /);
  });

  it('keeps step = gridSize for g>1', () => {
    const d = buildPixelGridPathD(0, 0, 10, 10, 2);
    expect(d).toContain('M 0 0 V 10');
    expect(d).toContain('M 2 0 V 10');
    expect(d).toContain('M 10 0 V 10');
    expect(d).not.toContain('M 1 0');
  });
});
