import type { HomeMoreKey, HomeNavKey } from '@/components/layout/homeNav';
import { HOME_NAV_KEYS } from '@/components/layout/homeNav';

/** Sidebar + mobile nav sprite ids (`home-rail-*` → `assets/svg/home/rail_*.svg`). */
export const HOME_RAIL_NAV_ICONS = {
  home: 'home-rail-compose',
  inspiration: 'home-rail-inspire',
  mine: 'home-rail-projects',
  skills: 'home-rail-skills',
} as const;

export type HomeRailNavId = keyof typeof HOME_RAIL_NAV_ICONS;

export const HOME_RAIL_MORE_ICONS: Record<HomeMoreKey, string> = {
  assets: 'home-rail-assets',
  liked: 'home-rail-likes',
};

/** Per-nav glyph size — tuned per icon artwork. */
export const HOME_RAIL_NAV_ICON_SIZES: Record<HomeRailNavId, string> = {
  home: 'h-[20px] w-[20px]',
  inspiration: 'h-[21px] w-[21px]',
  mine: 'h-[19px] w-[19px]',
  skills: 'h-[19px] w-[19px]',
};

export const HOME_RAIL_MORE_ICON_SIZE = 'h-[18px] w-[18px]';

export const HOME_RAIL_NAV_ITEMS: { id: HomeRailNavId; labelKey: string }[] = [
  { id: 'home', labelKey: 'home.navHome' },
  { id: 'inspiration', labelKey: 'home.railInspiration' },
  { id: 'mine', labelKey: 'home.mine' },
  { id: 'skills', labelKey: 'home.railSkills' },
];

export const HOME_RAIL_MORE_ITEMS: { id: HomeMoreKey; labelKey: string; icon: string }[] = [
  { id: 'assets', labelKey: 'home.railAssets', icon: HOME_RAIL_MORE_ICONS.assets },
  { id: 'liked', labelKey: 'home.railLiked', icon: HOME_RAIL_MORE_ICONS.liked },
];

export const HOME_NAV_LABEL_KEYS: Record<HomeNavKey, string> = {
  home: 'home.navHome',
  inspiration: 'home.railInspiration',
  mine: 'home.mine',
  skills: 'home.railSkills',
  assets: 'home.railAssets',
  liked: 'home.railLiked',
};

export const HOME_MOBILE_NAV_ITEMS = HOME_NAV_KEYS.map((key) => ({
  key,
  labelKey: HOME_NAV_LABEL_KEYS[key],
}));

export function homeRailIconName(key: HomeNavKey): string {
  if (key === 'assets' || key === 'liked') return HOME_RAIL_MORE_ICONS[key];
  return HOME_RAIL_NAV_ICONS[key];
}

export function homeRailIconSize(key: HomeNavKey): string {
  if (key === 'assets' || key === 'liked') return HOME_RAIL_MORE_ICON_SIZE;
  return HOME_RAIL_NAV_ICON_SIZES[key];
}
