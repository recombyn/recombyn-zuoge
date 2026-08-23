import { lazy, Suspense, useEffect, useState, memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v6';
import { ProgressBar, advanceBootProgress, readBootProgress } from '@/components/base';
import AppShell from '@/components/layout/AppShell';
import HomePage from '@/pages/HomePage';
import LoginRedirectPage from '@/pages/LoginRedirectPage';
import ActivateEmailPage from '@/pages/ActivateEmailPage';
import GoogleOAuthCallbackPage from '@/pages/GoogleOAuthCallbackPage';
import { RequireAuth } from '@/router/AuthGuards';
import { buildLoginUrl } from '@/utils/authReturnTo';
import {
  basenameToI18nLang,
  getLocaleBasename,
} from '@/i18n/localePath';

const AccountSettingsPage = lazy(() => import('@/pages/AccountSettingsPage'));
const EditorPage = lazy(() => import('@/pages/EditorPage'));
const SharePage = lazy(() => import('@/pages/SharePage'));

/** Chunk load (editor / share / account) — continues HTML splash high-water. Home is eager. */
function RouteFallback(): ReactNode {
  const [pct, setPct] = useState(() => Math.max(8, readBootProgress()));
  useEffect(() => {
    advanceBootProgress(pct);
    const id = window.setInterval(() => {
      setPct((p) => {
        const next = p >= 70 ? p : Math.min(70, p + 2);
        return advanceBootProgress(next);
      });
    }, 220);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- climb once per fallback mount
  }, []);

  return (
    <div
      className="flex h-full min-h-0 w-full items-center justify-center bg-[var(--canvas)]"
      aria-busy="true"
    >
      <div className="flex flex-col items-center gap-3" style={{ width: 'min(220px, 56vw)' }}>
        <ProgressBar percent={pct} active height={6} format={false} />
        <span className="text-[12px] tabular-nums text-[var(--muted)]">{pct}%</span>
      </div>
    </div>
  );
}

function LazyRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

/** Product routes set app document title. */
function DocumentTitleSync() {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    document.title = t('app.documentTitle');
  }, [t, i18n.language]);
  return null;
}

/** Keep i18n in sync when basename (URL locale prefix) is active. */
function LocaleSync({ basename }: { basename: string }) {
  const { i18n } = useTranslation();
  useEffect(() => {
    const next = basenameToI18nLang(basename);
    if (i18n.language === next) return;
    async function syncLang() {
      try {
        await i18n.changeLanguage(next);
      } catch {
        /* ignore */
      }
    }
    syncLang();
  }, [basename, i18n]);
  return null;
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        {/* Product entry: `/` → home (not marketing landing). */}
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="login" element={<LoginRedirectPage />} />
        <Route path="activate/:id" element={<ActivateEmailPage />} />
        <Route path="register" element={<Navigate to={buildLoginUrl()} replace />} />
        <Route path="forgot-password" element={<Navigate to={buildLoginUrl()} replace />} />
        {/* OAuth return can finish signing in without the login modal. */}
        <Route path="login/google/callback" element={<GoogleOAuthCallbackPage />} />

        {/* Product workspace — Home stays eager for first paint. */}
        <Route path="home" element={<HomePage />} />
        <Route
          path="s/:shareId"
          element={
            <LazyRoute>
              <SharePage />
            </LazyRoute>
          }
        />

        <Route element={<RequireAuth />}>
          <Route
            path="account"
            element={
              <LazyRoute>
                <AccountSettingsPage />
              </LazyRoute>
            }
          />
          {/* One route so /editor → /editor/:id does not remount and drop home-agent draft. */}
          <Route
            path="editor/:projectId?"
            element={
              <LazyRoute>
                <EditorPage />
              </LazyRoute>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/home" replace />} />
      </Route>
    </Routes>
  );
}

/**
 * Locale via URL prefix:
 * - `/home` → English (default, no prefix)
 * - `/zh/home`, `/zh-tw/home`, `/ja/home` → basename so Link/navigate stay unchanged
 */
function AppRouter() {
  const [basename] = useState(() => getLocaleBasename());

  return (
    <BrowserRouter basename={basename || undefined} key={basename || 'en'}>
      <NuqsAdapter>
        <LocaleSync basename={basename} />
        <DocumentTitleSync />
        <AppRoutes />
      </NuqsAdapter>
    </BrowserRouter>
  );
}

export default memo(AppRouter);
