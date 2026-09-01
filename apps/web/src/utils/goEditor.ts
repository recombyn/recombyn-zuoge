import { useCallback } from 'react';
import { useSelector } from '@/store';
import { useNavigate } from 'react-router-dom';
import { store } from '@/store';
import { buildLoginUrl } from '@/utils/authReturnTo';
import {
  openEditorWindowWithBoot,
  saveHomeAgentBoot,
  type HomeAgentBoot,
} from '@/utils/homeAgentBoot';

export type GoEditorOpts = {
  createNew?: boolean;
  fromHomeAgent?: boolean;
  /** Open this project; falls back to the editor store currentId when omitted. */
  projectId?: string | null;
  /** Open editor in a new browser tab/window (home project cards). */
  newWindow?: boolean;
  /**
   * Home — editor handoff payload. Not placed in the URL (URL only has createNew / fromHomeAgent).
   * Seeded into the new tab's sessionStorage; cleared after the editor consumes it.
   */
  homeAgentBoot?: HomeAgentBoot;
};

/** Tauri / embedded webview — `window.open(_blank)` often no-ops with no fallback. */
function canOpenEditorInNewWindow(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  if (w.__TAURI_INTERNALS__ || w.__TAURI__) return false;
  if (import.meta.env.TAURI_ENV_PLATFORM) return false;
  return true;
}

/** Build editor path (intent stays in the URL, including after login ?from=). */
export function buildEditorIntentPath(opts?: GoEditorOpts): string {
  const createNew = Boolean(opts?.createNew);
  const fromHomeAgent = Boolean(opts?.fromHomeAgent);
  const fromStore = (store.getState() as any)?.editor?.currentId as string | null | undefined;
  const projectId = (opts?.projectId ?? (createNew ? null : fromStore) ?? '').trim();

  if (createNew) {
    const q = new URLSearchParams();
    q.set('createNew', '1');
    if (fromHomeAgent) q.set('fromHomeAgent', '1');
    return `/editor?${q.toString()}`;
  }
  if (projectId) {
    const base = `/editor/${encodeURIComponent(projectId)}`;
    if (!fromHomeAgent) return base;
    const q = new URLSearchParams();
    q.set('fromHomeAgent', '1');
    return `${base}?${q.toString()}`;
  }
  return '/editor';
}

/** Navigate to /editor/:projectId; guests open the login modal on this tab (ignore newWindow). */
export function useGoEditor() {
  const user = useSelector((s: any) => s.auth.user);
  const navigate = useNavigate();

  return useCallback(
    (opts?: GoEditorOpts) => {
      const path = buildEditorIntentPath(opts);
      // Guests: never window.open — that jumps to a new tab instead of the in-page login dialog.
      if (!user) {
        navigate(buildLoginUrl(path));
        return;
      }
      if (opts?.newWindow && canOpenEditorInNewWindow()) {
        if (opts.homeAgentBoot) {
          const opened = openEditorWindowWithBoot(path, opts.homeAgentBoot);
          if (!opened) navigate(path);
          return;
        }
        // Do not pass `noopener` to window.open — it makes the return value null in
        // Chromium even when the tab opens, and we would wrongly navigate this window.
        const win = window.open(path, '_blank');
        if (win) {
          win.opener = null;
          return;
        }
        // Popup blocked — fall back to same-tab navigation.
        navigate(path);
        return;
      }
      if (opts?.homeAgentBoot) saveHomeAgentBoot(opts.homeAgentBoot);
      navigate(path);
    },
    [user, navigate]
  );
}
