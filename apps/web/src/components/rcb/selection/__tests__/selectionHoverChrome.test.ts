import { describe, expect, it } from 'vitest';
import {
  SELECTION_HOVER_UI_SELECTOR,
  isSelectionHoverUiTarget,
} from '../selectionHoverChrome';

describe('selectionHoverChrome', () => {
  it('matches floating toolbar hosts', () => {
    const el = document.createElement('div');
    el.setAttribute('data-sel-toolbar', '');
    document.body.appendChild(el);
    expect(isSelectionHoverUiTarget(el)).toBe(true);
    document.body.removeChild(el);
  });

  it('exports a stable overlap selector list', () => {
    expect(SELECTION_HOVER_UI_SELECTOR).toContain('[data-mark-overlay]');
    expect(SELECTION_HOVER_UI_SELECTOR).toContain('[data-sel-toolbar]');
  });
});
