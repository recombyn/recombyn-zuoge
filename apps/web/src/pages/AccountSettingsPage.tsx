import { useEffect, useState, type ReactNode, memo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSelector } from '@/store';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { HiOutlineArrowLeft } from 'react-icons/hi2';
import AccountSettingsDialog from '@/components/layout/AccountSettingsDialog';
import WalletLedgerPanel from '@/components/layout/WalletLedgerPanel';
import { UserAvatar } from '@/components/layout/UserAccountPanel';
import AgentModelsPanel from '@/components/editor/panels/agent/models/AgentModelsPanel';
import AccountProfileTab from '@/components/account/AccountProfileTab';
import AccountOrgPanel from '@/components/account/AccountOrgPanel';
import { apiQuery } from '@/service/client';
import { useBillingEnabled, useWalletSnapshot } from '@/service/wallet';
import { setSession, type AuthUser } from '@/store/modules/auth';
import { getToken } from '@/utils/token';
import { readReturnToParam } from '@/utils/authReturnTo';
import { cn } from '@/utils/classnames';

const ACCOUNT_TABS = ['profile', 'usage', 'agent', 'org'] as const;
type AccountTab = (typeof ACCOUNT_TABS)[number];

const accountTabParser = parseAsStringLiteral(ACCOUNT_TABS)
  .withDefault('profile')
  .withOptions({ history: 'replace', clearOnDefault: true });

function accountPageTitle(tab: AccountTab, t: (key: string) => string): string {
  switch (tab) {
    case 'usage':
      return t('wallet.billingTitle');
    case 'agent':
      return t('account.agentTitle');
    case 'org':
      return t('account.orgTitle');
    default:
      return t('account.title');
  }
}

function accountPageSubtitle(tab: AccountTab, t: (key: string) => string): string {
  switch (tab) {
    case 'usage':
      return t('wallet.billingHint');
    case 'agent':
      return t('account.agentSubtitle');
    case 'org':
      return t('account.orgSubtitle');
    default:
      return t('account.subtitle');
  }
}

function accountShowsSubtitle(tab: AccountTab): boolean {
  return tab === 'profile' || tab === 'agent' || tab === 'org';
}

/** Account hub — left nav + profile / usage / agent panels. */
function AccountSettingsPage(): ReactNode {
  const { t } = useTranslation();
  const [tab, setTabState] = useQueryState('tab', accountTabParser);
  const [searchParams] = useSearchParams();
  const user = useSelector((s: any) => s.auth.user as AuthUser | null);
  const { credits, creditsIncluded } = useWalletSnapshot();
  const billingEnabled = useBillingEnabled();
  const hideBillingUi = !billingEnabled;
  const [settingsOpen, setSettingsOpen] = useState(false);

  const setTab = (next: AccountTab) => {
    if (hideBillingUi && next === 'usage') return;
    setTabState(next);
  };

  useEffect(() => {
    if (!hideBillingUi || tab !== 'usage') return;
    setTabState('profile');
  }, [hideBillingUi, tab, setTabState]);

  const authed = Boolean(getToken());

  const meQuery = useQuery({
    ...apiQuery.authAuthMe.queryOptions({
      enabled: authed,
    }),
  });

  useEffect(() => {
    const res = meQuery.data as
      | {
          user: {
            id?: string;
            email: string;
            name: string;
            avatar?: string | null;
            provider: string;
            bio?: string | null;
            role?: string;
          };
        }
      | undefined;
    if (!res?.user || !getToken()) return;
    setSession({
        user: {
          id: res.user.id,
          email: res.user.email,
          name: res.user.name,
          avatar: res.user.avatar,
          provider: res.user.provider,
          bio: res.user.bio,
          role: res.user.role,
        },
        token: getToken() || undefined,
      });
  }, [meQuery.data]);

  const creditCap = Math.max(1, Number(creditsIncluded) || 150);
  const balance = Math.max(0, Number(credits) || 0);
  const planRemaining = Math.min(balance, creditCap);
  const planUsed = Math.max(0, creditCap - planRemaining);
  const usedPct = Math.min(100, Math.round((planUsed / creditCap) * 100));

  const navItems: { id: AccountTab; label: string }[] = [
    { id: 'profile', label: t('account.navProfile') },
    { id: 'org', label: t('account.navOrg') },
    { id: 'agent', label: t('account.navAgent') },
    ...(!hideBillingUi ? [{ id: 'usage' as const, label: t('account.navUsage') }] : []),
  ];

  const pageTitle = accountPageTitle(tab, t);
  const pageSubtitle = accountPageSubtitle(tab, t);
  const returnTo = readReturnToParam(searchParams);
  const backLabel = returnTo === '/home' ? t('account.backHome') : t('account.back');

  return (
    <div className="flex h-full min-h-0 bg-[var(--account-main)]">
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--account-rail)]">
        <div className="px-3 pt-4 pb-2">
          <Link
            to={returnTo}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] text-[var(--muted)] transition hover:text-[var(--ink)]"
          >
            <HiOutlineArrowLeft className="h-4 w-4" />
            {backLabel}
          </Link>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3 pb-4" aria-label={t('account.title')}>
          {navItems.map(({ id, label }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  'flex w-full items-center rounded-lg px-3 py-2 text-left text-[14px] transition',
                  active
                    ? 'bg-[var(--accent-soft)] font-medium text-[var(--ink)]'
                    : 'text-[var(--muted)] hover:text-[var(--ink)]'
                )}
              >
                {label}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-[var(--line)] p-4">
          <div className="flex items-center gap-2.5">
            <UserAvatar name={user?.name} email={user?.email} avatar={user?.avatar} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-[var(--ink)]">
                {user?.name || user?.email}
              </div>
              <div className="truncate text-[11px] text-[var(--muted)]">{user?.email}</div>
            </div>
          </div>
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-[var(--account-main)]">
        <div className="mx-auto w-full max-w-[1400px] px-6 py-8 pb-16 sm:px-8">
          <header className="mb-6">
            <h1 className="text-[24px] font-medium leading-tight tracking-tight text-[var(--ink)]">
              {pageTitle}
            </h1>
            {accountShowsSubtitle(tab) ? (
              <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--muted)]">{pageSubtitle}</p>
            ) : null}
          </header>

          {tab === 'usage' && !hideBillingUi ? <WalletLedgerPanel /> : null}
          {tab === 'agent' ? <AgentModelsPanel /> : null}
          {tab === 'org' ? <AccountOrgPanel /> : null}
          {tab === 'profile' ? (
            <AccountProfileTab
              user={user}
              credits={credits}
              creditCap={creditCap}
              planUsed={planUsed}
              planRemaining={planRemaining}
              usedPct={usedPct}
              onOpenPlans={() => setSettingsOpen(true)}
              onGoUsage={() => setTab('usage')}
            />
          ) : null}
        </div>
      </main>

      <AccountSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialTab="plans"
      />
    </div>
  );
}

export default memo(AccountSettingsPage);
