import { memo, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { dismissHtmlBootSplash } from '@/components/base/AppLogo';
import DesktopTitlebar, {
  DesktopTitlebarProvider,
  useIsDesktopShell,
} from '@/components/layout/DesktopTitlebar';
import { LoginDialogHost } from '@/components/layout/LoginDialog';

function AppShell() {
  const desktop = useIsDesktopShell();

  useEffect(() => {
    // Drop residual HTML splash (home has none; editor hands off to boot overlay).
    dismissHtmlBootSplash();
  }, []);

  return (
    <DesktopTitlebarProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-[var(--canvas)]">
        {desktop ? <DesktopTitlebar /> : null}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <Outlet />
          <LoginDialogHost />
        </div>
      </div>
    </DesktopTitlebarProvider>
  );
}

export default memo(AppShell);
