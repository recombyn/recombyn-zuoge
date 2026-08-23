import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BiMessageSquareAdd, BiTimeFive } from 'react-icons/bi';
import { LuPanelRight } from 'react-icons/lu';
import { SegmentedControl, Tooltip } from '@/components/base';
import { cn } from '@/utils/classnames';

export type AgentEngineMode = 'agent' | 'cli';

export type CodingCliOption = {
  id: string;
  name: string;
  available: boolean;
};

type Props = {
  title: string;
  historyOpen: boolean;
  showNewChatTip?: boolean;
  showClose?: boolean;
  onNewChat: () => void;
  onToggleHistory: () => void;
  onClose?: () => void;
  /** Desktop shell: Agent vs local coding CLI (mutually exclusive). */
  engineMode?: AgentEngineMode;
  onEngineModeChange?: (mode: AgentEngineMode) => void;
  codingClis?: CodingCliOption[];
  codingCliId?: string;
  onCodingCliChange?: (id: string) => void;
};

/**
 * Agent dock top bar — title, new chat, history, optional close.
 */
function AgentDockHeader({
  title,
  historyOpen,
  showNewChatTip = false,
  showClose = false,
  onNewChat,
  onToggleHistory,
  onClose,
  engineMode,
  onEngineModeChange,
  codingClis,
  codingCliId,
  onCodingCliChange,
}: Props): ReactNode {
  const { t } = useTranslation();
  const availableClis = (codingClis || []).filter((c) => c.available);
  // Hide Agent/CLI chrome entirely when no coding CLI is on PATH.
  const showEngine = Boolean(
    engineMode && onEngineModeChange && availableClis.length > 0
  );

  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0 truncate text-[15px] font-semibold text-[var(--ink)]">
          {historyOpen ? t('agent.history') : title}
        </span>
        {showEngine && !historyOpen && engineMode && onEngineModeChange ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <SegmentedControl
              size="xs"
              radius="full"
              aria-label="Agent engine"
              value={engineMode}
              onChange={onEngineModeChange}
              options={[
                {
                  value: 'agent',
                  label: t('agent.engineAgent'),
                  title: t('agent.engineAgentTip'),
                },
                {
                  value: 'cli',
                  label: t('agent.engineCli'),
                  title: t('agent.engineCliTip'),
                },
              ]}
            />
            {engineMode === 'cli' && onCodingCliChange ? (
              <select
                aria-label={t('agent.engineCliPick')}
                className="h-[26px] max-w-[9rem] truncate rounded-full border border-[var(--line)] bg-[var(--surface)] px-2 text-[11px] text-[var(--ink)] outline-none"
                value={codingCliId || availableClis[0]?.id || ''}
                onChange={(e) => onCodingCliChange(e.target.value)}
              >
                {availableClis.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="relative flex shrink-0 items-center gap-0.5">
        <Tooltip
          tip={showNewChatTip ? t('agent.alreadyNewChat') : t('agent.newChat')}
          placement="bottom"
          open={showNewChatTip ? true : undefined}
        >
          <button
            type="button"
            aria-label={t('agent.newChat')}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
            onClick={onNewChat}
          >
            <BiMessageSquareAdd className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip tip={t('agent.history')} placement="bottom">
          <button
            type="button"
            aria-label={t('agent.history')}
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]',
              historyOpen && 'bg-[var(--accent-soft)] text-[var(--ink)]'
            )}
            onClick={onToggleHistory}
          >
            <BiTimeFive className="h-[18px] w-[18px]" />
          </button>
        </Tooltip>
        {showClose && onClose ? (
          <Tooltip tip={t('agent.closePanel')} placement="bottom">
            <button
              type="button"
              aria-label={t('agent.closePanel')}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
              onClick={onClose}
            >
              <LuPanelRight className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

export default AgentDockHeader;
