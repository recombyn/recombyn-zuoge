import { describe, expect, it } from 'vitest';
import { pickComposerInsertOffset } from '../composerChipInsert';

describe('pickComposerInsertOffset', () => {
  it('uses live caret when the editor was focused (before focus reset)', () => {
    expect(
      pickComposerInsertOffset({
        plainLen: 10,
        wasFocused: true,
        liveOffsetBeforeFocus: 4,
        savedOffset: 0,
      })
    ).toBe(4);
  });

  it('uses saved caret after blur (mark / canvas pick)', () => {
    expect(
      pickComposerInsertOffset({
        plainLen: 10,
        wasFocused: false,
        liveOffsetBeforeFocus: null,
        savedOffset: 7,
      })
    ).toBe(7);
  });

  it('does not jump to 0 when text exists and caret is unknown', () => {
    expect(
      pickComposerInsertOffset({
        plainLen: 10,
        wasFocused: false,
        liveOffsetBeforeFocus: null,
        savedOffset: null,
      })
    ).toBe(10);
  });

  it('allows explicit caret at 0 while focused', () => {
    expect(
      pickComposerInsertOffset({
        plainLen: 10,
        wasFocused: true,
        liveOffsetBeforeFocus: 0,
        savedOffset: 10,
      })
    ).toBe(0);
  });

  it('clamps to plain length', () => {
    expect(
      pickComposerInsertOffset({
        plainLen: 5,
        wasFocused: false,
        liveOffsetBeforeFocus: null,
        savedOffset: 99,
      })
    ).toBe(5);
  });
});
