import { describe, expect, it, beforeEach } from 'vitest';
import {
  buildEditorProjectPath,
  EDITOR_NAV_LOCK_KEY,
  clearEditorProjectNavigationLock,
  lockEditorProjectNavigation,
  readEditorProjectNavigationLock,
  shouldSyncEditorRoute,
} from '../editorProjectNavigation';

describe('editorProjectNavigation', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('locks and reads project id', () => {
    lockEditorProjectNavigation('abc123');
    expect(readEditorProjectNavigationLock()).toBe('abc123');
    expect(sessionStorage.getItem(EDITOR_NAV_LOCK_KEY)).toBe('abc123');
  });

  it('clears lock', () => {
    lockEditorProjectNavigation('abc123');
    clearEditorProjectNavigationLock();
    expect(readEditorProjectNavigationLock()).toBeNull();
  });

  it('ignores empty ids', () => {
    lockEditorProjectNavigation('  ');
    expect(readEditorProjectNavigationLock()).toBeNull();
  });

  it('builds editor path with optional fromHomeAgent', () => {
    expect(buildEditorProjectPath('abc')).toBe('/editor/abc');
    expect(buildEditorProjectPath('abc', '?fromHomeAgent=1')).toBe(
      '/editor/abc?fromHomeAgent=1'
    );
  });

  it('decides when route sync should run', () => {
    expect(shouldSyncEditorRoute('a', 'a')).toBe(false);
    expect(shouldSyncEditorRoute('a', 'b')).toBe(false);
    lockEditorProjectNavigation('b');
    expect(shouldSyncEditorRoute('a', 'b')).toBe(true);
    clearEditorProjectNavigationLock();
    expect(shouldSyncEditorRoute('', 'b')).toBe(true);
  });
});
