import { memo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HiOutlineArrowRightOnRectangle } from 'react-icons/hi2';
import EditorProjectMenu from '@/components/editor/chrome/EditorProjectMenu';
import { useLeftDockInset } from '@/components/editor/page/editorBottomHudLayout';

function GateShell({
  children,
  onProjectList,
  onNewProject,
  onDuplicateProject,
  onImportJson,
}: {
  children: React.ReactNode;
  onProjectList: () => void;
  onNewProject: () => void;
  onDuplicateProject: () => void;
  onImportJson: (file: File) => void;
}) {
  const leftHudInsetPx = useLeftDockInset(false);

  return (
    <div className="relative flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 bg-[var(--canvas)] px-6">
      <div
        className="pointer-events-none absolute top-3 z-20 hidden md:block"
        style={{ left: leftHudInsetPx }}
      >
        <div className="pointer-events-auto">
          <EditorProjectMenu
            onProjectList={onProjectList}
            onNewProject={onNewProject}
            onDuplicateProject={onDuplicateProject}
            onImportJson={onImportJson}
            variant="float"
          />
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
  onProjectList,
  onNewProject,
  onDuplicateProject,
  onImportJson,
}: {
  kind: 'missing' | 'forbidden';
  viewerId?: string;
  loginUrl: string;
  onProjectList: () => void;
  onNewProject: () => void;
  onDuplicateProject: () => void;
  onImportJson: (file: File) => void;
}) {
  const { t } = useTranslation();

  if (kind === 'missing') {
    return (
      <GateShell
        onProjectList={onProjectList}
        onNewProject={onNewProject}
        onDuplicateProject={onDuplicateProject}
        onImportJson={onImportJson}
      >
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
    <GateShell
      onProjectList={onProjectList}
      onNewProject={onNewProject}
      onDuplicateProject={onDuplicateProject}
      onImportJson={onImportJson}
    >
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
