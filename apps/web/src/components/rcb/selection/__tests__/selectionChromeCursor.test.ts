import { describe, expect, it } from 'vitest';
import {
  clearSelectionChromeCursor,
  isSelectionChromeCursor,
} from '../SelectionChrome';
import { cursorForRotate } from '../rotateCornerCursor';

describe('selection chrome cursor reset', () => {
  it('detects rotate data-url cursors', () => {
    const rotate = cursorForRotate(0, 0);
    expect(rotate.startsWith('url(')).toBe(true);
    expect(isSelectionChromeCursor(rotate)).toBe(true);
  });

  it('detects resize and endpoint cursors', () => {
    expect(isSelectionChromeCursor('nw-resize')).toBe(true);
    expect(isSelectionChromeCursor('default')).toBe(true);
    expect(isSelectionChromeCursor('pointer')).toBe(true);
    expect(isSelectionChromeCursor('')).toBe(false);
    expect(isSelectionChromeCursor('text')).toBe(false);
  });

  it('clears chrome cursors from the hit layer element', () => {
    const el = document.createElement('div');
    el.style.cursor = cursorForRotate(90, 45);
    clearSelectionChromeCursor(el);
    expect(el.style.cursor).toBe('');
  });
});
