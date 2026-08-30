import { memo, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineShare } from 'react-icons/hi2';
import { TbMessage2Filled } from 'react-icons/tb';
import { Tooltip } from '@/components/base';
import { CollabPresenceBar } from '@/components/editor/collab/CollabRoomProvider';
import EditorProjectMenu from '@/components/editor/chrome/EditorProjectMenu';
import EditorProjectTitle from '@/components/editor/chrome/EditorProjectTitle';
import { EditorTopExportButton } from '@/components/editor/panels/ExportSelectionPanel';
import { useLeftDockInset, useRightDockInset } from '@/components/editor/page/editorBottomHudLayout';
import {
  useIsDesktopShell,
  useSetDesktopTitlebarLeading,
} from '@/components/layout/DesktopTitlebar';
import { flushCurrentProjectNow } from '@/components/editor/useProjectCloudSync';
import { prepareProjectsListNavigation } from '@/service/projects';
import { cn } from '@/utils/classnames';

type Props = {
  projectName: string;
  workspaceMode: 'design' | 'dev';
  inspectOpen: boolean;
  agentOpen: boolean;
  layersOpen?: boolean;
  onRename: (name: string) => void;
  onProjectList: () => void;
  onNewProject: () => void;
  onDuplicateProject: () => void;
  onImportJson: (file: File) => void;
  onShare: () => void;
  onOpenAgent: () => void;
  /**
   * When set (e.g. timeline tool rail), left title + right actions + this strip
   * share one top chrome column (no separate floating pills).
   */
  belowBar?: ReactNode;
  /** Stage free-band insets when `belowBar` is shown (match timeline docks). */
  bandLeftPx?: number;
  bandRightPx?: number;
};

function bindTitleInputBlurOnOutsidePointer(titleInputRef: React.RefObject<HTMLInputElement | null>) {
  const onPointerDownCapture = (e: PointerEvent) => {
    const el = titleInputRef.current;
    if (!el || document.activeElement !== el) return;
    const target = e.target;
    if (!(target instanceof Node) || el.contains(target)) return;
    el.blur();
  };
  document.addEventListener('pointerdown', onPointerDownCapture, true);
  return () => document.removeEventListener('pointerdown', onPointerDownCapture, true);
}

/** Top-left project menu + top-right export/share/chat. */
function EditorTopChrome({
  projectName,
  workspaceMode,
  inspectOpen,
  agentOpen,
  layersOpen = false,
  onRename,
  onProjectList,
  onNewProject,
  onDuplicateProject,
  onImportJson,
  onShare,
  onOpenAgent,
  belowBar = null,
  bandLeftPx,
  bandRightPx,
}: Props) {
  const { t } = useTranslation();
  const desktop = useIsDesktopShell();
  const leftTitleInsetPx = useLeftDockInset(layersOpen);
  const rightHudInsetPx = useRightDockInset(agentOpen, inspectOpen, workspaceMode);
  const setTitlebarLeading = useSetDesktopTitlebarLeading();
  const titleInputRef = useRef<HTMLInputElement>(null);
  const onRenameRef = useRef(onRename);
  const onProjectListRef = useRef(onProjectList);
  const onNewProjectRef = useRef(onNewProject);
  const onDuplicateProjectRef = useRef(onDuplicateProject);
  const onImportJsonRef = useRef(onImportJson);
  onRenameRef.current = onRename;
  onProjectListRef.current = onProjectList;
  onNewProjectRef.current = onNewProject;
  onDuplicateProjectRef.current = onDuplicateProject;
  onImportJsonRef.current = onImportJson;

  const stacked = Boolean(belowBar);
  const leftPx = stacked ? (bandLeftPx ?? 0) : leftTitleInsetPx;
  const rightPx = stacked ? (bandRightPx ?? 0) : rightHudInsetPx;

  useLayoutEffect(() => bindTitleInputBlurOnOutsidePointer(titleInputRef), []);

  useLayoutEffect(() => {
    if (!desktop || !setTitlebarLeading) return;
    setTitlebarLeading(
      <div className="flex min-w-0 max-w-full items-center gap-2">
        <EditorProjectMenu
          onProjectList={() => onProjectListRef.current()}
          onNewProject={() => onNewProjectRef.current()}
          onDuplicateProject={() => onDuplicateProjectRef.current()}
          onImportJson={(file) => onImportJsonRef.current(file)}
          variant="titlebar"
        />
        <EditorProjectTitle
          projectName={projectName}
          onRename={(name) => onRenameRef.current(name)}
          inputRef={titleInputRef}
          variant="titlebar"
        />
      </div>
    );
    return () => setTitlebarLeading(null);
  }, [desktop, setTitlebarLeading, projectName]);

  const leftCluster = !desktop ? (
    <div className="flex min-w-0 max-w-full items-center gap-2">
      <EditorProjectMenu
        onProjectList={onProjectList}
        onNewProject={onNewProject}
        onDuplicateProject={onDuplicateProject}
        onImportJson={onImportJson}
        variant="float"
      />
      <EditorProjectTitle
        projectName={projectName}
        onRename={onRename}
        inputRef={titleInputRef}
        variant="float"
      />
    </div>
  ) : (
    <span className="min-w-0" aria-hidden />
  );

  const rightCluster = (
    <div className="flex shrink-0 items-center gap-2">
      <EditorTopExportButton />
      <Tooltip tip={t('editor.share')} placement="bottom">
        <button
          type="button"
          aria-label={t('editor.share')}
          onClick={onShare}
          className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--surface)] px-3 text-[13px] font-medium text-[var(--ink)] shadow-sm ring-1 ring-[var(--line)] transition hover:bg-[var(--accent-soft)]"
        >
          <HiOutlineShare className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          {t('editor.share')}
        </button>
      </Tooltip>
      <CollabPresenceBar />
      {!agentOpen ? (
        <button
          type="button"
          onClick={onOpenAgent}
          className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--surface)] px-3 text-[13px] font-medium text-[var(--ink)] shadow-sm ring-1 ring-[var(--line)] transition hover:bg-[var(--accent-soft)]"
        >
          <TbMessage2Filled className="h-4 w-4 shrink-0 text-[var(--ink)]" />
          {t('editor.chat')}
        </button>
      ) : null}
    </div>
  );

  // Timeline mode: no separate title row — only the tool rail.
  if (stacked) {
    return (
      <div
        className="pointer-events-none absolute top-0 z-40 hidden md:block"
        style={{ left: leftPx, right: rightPx }}
        data-editor-top-stack=""
      >
        {belowBar}
      </div>
    );
  }

  // Default: floating clusters (design canvas without timeline dock).
  return (
    <>
      {!desktop ? (
        <div
          className="pointer-events-none absolute top-3 z-20 hidden md:block"
          style={{ left: leftTitleInsetPx }}
        >
          <div className="pointer-events-auto">{leftCluster}</div>
        </div>
      ) : null}

      <div
        className="pointer-events-none absolute top-3 z-40 hidden md:block"
        style={{ right: rightHudInsetPx }}
      >
        <div className="pointer-events-auto">{rightCluster}</div>
      </div>
    </>
  );
}

export async function flushAndGoHome(
  navigate: (path: string) => void,
  path = '/home',
  opts?: { refreshProjectsList?: boolean }
) {
  try {
    await Promise.race([
      flushCurrentProjectNow({ force: true }),
      new Promise<void>((_, reject) => {
        window.setTimeout(() => reject(new Error('flush_home_timeout')), 8_000);
      }),
    ]);
  } catch {
    /* still navigate — local draft already holds bytes */
  }
  if (opts?.refreshProjectsList) {
    try {
      await prepareProjectsListNavigation();
    } catch {
      /* navigate anyway — Home mount will retry */
    }
  }
  navigate(path);
}

export default memo(EditorTopChrome);
