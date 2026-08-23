import { useMemo, memo } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineBars3,
  HiOutlineBriefcase,
  HiOutlineFolder,
  HiOutlineHome,
} from 'react-icons/hi2';
import { LuUserRound } from 'react-icons/lu';
import { Dropdown } from '@/components/base';
import type { MenuItemType } from '@/components/base/dropdown/MenuItem';
import AuthHeader from '@/components/layout/AuthHeader';
import { useIsDesktopShell } from '@/components/layout/DesktopTitlebar';
import { refreshHomeNavPanel, refreshHomeProjectsList } from '@/components/layout/HomeBody';
import { buildLoginUrl } from '@/utils/authReturnTo';
import { cn } from '@/utils/classnames';
import { getToken } from '@/utils/token';

type Props = {
  setNav: (id: string) => void;
  nav?: string;
};

type HomeNavKey = 'home' | 'mine' | 'account' | 'skills';

function isHomeNavKey(key: string): key is HomeNavKey {
  return key === 'home' || key === 'mine' || key === 'account' || key === 'skills';
}

/** Floating top-right — account chip; mobile also has nav menu after avatar. */
function HomeTopBar({ setNav, nav }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const desktop = useIsDesktopShell();
  const userId = useSelector((state: any) => state.auth?.user?.id) as string | undefined;
  const authed = Boolean(userId && getToken());

  const goNav = (id: HomeNavKey) => {
    if ((id === 'mine' || id === 'account' || id === 'skills') && !authed) {
      navigate(buildLoginUrl(`/home?nav=${id}`));
      return;
    }
    if ((id === 'home' || id === 'mine') && nav === id) {
      refreshHomeProjectsList();
      return;
    }
    if ((id === 'account' || id === 'skills') && nav === id) {
      refreshHomeNavPanel(id);
      return;
    }
    setNav(id);
  };

  const onMobileNavClick = (key: string) => {
    if (isHomeNavKey(key)) goNav(key);
  };

  const mobileNavItems: MenuItemType[] = useMemo(
    () => [
      {
        key: 'home',
        label: (
          <span className="inline-flex items-center gap-2">
            <HiOutlineHome className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.5} />
            {t('home.navHome')}
          </span>
        ),
      },
      {
        key: 'mine',
        label: (
          <span className="inline-flex items-center gap-2">
            <HiOutlineFolder className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.5} />
            {t('home.mine')}
          </span>
        ),
      },
      {
        key: 'skills',
        label: (
          <span className="inline-flex items-center gap-2">
            <HiOutlineBriefcase className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.5} />
            {t('home.railSkills')}
          </span>
        ),
      },
      {
        key: 'account',
        label: (
          <span className="inline-flex items-center gap-2">
            <LuUserRound className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.5} />
            {t('home.account')}
          </span>
        ),
      },
    ],
    [t]
  );

  // Web mobile: fixed to viewport. Tauri: never fixed — content sits under the custom
  // titlebar, so fixed top-0 would park the avatar on the chrome controls.
  return (
    <div
      className={cn(
        'pointer-events-none z-40 flex items-center justify-end',
        desktop
          ? 'absolute right-0 top-0 h-auto p-4 md:p-5'
          : 'fixed right-0 top-0 h-14 px-4 md:absolute md:z-10 md:h-auto md:p-5'
      )}
    >
      <div className="pointer-events-auto flex items-center gap-1.5">
        <AuthHeader />
        <Dropdown
          trigger="click"
          placement="bottom-end"
          strategy="fixed"
          offset={8}
          items={mobileNavItems}
          onClick={onMobileNavClick}
          floatingClassName="z-[600]"
          popupClassName="min-w-[10rem] rounded-xl !bg-[var(--surface)] p-1.5 shadow-[0_8px_28px_rgba(15,23,42,0.14)] ring-1 ring-[var(--line)]"
        >
          <button
            type="button"
            aria-label={t('home.navHome')}
            aria-haspopup="menu"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] md:hidden"
          >
            <HiOutlineBars3 className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </button>
        </Dropdown>
      </div>
    </div>
  );
}

export default memo(HomeTopBar);
