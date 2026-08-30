/**
 * Timeline-open top strip:
 * left = avatar + drawing tools, center = path/pen docks (fig1/2), right = export/share/chat.
 */
import { memo, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineShare } from 'react-icons/hi2';
import { TbMessage2Filled } from 'react-icons/tb';
import { Tooltip } from '@/components/base';
import { CollabPresenceBar } from '@/components/editor/collab/CollabRoomProvider';
import EditorProjectMenu from '@/components/editor/chrome/EditorProjectMenu';
import { EditorTopExportButton } from '@/components/editor/panels/ExportSelectionPanel';
import EditorToolStrip from '@/components/editor/chrome/EditorToolStrip';

type ToolStripProps = Pick<
  ComponentProps<typeof EditorToolStrip>,
  'camera' | 'stageEl' | 'compact' | 'selectOnly'
>;

type Props = ToolStripProps & {
  onProjectList: () => void;
  onNewProject: () => void;
  onDuplicateProject: () => void;
  onImportJson: (file: File) => void;
  onShare: () => void;
  onOpenAgent: () => void;
  agentOpen: boolean;
  /** Path / pen / bucket dock — centered in this strip (one div). */
  centerDock?: ReactNode;
};

function EditorTimelineToolRail({
  camera,
  stageEl,
  compact = false,
  selectOnly = false,
  onProjectList,
  onNewProject,
  onDuplicateProject,
  onImportJson,
  onShare,
  onOpenAgent,
  agentOpen,
  centerDock = null,
}: Props): ReactNode {
  const { t } = useTranslation();

  return (
    <div
      className="pointer-events-auto relative flex w-full items-center justify-between gap-[15px] rounded-none border-b border-[var(--line)] bg-[var(--surface)] px-[15px] py-1"
      data-editor-timeline-tool-rail=""
      data-tour="editor-tools"
    >
      <div className="flex min-w-0 items-center gap-[15px]">
        <EditorProjectMenu
          onProjectList={onProjectList}
          onNewProject={onNewProject}
          onDuplicateProject={onDuplicateProject}
          onImportJson={onImportJson}
          variant="toolrail"
        />
        <div className="relative flex min-w-0 items-center">
          <span
            className="absolute -left-[8px] top-1/2 h-4 w-px -translate-y-1/2 bg-[var(--line)]"
            aria-hidden
          />
          <EditorToolStrip
            camera={camera}
            stageEl={stageEl}
            compact={compact}
            selectOnly={selectOnly}
            chrome="flat"
          />
        </div>
      </div>

      {centerDock ? (
        <div className="pointer-events-none absolute inset-y-0 left-1/2 flex -translate-x-1/2 items-center">
          {centerDock}
        </div>
      ) : null}

      <div className="flex shrink-0 items-center gap-[15px]">
        <EditorTopExportButton />
        <Tooltip tip={t('editor.share')} placement="bottom">
          <button
            type="button"
            aria-label={t('editor.share')}
            onClick={onShare}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-[var(--ink)] transition hover:bg-[var(--accent-soft)]"
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
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-[var(--ink)] transition hover:bg-[var(--accent-soft)]"
          >
            <TbMessage2Filled className="h-4 w-4 shrink-0 text-[var(--ink)]" />
            {t('editor.chat')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default memo(EditorTimelineToolRail);
