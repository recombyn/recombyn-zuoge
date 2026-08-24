import { forwardRef, type ReactNode, type Ref, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineTrash } from 'react-icons/hi2';
import { Tooltip } from '@/components/base';
import {
  VirtualList,
  type VirtualListHandle,
} from '@/components/base/VirtualList';
import ChatTurnList, {
  type AskChoicePick,
  type ChatTurn,
  type ChatUiMessage,
} from '@/components/editor/panels/agent/messages/ChatTurnList';
import { cn } from '@/utils/classnames';

export type AgentChatSessionRow = {
  id: string;
  title: string;
  updatedAt: number;
  messages: unknown[];
};

type AgentMessageListProps = {
  historyOpen: boolean;
  sessions: AgentChatSessionRow[];
  sessionId: string | null;
  turns: ChatTurn[];
  editingUserId: string | null;
  editComposer?: ReactNode;
  sending: boolean;
  formatWorked: (assistant?: ChatUiMessage) => string | null;
  hasCheckpoint: (userId: string) => boolean;
  onBeginEdit: (m: ChatUiMessage) => void;
  onCancelEdit: () => void;
  onRestore: (userId: string) => void;
  onChoice?: (choice: AskChoicePick) => void;
  onResume?: (assistantId: string) => void;
  onDismissResume?: (assistantId: string) => void;
  onOpenSession: (session: AgentChatSessionRow) => void;
  onDeleteSession: (id: string) => void;
  formatChatTime: (ts: number) => string;
  className?: string;
};

/**
 * Agent dock message pane: history / empty / virtualized turn list.
 * Outer shell is overflow-hidden flex child; VirtualList owns scroll.
 */
const AgentMessageList = forwardRef(function AgentMessageList(
  {
    historyOpen,
    sessions,
    sessionId,
    turns,
    editingUserId,
    editComposer,
    sending,
    formatWorked,
    hasCheckpoint,
    onBeginEdit,
    onCancelEdit,
    onRestore,
    onChoice,
    onResume,
    onOpenSession,
    onDeleteSession,
    formatChatTime,
    className,
  }: AgentMessageListProps,
  ref: Ref<VirtualListHandle>
) {
  const { t } = useTranslation();

  if (historyOpen) {
    if (sessions.length === 0) {
      return (
        <div
          className={cn(
            'relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-4 py-2',
            className
          )}
        >
          <p className="text-left text-[13px] text-[var(--muted)]">{t('agent.noHistory')}</p>
        </div>
      );
    }

    return (
      <VirtualList
        ref={ref}
        items={sessions}
        estimateSize={56}
        overscan={8}
        gap={2}
        getItemKey={(s) => s.id}
        className={cn('px-4 py-2', className)}
        contentClassName="py-1"
      >
        {(s) => {
          const active = s.id === sessionId;
          return (
            <div
              className={cn(
                'group flex w-full items-center gap-2 rounded px-2.5 py-2 transition-colors',
                active ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--accent-soft)]'
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => onOpenSession(s)}
              >
                <div className="truncate text-[13px] text-[var(--ink)]">{s.title}</div>
                <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                  {formatChatTime(s.updatedAt)}
                  {' · '}
                  {t('agent.messageCount', { count: s.messages.length })}
                </div>
              </button>
              <Tooltip tip={t('agent.delete')} placement="top">
                <button
                  type="button"
                  aria-label={t('agent.delete')}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--muted)] opacity-0 transition hover:bg-[var(--surface)] hover:text-red-500 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(s.id);
                  }}
                >
                  <HiOutlineTrash className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </div>
          );
        }}
      </VirtualList>
    );
  }

  return (
    <ChatTurnList
      ref={ref}
      turns={turns}
      editingUserId={editingUserId}
      editComposer={editComposer}
      sending={sending}
      formatWorked={formatWorked}
      hasCheckpoint={hasCheckpoint}
      onBeginEdit={onBeginEdit}
      onCancelEdit={onCancelEdit}
      onRestore={onRestore}
      onChoice={onChoice}
      onResume={onResume}
      className={className}
    />
  );
});

export default memo(AgentMessageList);