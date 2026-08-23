import { memo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HiOutlineArrowRightOnRectangle } from 'react-icons/hi2';
import WalletAccountChip from '@/components/layout/WalletAccountChip';

function GateShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 bg-[var(--canvas)] px-6">
      <div className="pointer-events-none absolute right-4 top-3 z-20">
        <div className="pointer-events-auto">
          <WalletAccountChip />
        </div>
      </div>
      {children}
    </div>
  );
}

/** Missing / forbidden share gate screens. */
function ShareGateStates({
  kind,
  viewerId,
  loginUrl,
}: {
  kind: 'missing' | 'forbidden';
  viewerId?: string;
  loginUrl: string;
}) {
  const { t } = useTranslation();

  if (kind === 'missing') {
    return (
      <GateShell>
        <p className="text-[15px] font-medium text-[var(--ink)]">
          {t('editor.shareMissing', { defaultValue: '分享不存在或已失效' })}
        </p>
        <p className="text-[13px] text-[var(--muted)]">
          {t('editor.shareMissingHint', {
            defaultValue: '链接可能已过期，或分享已被删除。',
          })}
        </p>
      </GateShell>
    );
  }

  return (
    <GateShell>
      <p className="text-[15px] font-medium text-[var(--ink)]">{t('editor.shareNoViewAccess')}</p>
      <p className="max-w-sm text-center text-[13px] text-[var(--muted)]">
        {viewerId ? t('editor.shareNoViewAccessHint') : t('editor.shareLoginToView')}
      </p>
      {!viewerId ? (
        <Link
          to={loginUrl}
          className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--ink)] px-4 text-[13px] font-medium text-[var(--on-brand)]"
        >
          <HiOutlineArrowRightOnRectangle className="h-4 w-4" />
          {t('auth.login')}
        </Link>
      ) : null}
    </GateShell>
  );
}

export default memo(ShareGateStates);
