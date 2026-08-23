import { useEffect, memo } from 'react';
import { useDispatch } from 'react-redux';
import { loginDesktopLocal } from '@/service/auth';
import { apiQuery, queryClient } from '@/service/client';
import { clearProjectsListCache } from '@/service/projects';
import { clearWalletCache } from '@/service/wallet';
import AppRouter from '@/router';
import { logout, setSession, clearSessionCaches } from '@/store/modules/auth';
import { clearProjectsLibrary } from '@/store/modules/editor';
import { getDesktopMode } from '@/utils/apiBase';
import { getToken, setToken } from '@/utils/token';

function applySessionUser(
  dispatch: ReturnType<typeof useDispatch>,
  user: {
    id?: string;
    email: string;
    name: string;
    avatar?: string | null;
    provider: string;
    bio?: string | null;
    role?: string;
  },
  token?: string
) {
  dispatch(
    setSession({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        provider: user.provider,
        bio: user.bio,
        role: user.role,
      },
      token,
    })
  );
}

async function runQuietly(task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch {
    /* ignore */
  }
}

function App() {
  const dispatch = useDispatch();

  useEffect(() => {
    const onUnauthorized = () => {
      dispatch(logout());
      dispatch(clearProjectsLibrary());
      clearSessionCaches();
      clearProjectsListCache();
      clearWalletCache();
    };
    window.addEventListener('recombine:auth-unauthorized', onUnauthorized);
    return () => window.removeEventListener('recombine:auth-unauthorized', onUnauthorized);
  }, [dispatch]);

  // Boot: desktop-local auto-login as OS user; then prefetch me + wallet into Query.
  useEffect(() => {
    let cancelled = false;

    async function prefetchWallet() {
      if (!getToken()) return;
      await runQuietly(async () => {
        await queryClient.prefetchQuery({
          ...apiQuery.walletWalletMe.queryOptions(),
          staleTime: 30_000,
        });
      });
    }

    async function refreshMe() {
      if (!getToken()) return false;
      try {
        const res = (await queryClient.fetchQuery({
          ...apiQuery.authAuthMe.queryOptions(),
          staleTime: 30_000,
        })) as {
          user: {
            id?: string;
            email: string;
            name: string;
            avatar?: string | null;
            provider: string;
            bio?: string | null;
            role?: string;
          };
        };
        if (cancelled || !getToken()) return false;
        applySessionUser(dispatch, res.user, getToken() || undefined);
        return true;
      } catch {
        return false;
      }
    }

    async function ensureDesktopLocalSession() {
      if (getDesktopMode() !== 'local') return;
      if (getToken()) {
        const ok = await refreshMe();
        if (ok || cancelled) return;
        // Stale cloud / old-DB token — drop and auto-provision local OS user.
        setToken(null);
        dispatch(logout());
        clearSessionCaches();
        clearWalletCache();
      }
      if (getToken() || cancelled) return;
      try {
        const res = await loginDesktopLocal();
        if (cancelled) return;
        applySessionUser(dispatch, res.user, res.token);
      } catch {
        /* flag off or API not ready */
      }
    }

    async function prefetchBillingFlag() {
      await runQuietly(async () => {
        await queryClient.prefetchQuery({
          ...apiQuery.authAuthConfig.queryOptions(),
          staleTime: 60_000,
        });
      });
    }

    async function boot() {
      // Public flag first so credit UI stays hidden before wallet sync.
      await prefetchBillingFlag();
      if (cancelled) return;
      await ensureDesktopLocalSession();
      if (cancelled) return;
      if (getDesktopMode() !== 'local') {
        await refreshMe();
      }
      await prefetchWallet();
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  return <AppRouter />;
}

export default memo(App);
