import { useEffect, memo } from 'react';
import { useSelector } from '@/store';
import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { logout, clearSessionCaches } from '@/store/modules/auth';
import { buildLoginUrl, readReturnToParam } from '@/utils/authReturnTo';
import { getToken } from '@/utils/token';

/** Protects editor (and any other auth-only routes). Guests — login?from=—*/
function RequireAuth() {
  const user = useSelector((state: any) => state.auth.user);
  const location = useLocation();
  const hasToken = Boolean(getToken());

  if (!user || !hasToken) {
    return (
      <Navigate
        to={buildLoginUrl(location.pathname + location.search)}
        replace
      />
    );
  }

  return <Outlet />;
}

/** Login / register only. Signed-in users follow ?from= or /home. */
function GuestOnly() {
  const user = useSelector((state: any) => state.auth.user);  const [params] = useSearchParams();
  const hasToken = Boolean(getToken());

  // Stale user blob without a session token (e.g. raced getMe after logout).
  useEffect(() => {
    if (user && !hasToken) {
      logout();
      clearSessionCaches();
    }
  }, [user, hasToken]);

  if (user && hasToken) {
    return <Navigate to={readReturnToParam(params)} replace />;
  }

  return <Outlet />;
}

const MemoizedRequireAuth = memo(RequireAuth);
export { MemoizedRequireAuth as RequireAuth };
const MemoizedGuestOnly = memo(GuestOnly);
export { MemoizedGuestOnly as GuestOnly };
