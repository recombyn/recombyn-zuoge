import { describe, expect, it } from 'vitest';
import { applyBooleanResultPaint } from '../shapeBoolean';

describe('applyBooleanResultPaint visibility', () => {
  it('keeps stroke when the sample is a stroke-only wireframe', () => {
    const attrs: Record<string, unknown> = {
      'fill-color': 'transparent',
      'fill-enabled': 'false',
      'stroke-enabled': 'true',
      'border-color': '#111111',
      'border-width': 2,
    };
    applyBooleanResultPaint(
      attrs,
      {
        'fill-color': 'transparent',
        'fill-enabled': 'false',
        'fill-visible': 'false',
        'stroke-enabled': 'true',
        'stroke-visible': 'true',
        'border-color': '#111111',
        'border-width': 2,
      },
      { stroke: '#333', borderWidth: 1 }
    );
    expect(attrs['stroke-enabled']).toBe('true');
    expect(Number(attrs['border-width'])).toBeGreaterThan(0);
    expect(attrs['border-color']).toBe('#111111');
  });

  it('restores a solid fill when both fill and stroke would be invisible', () => {
    const attrs: Record<string, unknown> = {
      'fill-color': 'transparent',
      'fill-enabled': 'false',
    };
    applyBooleanResultPaint(
      attrs,
      {
        'fill-color': 'transparent',
        'fill-enabled': 'false',
        'stroke-enabled': 'false',
        'stroke-visible': 'false',
        'border-color': '#3B82F6',
        'border-width': 0,
      },
      { stroke: '#3B82F6', borderWidth: 1, fill: '#3B82F6' }
    );
    expect(attrs['fill-enabled']).toBe('true');
    expect(attrs['fill-visible']).toBe('true');
    expect(String(attrs['fill-color'])).not.toBe('transparent');
  });

  it('does not copy opacity 0 from a ghosted operand', () => {
    const attrs: Record<string, unknown> = { opacity: 1 };
    applyBooleanResultPaint(
      attrs,
      {
        'fill-color': '#111',
        'fill-enabled': 'true',
        opacity: 0,
        'stroke-enabled': 'false',
      },
      { stroke: '#333', borderWidth: 1 }
    );
    expect(attrs.opacity).toBe(1);
  });
});
