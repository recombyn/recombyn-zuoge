import { useEffect, useRef, useState, memo } from 'react';
import { useDispatch } from '@/store';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { HiOutlinePencil } from 'react-icons/hi2';
import { apiQuery } from '@/service/client';
import { Button, message, ProgressBar } from '@/components/base';
import { UserAvatar } from '@/components/layout/UserAccountPanel';
import { setUser, type AuthUser } from '@/store/modules/auth';
import { useBillingEnabled } from '@/service/wallet';
import { formatCredits } from '@/utils/wallet';
import { docsUrl } from '@/utils/docsUrl';
import { cn } from '@/utils/classnames';

const NAME_RE = /^[\p{L}\p{N}\s.'\-_]{1,40}$/u;
const MAX_BIO = 200;
const MAX_AVATAR_MB = 2;

type ProfileValidateResult =
  | { ok: true; name: string; bio: string | null }
  | { ok: false; warnKey: string };

function validateProfileFields(opts: {
  name: string;
  bio: string;
  hasUser: boolean;
}): ProfileValidateResult {
  const trimmed = opts.name.trim();
  if (!trimmed) return { ok: false, warnKey: 'me.nameRequired' };
  if (trimmed.length > 40 || !NAME_RE.test(trimmed)) return { ok: false, warnKey: 'me.nameHint' };
  if (!opts.hasUser) return { ok: false, warnKey: 'me.needLogin' };
  return { ok: true, name: trimmed, bio: opts.bio.trim().slice(0, MAX_BIO) || null };
}

function avatarFileRejectReason(file: File): 'type' | 'size' | null {
  if (!file.type.startsWith('image/')) return 'type';
  if (file.size > MAX_AVATAR_MB * 1024 * 1024) return 'size';
  return null;
}

function readAvatarDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      resolve(url.startsWith('data:image/') ? url : null);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

type Props = {
  user: AuthUser | null;
  credits: number;
  creditCap: number;
  planUsed: number;
  planRemaining: number;
  usedPct: number;
  onOpenPlans: () => void;
  onGoUsage: () => void;
};

/** Profile / account / billing cards for the account settings hub. */
function AccountProfileTab({
  user,
  credits,
  creditCap,
  planUsed,
  planRemaining,
  usedPct,
  onOpenPlans,
  onGoUsage,
}: Props) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const billingEnabled = useBillingEnabled();
  const hideBillingUi = !billingEnabled;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(user?.name || '');
    setBio(user?.bio || '');
    setAvatar(user?.avatar || null);
  }, [user]);

  const queryClient = useQueryClient();
  const saveProfileMutation = useMutation(
    apiQuery.authAuthPatchProfile.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: apiQuery.authAuthMe.key() });
      },
    })
  );

  const providerLabel =
    user?.provider === 'google' ? t('account.loginGoogle') : t('account.loginEmail');

  const onAvatarFile = (file: File | null) => {
    if (!file || saving) return;
    const reject = avatarFileRejectReason(file);
    if (reject === 'type') {
      message.warning(t('me.avatarTypeError'));
      return;
    }
    if (reject === 'size') {
      message.warning(t('me.avatarSizeError', { mb: MAX_AVATAR_MB }));
      return;
    }
    async function loadAvatarUrl() {
      const url = await readAvatarDataUrl(file);
      if (url) setAvatar(url);
    }
    void loadAvatarUrl();
  };

  const onSave = async () => {
    const checked = validateProfileFields({ name, bio, hasUser: Boolean(user) });
    if (checked.ok === false) {
      message.warning(t(checked.warnKey));
      return;
    }
    if (!user || saving) return;
    setSaving(true);
    try {
      const res = (await saveProfileMutation.mutateAsync({
        body: {
          name: checked.name,
          bio: checked.bio,
          avatar,
        },
      })) as { user: AuthUser };
      dispatch(
        setUser({
          ...user,
          id: res.user.id || user.id,
          name: res.user.name,
          bio: res.user.bio ?? checked.bio,
          avatar: res.user.avatar ?? avatar,
          email: res.user.email || user.email,
          provider: res.user.provider || user.provider,
        })
      );
      message.success(t('me.profileSaved'));
    } catch {
      message.error(t('home.casesLoadFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl bg-[var(--account-card)] p-6 ring-1 ring-[var(--line)]">
        <h2 className="mb-5 text-[15px] font-semibold text-[var(--ink)]">
          {t('account.profileSection')}
        </h2>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="relative shrink-0">
            <UserAvatar
              name={name || user?.name}
              email={user?.email}
              avatar={avatar}
              size={72}
            />
            <button
              type="button"
              aria-label={t('me.changeAvatar')}
              disabled={saving}
              onClick={() => fileRef.current?.click()}
              className="absolute -bottom-0.5 -right-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--account-card)] text-[var(--ink)] shadow ring-1 ring-[var(--line)] transition hover:bg-[var(--accent-soft)] disabled:opacity-50"
            >
              <HiOutlinePencil className="h-3.5 w-3.5" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                onAvatarFile(e.target.files?.[0] || null);
                e.target.value = '';
              }}
            />
          </div>

          <div className="min-w-0 flex-1 space-y-5">
            <label className="block">
              <span className="mb-2 block text-[13px] font-medium text-[var(--ink)]">
                {t('me.username')}
                <span className="ml-0.5 text-red-500">*</span>
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                disabled={saving}
                className={cn(
                  'h-10 w-full rounded-lg border-0 bg-[var(--account-main)] px-3 text-[14px] text-[var(--ink)] outline-none ring-1 ring-[var(--line)]',
                  'placeholder:text-[var(--muted)] focus:ring-[var(--ink)]/25 disabled:opacity-60'
                )}
                placeholder={t('me.usernamePlaceholder')}
              />
              <span className="mt-2 block text-[12px] leading-relaxed text-[var(--muted)]">
                {t('me.nameHint')}
              </span>
            </label>

            <label className="block">
              <span className="mb-2 block text-[13px] font-medium text-[var(--ink)]">
                {t('me.bio')}
              </span>
              <div className="relative">
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO))}
                  rows={3}
                  maxLength={MAX_BIO}
                  disabled={saving}
                  placeholder={t('me.bioPlaceholder')}
                  className={cn(
                    'w-full resize-none rounded-lg border-0 bg-[var(--account-main)] px-3 py-2.5 text-[14px] leading-relaxed text-[var(--ink)] outline-none ring-1 ring-[var(--line)]',
                    'placeholder:text-[var(--muted)] focus:ring-[var(--ink)]/25 disabled:opacity-60'
                  )}
                />
                <span className="pointer-events-none absolute bottom-2.5 right-3 text-[12px] text-[var(--muted)]">
                  {bio.length}/{MAX_BIO}
                </span>
              </div>
            </label>
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t border-[var(--line)] pt-5">
          <Button
            type="primary"
            shape="round"
            loading={saving}
            disabled={saving}
            onClick={() => void onSave()}
          >
            {t('common.save')}
          </Button>
        </div>
      </section>

      <section className="rounded-xl bg-[var(--account-card)] p-6 ring-1 ring-[var(--line)]">
        <h2 className="mb-5 text-[15px] font-semibold text-[var(--ink)]">
          {t('account.accountSection')}
        </h2>
        <dl className="max-w-lg space-y-4 text-[14px]">
          <div className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-[var(--muted)]">{t('account.email')}</dt>
            <dd className="min-w-0 truncate text-right font-medium text-[var(--ink)]">
              {user?.email || '—'}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-[var(--muted)]">{t('account.loginMethod')}</dt>
            <dd className="text-right font-medium text-[var(--ink)]">{providerLabel}</dd>
          </div>
        </dl>
      </section>

      {!hideBillingUi ? (
      <section className="rounded-xl bg-[var(--account-card)] p-6 ring-1 ring-[var(--line)]">
        <h2 className="mb-5 text-[15px] font-semibold text-[var(--ink)]">
          {t('account.billingSection')}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-[200px] flex-1 items-center gap-3 rounded-lg bg-[var(--account-main)] px-3.5 py-3">
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[var(--ink)]">
              {t('wallet.goPro')}
            </span>
            <button
              type="button"
              onClick={onOpenPlans}
              className="shrink-0 rounded-xl bg-[var(--ink)] px-3 py-1.5 text-[13px] font-medium text-[var(--on-brand)] transition hover:opacity-90"
            >
              {t('wallet.upgrade')}
            </button>
          </div>
          <button
            type="button"
            onClick={onGoUsage}
            className="min-w-[200px] flex-1 rounded-lg bg-[var(--account-main)] px-3.5 py-3 text-left transition hover:opacity-90"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-[var(--ink)]">
                {t('wallet.credits')}
              </span>
              <span className="text-[12px] tabular-nums text-[var(--muted)]">
                {t('wallet.creditsRemaining', { count: formatCredits(credits) })}
              </span>
            </div>
            <ProgressBar
              percent={usedPct}
              active
              height={8}
              aria-label={t('wallet.creditsBarAria', {
                used: formatCredits(planUsed),
                remain: formatCredits(planRemaining),
                total: formatCredits(creditCap),
              })}
            />
          </button>
        </div>
      </section>
      ) : null}

      <p className="pt-1 text-[12px] text-[var(--muted)]">
        <a
          href={docsUrl('/legal/privacy')}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-[var(--line)] underline-offset-2 hover:text-[var(--ink)]"
        >
          {t('auth.privacy')}
        </a>
        <span className="mx-2 text-[var(--line)]">|</span>
        <a
          href={docsUrl('/legal/terms')}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-[var(--line)] underline-offset-2 hover:text-[var(--ink)]"
        >
          {t('auth.terms')}
        </a>
      </p>
    </div>
  );
}

export default memo(AccountProfileTab);
