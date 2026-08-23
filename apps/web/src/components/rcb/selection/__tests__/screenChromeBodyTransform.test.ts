import { describe, expect, it } from 'vitest';
import { sceneChromeBodyTransform } from '../SelectionChrome';

describe('sceneChromeBodyTransform', () => {
  it('uses the exact scene origin without applying a second camera', () => {
    const box = { left: 100, top: 50, width: 40, height: 20 };
    expect(sceneChromeBodyTransform(box, 0)).toBe('translate(100 50)');
  });

  it('rotates about the scene-local box center', () => {
    const box = { left: 10, top: 20, width: 40, height: 30 };
    expect(sceneChromeBodyTransform(box, 15)).toBe(
      'translate(10 20) rotate(15 20 15)'
    );
  });
});
