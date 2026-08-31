import { useEffect, useRef, useState, memo } from 'react';
import { useDispatch } from '@/store';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { activateEmailLink } from '@/service/auth';
import { getHttpErrorMessage } from '@/service/client';
import { setSession } from '@/store/modules/auth';
import { buildLoginUrl } from '@/utils/authReturnTo';

/**
 * Landing from SES magic link: https://recombyn.com/activate/{{id}}
 * Exchanges the one-time id for a session, then enters the app.
 */
function ActivateEmailPage() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = (id || '').trim();
    if (!token) {
      setError(t('auth.linkInvalid') || 'Invalid login link');
      return;
    }
    async function activateLink() {
      try {
        const res = await activateEmailLink({ id: token });
        dispatch(
          setSession({
            user: {
              email: res.user.email,
              name: res.user.name,
              provider: 'email',
              avatar: res.user.avatar,
              id: res.user.id,
            },
            token: res.token,
          })
        );
        navigate('/home', { replace: true });
      } catch (err) {
        const detail = getHttpErrorMessage(err, '');
        setError(detail || t('auth.linkInvalid') || 'Invalid or expired login link');
      }
    }
    activateLink();
  }, [dispatch, id, navigate, t]);

  if (error) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-16 text-center">
        <p className="text-[15px] text-[var(--ink)]">{error}</p>
        <Link
          to={buildLoginUrl()}
          className="mt-6 text-[14px] text-[var(--muted)] underline-offset-2 hover:underline"
        >
          {t('auth.login')}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-[15px] text-[var(--muted)]">
        {t('auth.activating') || 'Signing you in…'}
      </p>
    </div>
  );
}

export default memo(ActivateEmailPage);
