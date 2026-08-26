import { useMemo, memo } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HiOutlineBars3 } from 'react-icons/hi2';
import { Dropdown } from '@/components/base';
import { Icon } from '@/components/base/icon';
import type { MenuItemType } from '@/components/base/dropdown/MenuItem';
import { refreshHomeNavPanel, refreshHomeProjectsList } from '@/components/layout/HomeBody';
import {
  HOME_MOBILE_NAV_ITEMS,
  homeRailIconName,
  homeRailIconSize,
} from '@/components/layout/homeRailIcons';
import {
  isHomeNavKey,
  runHomeGoNav,
  type HomeNavKey,
} from '@/components/layout/homeNav';
import { getToken } from '@/utils/token';

type Props = {
  setNav: (id: string) => void;
  nav?: string;
};

const MOBILE_NAV_ITEMS = HOME_MOBILE_NAV_ITEMS;

/** Mobile-only nav menu — desktop account/credits live in the sidebar footer. */
function HomeTopBar({ setNav, nav = 'home' }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const userId = useSelector((state: any) => state.auth?.user?.id) as string | undefined;
  const authed = Boolean(userId && getToken());

  const goNav = (id: HomeNavKey) => {
    runHomeGoNav(id, {
      nav,
      authed,
      navigate,
      setNav,
      refreshProjects: refreshHomeProjectsList,
      refreshSkills: refreshHomeNavPanel,
    });
  };

  const mobileNavItems: MenuItemType[] = useMemo(
    () =>
      MOBILE_NAV_ITEMS.map(({ key, labelKey }) => ({
        key,
        label: (
          <span className="inline-flex items-center gap-2">
            <Icon
              name={homeRailIconName(key)}
              className={`${homeRailIconSize(key)} shrink-0 opacity-80`}
            />
            {t(labelKey)}
          </span>
        ),
      })),
    [t]
  );

  return (
    <div className="pointer-events-none fixed right-0 top-0 z-40 flex h-14 items-center justify-end px-4 md:hidden">
      <div className="pointer-events-auto flex items-center gap-1.5">
        <Dropdown
          trigger="click"
          placement="bottom-end"
          strategy="fixed"
          offset={8}
          items={mobileNavItems}
          onClick={(key) => {
            if (isHomeNavKey(key)) goNav(key);
          }}
          floatingClassName="z-[600]"
          popupClassName="min-w-[10rem] rounded-xl !bg-[var(--surface)] p-1.5 shadow-[0_8px_28px_rgba(15,23,42,0.14)] ring-1 ring-[var(--line)]"
        >
          <button
            type="button"
            aria-label={t('common.more')}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--surface)] text-[var(--ink)] shadow-sm ring-1 ring-[var(--line)]"
          >
            <HiOutlineBars3 className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </button>
        </Dropdown>
      </div>
    </div>
  );
}

export default memo(HomeTopBar);
