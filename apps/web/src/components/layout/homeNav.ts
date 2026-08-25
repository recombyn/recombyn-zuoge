import type { NavigateFunction } from 'react-router-dom';
import { buildLoginUrl } from '@/utils/authReturnTo';

export const HOME_NAV_KEYS = [
  'home',
  'inspiration',
  'mine',
  'skills',
  'assets',
  'liked',
] as const;
export type HomeNavKey = (typeof HOME_NAV_KEYS)[number];

/** Sub-pages opened from the More flyout. */
export const HOME_MORE_KEYS = ['assets', 'liked'] as const;
export type HomeMoreKey = (typeof HOME_MORE_KEYS)[number];

export function isHomeNavKey(key: string): key is HomeNavKey {
  return (HOME_NAV_KEYS as readonly string[]).includes(key);
}

export function isHomeMoreKey(key: string): key is HomeMoreKey {
  return (HOME_MORE_KEYS as readonly string[]).includes(key);
}

export function parseHomeNavParam(raw: string | null | undefined): HomeNavKey {
  if (raw && isHomeNavKey(raw)) return raw;
  return 'home';
}

export function homeLoginReturnPath(nav: HomeNavKey): string {
  if (nav === 'home') return '/home';
  return `/home?nav=${nav}`;
}

type HomeGoNavDeps = {
  nav: string;
  authed: boolean;
  navigate: NavigateFunction;
  setNav: (id: string) => void;
  refreshProjects?: () => void;
  refreshSkills?: () => void;
};

/** Shared Home / mobile nav click — login gate, same-tab refresh, tab switch. */
export function runHomeGoNav(id: HomeNavKey, deps: HomeGoNavDeps): void {
  const { nav, authed, navigate, setNav, refreshProjects, refreshSkills } = deps;

  if ((id === 'mine' || id === 'skills' || id === 'assets' || id === 'liked') && !authed) {
    navigate(buildLoginUrl(homeLoginReturnPath(id)));
    return;
  }
  if ((id === 'home' || id === 'mine') && nav === id) {
    refreshProjects?.();
    return;
  }
  if (id === 'skills' && nav === id) {
    refreshSkills?.();
    return;
  }
  setNav(id);
}
