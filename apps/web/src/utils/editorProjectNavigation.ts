import type { NavigateFunction } from 'react-router-dom';
import { writeUnsyncedProjectDraft } from '@/components/editor/projectDraftStore';
import { flushCurrentProjectNow } from '@/components/editor/useProjectCloudSync';

/** Session key: editor store switched project before URL caught up (duplicate / import). */
export const EDITOR_NAV_LOCK_KEY = 'editor:nav-lock-project-id';

function navSession(): Storage | null {
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage;
}

export function lockEditorProjectNavigation(projectId: string) {
  const storage = navSession();
  const id = String(projectId || '').trim();
  if (!storage || !id) return;
  storage.setItem(EDITOR_NAV_LOCK_KEY, id);
}

export function readEditorProjectNavigationLock(): string | null {
  const storage = navSession();
  if (!storage) return null;
  const id = String(storage.getItem(EDITOR_NAV_LOCK_KEY) || '').trim();
  return id || null;
}

export function clearEditorProjectNavigationLock() {
  navSession()?.removeItem(EDITOR_NAV_LOCK_KEY);
}

export function buildEditorProjectPath(projectId: string, locationSearch = ''): string {
  const base = `/editor/${encodeURIComponent(projectId)}`;
  const fromHomeAgent = new URLSearchParams(locationSearch).get('fromHomeAgent') === '1';
  return fromHomeAgent ? `${base}?fromHomeAgent=1` : base;
}

/** Whether URL sync should attach editor store currentId (not when opening a list item). */
export function shouldSyncEditorRoute(pathId: string, currentId: string): boolean {
  if (!currentId || pathId === currentId) return false;
  if (readEditorProjectNavigationLock() === currentId) return true;
  return !pathId;
}

/** Duplicate / import: persist draft, lock route, navigate, flush to cloud. */
export async function publishEditorProjectLocally(opts: {
  projectId: string;
  name: string;
  document: unknown;
  navigate: NavigateFunction;
  locationSearch?: string;
}) {
  const { projectId, name, document, navigate, locationSearch = '' } = opts;
  writeUnsyncedProjectDraft(projectId, name, document);
  lockEditorProjectNavigation(projectId);
  navigate(buildEditorProjectPath(projectId, locationSearch), { replace: true });
  await flushCurrentProjectNow({ force: true }).catch(() => undefined);
}
