import { bindAuthMutator } from '@/store/authBind';
import { clearAllProjectDrafts } from '@/components/editor/projectDraftStore';
import { clearHomeAgentBoot } from '@/utils/homeAgentBoot';
import { getToken, setToken as persistToken } from '@/utils/token';

const STORAGE_KEY = 'recombyn-auth-v1';

/** Account-bound local keys cleared on logout (not device UI prefs like theme). */
const SESSION_STORAGE_KEYS = [
  'recombyn.agentRoutePrefs.v1',
  'recombyn.customLlmProviders.v1',
  'recombyn.notices.read.v1',
  'recombyn.agentPaintMode.v1',
  'recombyn.byok.deviceKey.v1',
  'recombyn:custom-project-thumbs',
  'recombyn-google-oauth-nonce-v1',
] as const;

const SESSION_KEY_PREFIXES = [
  'recombyn-liked-cases-v1:',
] as const;

export type AuthUser = {
  email: string;
  name: string;
  provider: 'email' | 'google';
  avatar?: string | null;
  bio?: string | null;
  id?: string;
  role?: 'user' | 'admin' | string;
  hasPassword?: boolean;
};

function loadAuth(): { user: AuthUser | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { user: null };
    const parsed = JSON.parse(raw);
    return { user: parsed?.user ?? null };
  } catch {
    return { user: null };
  }
}

function persist(user: AuthUser | null) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ user }));
}

function removeStorageKeys(storage: Storage, keys: readonly string[]) {
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

function removeStorageByPrefixes(storage: Storage, prefixes: readonly string[]) {
  const doomed: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key) continue;
      if (prefixes.some((p) => key.startsWith(p))) doomed.push(key);
    }
  } catch {
    return;
  }
  removeStorageKeys(storage, doomed);
}

/**
 * Clear account-bound caches after logout / 401.
 * Keeps device prefs (theme, dock widths, language, editor tour completion).
 */
export function clearSessionCaches() {
  removeStorageKeys(localStorage, SESSION_STORAGE_KEYS);
  removeStorageByPrefixes(localStorage, SESSION_KEY_PREFIXES);
  clearHomeAgentBoot();
  try {
    sessionStorage.removeItem('recombyn-google-oauth-nonce-v1');
    sessionStorage.removeItem('recombyn.byok.deviceKey.v1');
  } catch {
    /* ignore */
  }
  void clearAllProjectDrafts();
}

const initialState = loadAuth();

export type AuthState = typeof initialState;
export { initialState as authInitialState };

export const authReducers = {
  setUser(state: AuthState, action: { payload: AuthUser | null }) {
    state.user = action.payload;
    persist(state.user);
  },
  setSession(
    state: AuthState,
    action: { payload: { user: AuthUser; token?: string | null } }
  ) {
    const { user, token } = action.payload;
    // Never restore a user session without a live token (logout race safety).
    if (token === null || (token === undefined && !getToken())) {
      state.user = null;
      persist(null);
      if (token === null) persistToken(null);
      return;
    }
    state.user = user;
    persist(user);
    if (token !== undefined) persistToken(token);
  },
  logout(state: AuthState, _action: { payload: void }) {
    state.user = null;
    persist(null);
    persistToken(null);
  },
} as const;

export const setUser = bindAuthMutator(authReducers.setUser);
export const setSession = bindAuthMutator(authReducers.setSession);
export const logout = bindAuthMutator(authReducers.logout);
