import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineChevronRight } from 'react-icons/hi2';
import { resolveApiUrl } from '@/utils/apiBase';
import { getToken } from '@/utils/token';

type LongSuggestion = { kind: string; text: string };

type Props = {
  pendingReview?: boolean;
  onUndoReview?: () => void;
  onKeepReview?: () => void;
  onReview?: () => void;
  pendingLongSuggestions?: LongSuggestion[];
  onIgnoreLongSuggestion?: (index: number) => void;
  onSavedLongSuggestion?: (index: number) => void;
  /** Main composer (AgentComposerShell). */
  composer: ReactNode;
};

/**
 * Dock bottom chrome — optional review / memory chips + composer card.
 */
function AgentDockComposerFooter({
  pendingReview = false,
  onUndoReview,
  onKeepReview,
  onReview,
  pendingLongSuggestions = [],
  onIgnoreLongSuggestion,
  onSavedLongSuggestion,
  composer,
}: Props): ReactNode {
  const { t } = useTranslation();

  return (
    <div className="relative shrink-0 px-3 pb-3 pt-0.5" data-tour="editor-agent-chat">
      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--canvas)] shadow-[0_4px_20px_rgba(0,0,0,0.08)]">
        {pendingReview ? (
          <div className="flex h-9 items-center gap-2 px-3">
            <HiOutlineChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
            <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--muted)]">
              {t('agent.reviewHint')}
            </span>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                className="inline-flex h-7 items-center rounded-md px-2 text-[12px] text-[var(--ink)] hover:bg-[var(--accent-soft)]"
                onClick={onUndoReview}
              >
                {t('agent.undo')}
              </button>
              <button
                type="button"
                className="inline-flex h-7 items-center rounded-md px-2 text-[12px] text-[var(--ink)] hover:bg-[var(--accent-soft)]"
                onClick={onKeepReview}
              >
                {t('agent.keep')}
              </button>
              <button
                type="button"
                className="inline-flex h-7 items-center rounded-md bg-[var(--accent-soft)] px-2.5 text-[12px] font-medium text-[var(--ink)] hover:bg-[var(--line)]"
                onClick={onReview}
              >
                {t('agent.review')}
              </button>
            </div>
          </div>
        ) : null}
        {pendingLongSuggestions.length > 0 ? (
          <div className="border-t border-[var(--line)] px-3 py-2">
            <p className="mb-1.5 text-[11px] text-[var(--muted)]">
              {t('agent.longMemorySuggestHint', '记住这个偏好？')}
            </p>
            {pendingLongSuggestions.map((s, i) => (
              <div key={i} className="mb-1.5 flex items-start gap-2">
                <span className="mt-0.5 min-w-0 flex-1 text-[11px] leading-4 text-[var(--ink)]">
                  {s.text}
                </span>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-[11px] text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
                    onClick={() => onIgnoreLongSuggestion?.(i)}
                  >
                    {t('agent.longMemoryIgnore', '忽略')}
                  </button>
                  <button
                    type="button"
                    className="rounded bg-[var(--accent)] px-1.5 py-0.5 text-[11px] font-medium text-white hover:opacity-90"
                    onClick={() => {
                      async function saveLongMemorySuggestion() {
                        try {
                          await fetch(resolveApiUrl('/api/v1/design/memory/long'), {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              Authorization: `Bearer ${getToken()}`,
                            },
                            body: JSON.stringify({ kind: s.kind, text: s.text }),
                          });
                        } catch {
                          /* silently ignore */
                        }
                      }
                      saveLongMemorySuggestion();
                      onSavedLongSuggestion?.(i);
                    }}
                  >
                    {t('agent.longMemorySave', '记住')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <div>{composer}</div>
      </div>
    </div>
  );
}

export default AgentDockComposerFooter;
