import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { dismissHtmlBootSplash } from '@/components/base/AppLogo';
import ProgressBar from '@/components/base/progress';
import { cn } from '@/utils/classnames';

type Props = {
  progress: number;
  exiting?: boolean;
};

const BOOT_BAR_WIDTH = 'min(220px, 56vw)';

/** Boot loader — fixed-width centered % bar (not brand wordmark). */
function EditorBootOverlay({ progress, exiting = false }: Props) {
  const { t } = useTranslation();
  const pct = Math.max(0, Math.min(100, Math.round(progress)));

  useEffect(() => {
    dismissHtmlBootSplash();
  }, []);

  return (
    <div
      className={cn(
        'fixed inset-0 z-[100] flex items-center justify-center bg-[var(--canvas)] transition-opacity duration-300',
        exiting ? 'pointer-events-none opacity-0' : 'opacity-100'
      )}
      role="progressbar"
      aria-busy="true"
      aria-label={t('editor.initializing')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div
        className="flex flex-col items-center gap-3"
        style={{ width: BOOT_BAR_WIDTH }}
      >
        <ProgressBar
          percent={pct}
          active
          height={6}
          format={false}
          aria-label={t('editor.initializing')}
        />
        <span className="text-[12px] tabular-nums text-[var(--muted)]">{pct}%</span>
      </div>
    </div>
  );
}

export default memo(EditorBootOverlay);
