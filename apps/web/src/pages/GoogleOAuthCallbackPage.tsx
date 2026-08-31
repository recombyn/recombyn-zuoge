import { useEffect, useRef, useState, memo } from 'react';

import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { loginGoogle } from '@/service/auth';
import { getHttpErrorMessage } from '@/service/client';
import { setSession } from '@/store/modules/auth';
import { buildLoginUrl } from '@/utils/authReturnTo';
import {
  consumeGoogleOAuthState,
  getGoogleRedirectUri,
} from '@/utils/googleOAuth';

/**
 * Handles return from Google full-page OAuth redirect.
 * Exchanges ?code= for a session, then navigates into the app.
 */
function GoogleOAuthCallbackPage() {
  const { t } = useTranslation();  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const err = params.get('error');
    const code = params.get('code');
    const state = params.get('state');
    const saved = consumeGoogleOAuthState(state);

    if (err) {
      setError(err);
      return;
    }
    if (!code || !saved) {
      setError(t('auth.googleFailed') || 'Google login failed');
      return;
    }

    async function completeGoogleLogin() {
      try {
        const res = await loginGoogle({
          code,
          redirectUri: getGoogleRedirectUri(),
        });
        setSession({
            user: {
              email: res.user.email,
              name: res.user.name,
              provider: 'google',
              avatar: res.user.avatar,
              id: res.user.id,
            },
            token: res.token,
          });
        navigate(saved.returnTo || '/home', { replace: true });
      } catch (e: unknown) {
        setError(getHttpErrorMessage(e, 'Google login failed'));
      }
    }
    completeGoogleLogin();
  }, [navigate, params, t]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-[var(--surface)] px-4 text-center">
      {error ? (
        <>
          <p className="max-w-md text-[14px] text-[var(--danger,#c0392b)]">{error}</p>
          <Link
            to={buildLoginUrl()}
            className="text-[14px] font-medium text-[var(--accent)] underline underline-offset-2"
          >
            {t('auth.backHome')}
          </Link>
        </>
      ) : (
        <p className="text-[14px] text-[var(--muted)]">
          {t('auth.googleRedirecting', { defaultValue: 'Signing in with Google…' })}
        </p>
      )}
    </div>
  );
}

export default memo(GoogleOAuthCallbackPage);
