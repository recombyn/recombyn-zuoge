import { describe, expect, it } from 'vitest';
import { cn } from '@/utils/classnames';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('resolves Tailwind conflicts (last wins)', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });

  it('drops falsy values', () => {
    const skip = false;
    expect(cn('base', skip && 'x', null, undefined, 'ok')).toBe('base ok');
  });
});
