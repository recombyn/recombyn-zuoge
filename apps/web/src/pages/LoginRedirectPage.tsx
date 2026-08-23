import { memo } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { buildLoginUrl } from '@/utils/authReturnTo';

/** Legacy `/login` → modal on `/home?login=1`. */
function LoginRedirectPage() {
  const [params] = useSearchParams();
  return <Navigate to={buildLoginUrl(params.get('from'))} replace />;
}

export default memo(LoginRedirectPage);
