import { memo, useLayoutEffect, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineHome, HiOutlineShare } from 'react-icons/hi2';
import { TbMessage2Filled } from 'react-icons/tb';
import { Tooltip } from '@/components/base';
import { CollabPresenceBar } from '@/components/editor/collab/CollabRoomProvider';
import { EditorTopExportButton } from '@/components/editor/panels/ExportSelectionPanel';
import { getAgentDockWidth } from '@/components/editor/panels/AgentDock';
import { getInspectDockWidth } from '@/components/editor/panels/DevPropertiesPanel';
import { useLeftDockInset } from '@/components/editor/page/editorBottomHudLayout';
import WalletAccountChip from '@/components/layout/WalletAccountChip';
import {
  useIsDesktopShell,
  useSetDesktopTitlebarLeading,
} from '@/components/layout/DesktopTitlebar';
import { flushCurrentProjectNow } from '@/components/editor/useProjectCloudSync';
import { cn } from '@/utils/classnames';

type Props = {
  projectName: string;
  workspaceMode: 'design' | 'dev';
  inspectOpen: boolean;
  agentOpen: boolean;
  layersOpen?: boolean;
  assetsOpen?: boolean;
  onGoHome: () => void;
  onRename: (name: string) => void;
  onShare: () => void;
  onOpenAgent: () => void;
};

type HomeTitleProps = {
  projectName: string;
  onGoHome: () => void;
  onRename: (name: string) => void;
  titleInputRef: RefObject<HTMLInputElement | null>;
  /** titlebar = compact chrome in desktop custom titlebar; float = canvas overlay */
  variant: 'float' | 'titlebar';
};

function EditorHomeTitleCluster({
  projectName,
  onGoHome,
  onRename,
  titleInputRef,
  variant,
}: HomeTitleProps) {
  const { t } = useTranslation();
  const titlebar = variant === 'titlebar';

  return (
    <div className={cn('flex items-center', titlebar ? 'gap-1.5' : 'gap-2')}>
      <Tooltip tip={t('editor.home', { defaultValue: '首页' })} placement="bottom">
        <button
          type="button"
          aria-label={t('editor.home', { defaultValue: '首页' })}
          onClick={onGoHome}
          className={cn(
            'inline-flex shrink-0 items-center justify-center text-[var(--ink)] transition',
            titlebar
              ? 'h-7 w-7 rounded-md hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]'
              : 'h-8 w-8 rounded-xl bg-[var(--accent-soft)] shadow-sm ring-1 ring-[var(--line)] hover:bg-[var(--line)]'
          )}
        >
          <HiOutlineHome className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </Tooltip>
      <span
        className={cn(
          'inline-grid min-w-0 items-center overflow-hidden',
          titlebar ? 'max-w-[min(18rem,40vw)]' : 'max-w-[min(16rem,calc(100vw-18rem))]'
        )}
      >
        <span
          className={cn(
            'invisible col-start-1 row-start-1 max-w-full truncate whitespace-pre px-1 font-medium',
            titlebar ? 'text-[13px]' : 'text-[14px]'
          )}
          aria-hidden
        >
          {projectName || ' '}
        </span>
        <input
          ref={titleInputRef}
          value={projectName}
          onChange={(e) => onRename(e.target.value)}
          aria-label={t('home.untitled')}
          title={projectName}
          className={cn(
            'col-start-1 row-start-1 w-full min-w-0 truncate border-0 bg-transparent px-1 font-medium text-[var(--ink)] outline-none placeholder:text-[var(--muted)]',
            titlebar ? 'h-7 text-[13px]' : 'h-8 text-[14px]'
          )}
        />
      </span>
    </div>
  );
}

function bindTitleInputBlurOnOutsidePointer(titleInputRef: RefObject<HTMLInputElement | null>) {
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

/** Top-left home/title + top-right export/share/account/chat. */
function EditorTopChrome({
  projectName,
  workspaceMode,
  inspectOpen,
  agentOpen,
  layersOpen = false,
  assetsOpen = false,
  onGoHome,
  onRename,
  onShare,
  onOpenAgent,
}: Props) {
  const { t } = useTranslation();
  const desktop = useIsDesktopShell();
  const leftTitleInsetPx = useLeftDockInset(layersOpen, assetsOpen);
  const setTitlebarLeading = useSetDesktopTitlebarLeading();
  const titleInputRef = useRef<HTMLInputElement>(null);
  const onGoHomeRef = useRef(onGoHome);
  const onRenameRef = useRef(onRename);
  onGoHomeRef.current = onGoHome;
  onRenameRef.current = onRename;

  // SVG canvas pointer handlers stopPropagation, so blank-canvas clicks never
  // blur this chrome input via the normal focus model — capture + blur like AgentComposerInput.
  useLayoutEffect(() => bindTitleInputBlurOnOutsidePointer(titleInputRef), []);

  // Desktop: home + filename live in the custom titlebar (no logo there).
  // Callbacks via refs so parent inline handlers do not re-stamp the titlebar every render.
  useLayoutEffect(() => {
    if (!desktop || !setTitlebarLeading) return;
    setTitlebarLeading(
      <EditorHomeTitleCluster
        projectName={projectName}
        onGoHome={() => onGoHomeRef.current()}
        onRename={(name) => onRenameRef.current(name)}
        titleInputRef={titleInputRef}
        variant="titlebar"
      />
    );
    return () => setTitlebarLeading(null);
  }, [desktop, setTitlebarLeading, projectName]);

  return (
    <>
      {!desktop ? (
        <div
          className="pointer-events-none absolute top-3 z-20 hidden md:block"
          style={{ left: leftTitleInsetPx }}
        >
          <div className="pointer-events-auto">
            <EditorHomeTitleCluster
              projectName={projectName}
              onGoHome={onGoHome}
              onRename={onRename}
              titleInputRef={titleInputRef}
              variant="float"
            />
          </div>
        </div>
      ) : null}

      <div
        className="pointer-events-none absolute top-3 z-40 hidden md:block"
        style={{
          right:
            workspaceMode === 'dev' && inspectOpen
              ? getInspectDockWidth() + 16
              : workspaceMode !== 'dev' && agentOpen
                ? getAgentDockWidth() + 16
                : 16,
        }}
      >
        <div className="pointer-events-auto flex items-center gap-2">
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
          <div className="inline-flex items-center gap-1">
            <CollabPresenceBar />
            <WalletAccountChip />
          </div>
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
      </div>
    </>
  );
}

export async function flushAndGoHome(navigate: (path: string) => void) {
  try {
    // Cover flush can hang on large multi-artboard projects — don't block leaving.
    await Promise.race([
      flushCurrentProjectNow({ force: true }),
      new Promise<void>((_, reject) => {
        window.setTimeout(() => reject(new Error('flush_home_timeout')), 8_000);
      }),
    ]);
  } catch {
    /* still navigate — local draft already holds bytes */
  }
  navigate('/home');
}

export default memo(EditorTopChrome);
