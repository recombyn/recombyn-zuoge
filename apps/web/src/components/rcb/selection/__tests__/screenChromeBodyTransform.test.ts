import { describe, expect, it } from 'vitest';
import { sceneChromeBodyTransform } from '../SelectionChrome';

describe('sceneChromeBodyTransform', () => {
  it('uses the exact scene origin without applying a second camera', () => {
    const box = { left: 100, top: 50, width: 40, height: 20 };
    expect(sceneChromeBodyTransform(box, 0)).toBe('translate(100 50)');
  });

  it('rotates about the scene-local box center by default', () => {
    const box = { left: 10, top: 20, width: 40, height: 30 };
    expect(sceneChromeBodyTransform(box, 15)).toBe(
      'translate(10 20) translate(20 15) rotate(15) translate(-20 -15)'
    );
  });

  it('rotates about a custom anchor percent', () => {
    const box = { left: 10, top: 20, width: 40, height: 30 };
    expect(sceneChromeBodyTransform(box, 15, false, false, 0, 0)).toBe(
      'translate(10 20) translate(0 0) rotate(15) translate(0 0)'
    );
  });

  it('mirrors host flip about the box center after rotate', () => {
    const box = { left: 10, top: 20, width: 40, height: 30 };
    expect(sceneChromeBodyTransform(box, 0, true, false)).toBe(
      'translate(10 20) translate(20 15) scale(-1 1) translate(-20 -15)'
    );
    expect(sceneChromeBodyTransform(box, 15, false, true)).toBe(
      'translate(10 20) translate(20 15) rotate(15) scale(1 -1) translate(-20 -15)'
    );
  });

  it('applies AE-style Sk/Sa about the same pivot as scene ink', () => {
    const box = { left: 10, top: 20, width: 40, height: 30 };
    expect(sceneChromeBodyTransform(box, 30, false, false, 50, 50, -26, 136)).toBe(
      'translate(10 20) translate(20 15) rotate(30) rotate(136) skewX(-26) rotate(-136) translate(-20 -15)'
    );
  });
});
