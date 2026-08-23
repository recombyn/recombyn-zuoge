import { describe, expect, it } from 'vitest';
import { sceneChromeBodyTransform } from '../SelectionChrome';

/**
 * Multi-select union must paint from the union AABB under the shared camera —
 * never the first member's live host box (regression: chrome collapsed onto one node).
 */
describe('union chrome body transform', () => {
  it('scales the full union box, not a single member origin', () => {
    const union = { left: 100, top: 50, width: 80, height: 60 };
    const member = { left: 100, top: 50, width: 20, height: 15 };
    const unionTf = sceneChromeBodyTransform(union, 0);
    const memberTf = sceneChromeBodyTransform(member, 0);
    expect(unionTf).toBe('translate(100 50)');
    expect(memberTf).toBe('translate(100 50)');
    // Same origin, different size — rotate center must use union size when angled.
    const unionRot = sceneChromeBodyTransform(union, 15);
    expect(unionRot).toBe('translate(100 50) rotate(15 40 30)');
    const memberRot = sceneChromeBodyTransform(member, 15);
    expect(memberRot).toBe('translate(100 50) rotate(15 10 7.5)');
    expect(unionRot).not.toBe(memberRot);
  });
});
