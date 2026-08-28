import type { Store } from '@reduxjs/toolkit';
import { message } from '@/components/base';
import type { DesignScene } from '@/service/design';
import {
  applyActivityEventToSteps,
  applyAnalysisDeltaToSteps,
  applyThinkingBodyToSteps,
  activityItemTone,
  buildChatProcessSteps,
  formatActivityLabel,
  formatGovernanceLaneItems,
  localizeExploreItem,
  normalizeActivityStatus,
  type ChatUiMessage,
} from '@/components/editor/panels/agent/messages/ChatTurnList';
import {
  type AgentStepEvent,
  type DesignIntelligencePatch,
} from '@/components/editor/panels/agent/runDesignAgent';
import type { DesignSendMutable } from '@/components/editor/panels/agent/agentSendPath';
import { localizeAgentProcessCopy } from '@/components/editor/panels/agent/agentProcessI18n';
import { refreshWalletAfterSpend } from '@/service/wallet';

type TFn = (key: string, opts?: Record<string, unknown>) => string;

export function mergeDesignIntelligence(
  prev: DesignIntelligencePatch | undefined,
  patch: DesignIntelligencePatch
): DesignIntelligencePatch {
  const next: DesignIntelligencePatch = { ...(prev || {}) };
  if (patch.reference) {
    next.reference = { ...(prev?.reference || {}), ...patch.reference };
    if (patch.reference.dna) {
      next.reference.dna = { ...(prev?.reference?.dna || {}), ...patch.reference.dna };
    }
  }
  if (patch.review) {
    next.review = { ...(prev?.review || {}), ...patch.review };
  }
  if (patch.governance) {
    next.governance = { ...(prev?.governance || {}), ...patch.governance };
    if (patch.governance.lanes) {
      next.governance.lanes = patch.governance.lanes;
    }
    if (patch.governance.explain) {
      next.governance.explain = patch.governance.explain;
    }
  }
  if (patch.diff) {
    next.diff = { ...(prev?.diff || {}), ...patch.diff };
  }
  if (patch.summary) {
    next.summary = { ...(prev?.summary || {}), ...patch.summary };
  }
  if (patch.iterations?.length) {
    const byKey = new Map<string, NonNullable<DesignIntelligencePatch['iterations']>[number]>();
    for (const row of prev?.iterations || []) {
      byKey.set(`${row.iteration}:${row.overall}`, row);
    }
    for (const row of patch.iterations) {
      const key =
        row.overall > 0
          ? `${row.iteration}:${row.overall}`
          : `d:${row.iteration}:${row.decision || ''}`;
      const prevRow = byKey.get(`${row.iteration}:${row.overall}`) || byKey.get(key);
      byKey.set(key, { ...(prevRow || {}), ...row });
    }
    next.iterations = Array.from(byKey.values()).sort(
      (a, b) => a.iteration - b.iteration || a.overall - b.overall
    );
  }
  return next;
}

const DETAIL_SUMMARY_KINDS = new Set([
  'tool',
  'skipped',
  'added',
  'updated',
  'deleted',
]);
const SUCCESS_VARIANT_KINDS = new Set(['added', 'updated', 'deleted']);
const CONFIRM_VARIANT_KINDS = new Set(['thought', 'explored', 'tool']);

function activityRowSummary(opts: {
  kind: string;
  label: string;
  detailText: string;
  summaryText: string;
  bodyText?: string;
}): string | undefined {
  const { kind, label, detailText, summaryText, bodyText } = opts;
  const body = (bodyText || '').trim();
  if (summaryText && summaryText !== label && summaryText !== body) {
    return summaryText;
  }
  if (!DETAIL_SUMMARY_KINDS.has(kind)) return undefined;
  if (detailText && detailText !== label && detailText !== body) return detailText;
  return undefined;
}

function activityRowVariant(
  status: 'running' | 'done' | 'error',
  kind: string
): 'success' | 'confirm' | undefined {
  if (status === 'error') return undefined;
  if (SUCCESS_VARIANT_KINDS.has(kind)) return 'success';
  if (CONFIRM_VARIANT_KINDS.has(kind)) return 'confirm';
  return undefined;
}

function activityNestItem(
  t: TFn,
  item: { id?: string; name?: string; summary?: string; tone?: 'ok' | 'warn' | 'error' } | undefined,
  tone?: 'ok' | 'warn' | 'error'
) {
  if (!item || !(item.name || item.id)) return null;
  return localizeExploreItem(t, {
    id: String(item.id || `item-${Date.now()}`),
    name: String(item.name || '').trim() || '…',
    summary: item.summary ? String(item.summary) : undefined,
    tone: item.tone || tone,
  });
}

type FinishAssistant = (
  m: ChatUiMessage,
  patch?: Partial<ChatUiMessage>
) => ChatUiMessage;

function patchChatDoneAssistant(
  m: ChatUiMessage,
  opts: {
    t: TFn;
    finish: FinishAssistant;
    proposedOps?: ChatUiMessage['proposedOps'];
    proposalId?: string;
    choiceUi?: ChatUiMessage['choiceUi'];
  }
): ChatUiMessage {
  return opts.finish(m, {
    content: (m.content || '').trim(),
    thinking: undefined,
    pipeline: undefined,
    drawing: undefined,
    intent: undefined,
    proposedOps: opts.proposedOps?.length ? opts.proposedOps : undefined,
    proposalId: opts.proposalId || undefined,
    choiceUi: opts.choiceUi,
    steps: buildChatProcessSteps(opts.t, m),
  });
}

/** True when analysis/thinking already landed in structured `steps` (not final bubble). */
export function hasStructuredProcess(steps: ChatUiMessage['steps']): boolean {
  return (steps || []).some((s) => {
    if (s.kind !== 'thought' && s.kind !== 'explored') return false;
    return Boolean((s.summary || s.body || '').trim());
  });
}

/**
 * Final assistant bubble after design `done`.
 * Progress lives in `steps` / analysis_delta / activity / phase — never invent product copy.
 * Prefer `summary` (done event) / streamed tokens only; empty bubble is OK when the canvas is the result.
 */
export function pickDesignDoneContent(opts: {
  t: TFn;
  summary?: string;
  streamedContent: string;
  steps: ChatUiMessage['steps'];
  painted: boolean;
  designStarted: boolean;
  hasProposedOps: boolean;
}): string {
  const summary = (opts.summary || '').trim();
  const streamed = opts.streamedContent.trim();

  if (opts.hasProposedOps) return summary || streamed;
  if (opts.painted) return summary || streamed;
  // Design ran but no paint — keep backend summary only; drop mid-run stream ("正在生成…").
  if (opts.designStarted) return summary;
  return streamed || summary;
}

function patchDesignDoneAssistant(
  m: ChatUiMessage,
  opts: {
    t: TFn;
    finish: FinishAssistant;
    painted: boolean;
    designStarted: boolean;
    summary?: string;
    proposedOps?: ChatUiMessage['proposedOps'];
    proposalId?: string;
    choiceUi?: ChatUiMessage['choiceUi'];
  }
): ChatUiMessage {
  const result = pickDesignDoneContent({
    t: opts.t,
    summary: opts.summary,
    streamedContent: m.content || '',
    steps: m.steps,
    painted: opts.painted,
    designStarted: opts.designStarted,
    hasProposedOps: Boolean(opts.proposedOps?.length),
  });
  return opts.finish(m, {
    content: result,
    thinking: undefined,
    pipeline: undefined,
    drawing: undefined,
    intent: undefined,
    proposedOps: opts.proposedOps?.length ? opts.proposedOps : undefined,
    proposalId: opts.proposalId || undefined,
    choiceUi: opts.choiceUi,
    steps: (m.steps || []).map((s) => ({
      ...s,
      status: s.status === 'error' ? s.status : ('done' as const),
    })),
  });
}

/** Display backend SSE/REST error text; FE fallback only when message is absent. */
export function humanizeDesignError(
  t: (key: string, opts?: Record<string, unknown>) => string,
  code?: string | null,
  message?: string | null
): string {
  const detail = String(message || '').trim();
  const codeN = String(code || '').trim();
  const blob = `${codeN} ${detail}`.toLowerCase();
  if (
    blob.includes('checkpoint_unavailable') ||
    blob.includes('lost connection') ||
    blob.includes('server has gone away') ||
    /^\(?\s*0\s*,/.test(detail) ||
    /^\(?\s*2013\s*,/.test(detail)
  ) {
    return t('agent.checkpointUnavailable');
  }
  if (detail) return detail;
  if (codeN) return codeN;
  return t('agent.requestFailed');
}

/** Display backend UX tip text; FE fallback only when text is absent. */
export function humanizeDesignUxTip(
  t: (key: string, opts?: Record<string, unknown>) => string,
  code?: string | null,
  params?: Record<string, string> | null,
  fallbackText?: string | null
): string {
  void code;
  void params;
  const text = String(fallbackText || '').trim();
  if (text) return text;
  return t('agent.requestFailed');
}

export function assistantDurationMs(
  m: ChatUiMessage,
  patch: Partial<ChatUiMessage>
): number | undefined {
  if (typeof patch.durationMs === 'number') return patch.durationMs;
  if (m.startedAt) return Date.now() - m.startedAt;
  return m.durationMs;
}

export type { DesignSendMutable };

export function createDesignAgentEventRouter(opts: {
  t: TFn;
  assistantId: string;
  userMsg: ChatUiMessage;
  chipNorm: string;
  setMessages: (updater: (prev: ChatUiMessage[]) => ChatUiMessage[]) => void;
  setImageAspectRatio: (next: string) => void;
  setDesignScene: (scene: DesignScene) => void;
  designSceneRef: { current: DesignScene | null };
  lastAgentFrameIdRef: { current: string | null };
  lastAgentSvgByFrameRef: { current: Map<string, string> };
  checkpointsRef: { current: Map<string, any> };
  store: Store;
  finishAssistantPatch: (m: ChatUiMessage, patch?: Partial<ChatUiMessage>) => ChatUiMessage;
  mutable: DesignSendMutable;
  /** Host meta: clear chat / stop generation. */
  onSessionControl?: (action: string) => void;
}) {
  // Model analysis can arrive in very small SSE chunks. Coalesce updates to one
  // React state update per frame, but flush before every semantic event so the
  // timeline never appears after the action it describes.
  let pendingAnalysisDelta = '';
  let analysisFrame: number | null = null;

  const flushAnalysisDelta = () => {
    if (analysisFrame != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(analysisFrame);
    }
    analysisFrame = null;
    const piece = pendingAnalysisDelta;
    pendingAnalysisDelta = '';
    if (!piece) return;
    opts.setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== opts.assistantId) return m;
        const next = applyAnalysisDeltaToSteps(m.steps || [], piece);
        return next ? { ...m, steps: next } : m;
      })
    );
  };

  const scheduleAnalysisDeltaFlush = () => {
    if (analysisFrame != null) return;
    analysisFrame = requestAnimationFrame(() => flushAnalysisDelta());
  };

  const handleUiChat = () => {
    opts.mutable.designStarted = false;
    opts.setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== opts.assistantId) return m;
        return opts.finishAssistantPatch(m, {
          content: (m.content || '').trim(),
          steps: buildChatProcessSteps(opts.t, m),
          thinking: undefined,
          pipeline: undefined,
          drawing: undefined,
          intent: undefined,
        });
      })
    );
  };

  const handleUiToken = (ev: Extract<AgentStepEvent, { type: 'token' }>) => {
    opts.mutable.designStarted = false;
    const piece = humanizeDesignUxTip(
      opts.t,
      ev.code,
      ev.params,
      ev.text
    );
    if (!piece) return;
    opts.setMessages((prev) =>
      prev.map((m) =>
        m.id === opts.assistantId
          ? {
              ...m,
              // Tip codes replace; model stream tokens still append.
              content: ev.code ? piece : (m.content || '') + piece,
              intent: undefined,
              thinking: undefined,
            }
          : m
      )
    );
  };

  const handleUiThinking = (ev: Extract<AgentStepEvent, { type: 'thinking' }>) => {
    const piece = String(ev.text);
    if (!piece) return;
    opts.setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== opts.assistantId) return m;
        return {
          ...m,
          steps: applyThinkingBodyToSteps(
            m.steps || [],
            piece,
            Boolean(ev.replace),
            opts.t
          ),
        };
      })
    );
  };

  const handleUiAnalysisDelta = (ev: Extract<AgentStepEvent, { type: 'analysis_delta' }>) => {
    const piece = String(ev.text || '');
    if (!piece.trim()) return;
    pendingAnalysisDelta += piece;
    scheduleAnalysisDeltaFlush();
  };

  const handleUiCanvas = (ev: Extract<AgentStepEvent, { type: 'canvas' }>) => {
    const next = String(ev.size).trim();
    const sendLocked = /^\d+x\d+$/.test(opts.chipNorm);
    const keepAutoChip =
      opts.chipNorm === 'auto' || /^(?:\d+xauto|autox\d+)$/.test(opts.chipNorm);
    if (!sendLocked && next && !keepAutoChip) opts.setImageAspectRatio(next);
    if (
      ev.scene === 'website' ||
      ev.scene === 'mobile' ||
      ev.scene === 'image' ||
      ev.scene === 'poster' ||
      ev.scene === 'drawing'
    ) {
      opts.setDesignScene(ev.scene);
      opts.designSceneRef.current = ev.scene;
    }
  };

  const handleUiActivity = (ev: Extract<AgentStepEvent, { type: 'activity' }>) => {
    if (ev.kind === 'tool' || ev.kind === 'added' || ev.kind === 'updated') {
      opts.mutable.designStarted = true;
    }
    if (ev.kind === 'thought') return;
    const actStatus = normalizeActivityStatus(ev.status);
    const label = formatActivityLabel(opts.t, {
      kind: ev.kind,
      status: actStatus,
      durationSec: ev.durationSec,
      count: ev.count,
      skillName: ev.skillName,
      detail: ev.detail,
      stage: ev.stage,
      code: ev.code,
    });
    if (!label) return;
    const detailText = localizeAgentProcessCopy(
      opts.t,
      (ev.detail || '').trim(),
      ev.code
    );
    const summaryText = localizeAgentProcessCopy(
      opts.t,
      String(ev.summary || '').trim(),
      ev.code
    );
    const bodyText = ev.body
      ? localizeAgentProcessCopy(opts.t, String(ev.body), ev.code)
      : '';
    // Skip nest rows that only repeat the already-localized label.
    const summary = activityRowSummary({
      kind: ev.kind,
      label,
      detailText,
      summaryText,
      bodyText,
    });
    const variant = activityRowVariant(actStatus, ev.kind);
    const rowTone = activityItemTone({
      status: actStatus,
      kind: ev.kind,
      code: ev.code,
      detail: detailText,
    });
    const nestItem = activityNestItem(opts.t, ev.item, rowTone);
    const stepItems =
      Array.isArray(ev.items) && ev.items.length
        ? String(ev.code || '').toLowerCase() === 'design_quality_check'
          ? formatGovernanceLaneItems(opts.t, ev.items)
          : ev.items.map((it) =>
              localizeExploreItem(opts.t, {
                id: String(it.id || ''),
                name: String(it.name || '').trim() || '…',
                summary: it.summary ? String(it.summary) : undefined,
                tone: activityItemTone({
                  status: actStatus,
                  kind: ev.kind,
                  code: ev.code,
                  detail: it.summary || it.name,
                  name: it.name,
                }),
              })
            )
        : undefined;
    opts.setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== opts.assistantId) return m;
        const next = applyActivityEventToSteps(m.steps || [], {
          kind: ev.kind,
          eventId: ev.id,
          status: actStatus,
          label,
          summary,
          variant,
          nestItem,
          items: stepItems,
          bodyMd: bodyText,
        });
        return next ? { ...m, steps: next } : m;
      })
    );
  };

  const handleUiPhase = (ev: Extract<AgentStepEvent, { type: 'phase' }>) => {
    const labels = ev.progress.labels || [];
    opts.setMessages((prev) =>
      prev.map((m) =>
        m.id === opts.assistantId
          ? {
              ...m,
              pipeline: {
                category: ev.progress.category,
                labels,
                currentIndex: ev.progress.currentIndex,
                stepConfirm: Boolean(ev.progress.stepConfirm),
                collabMode:
                  (ev.progress.collabMode as 'collaborative' | 'milestone' | 'auto' | undefined) ||
                  'auto',
              },
            }
          : m
      )
    );
  };

  const handleUiSvgDelta = (ev: Extract<AgentStepEvent, { type: 'svg_delta' }>) => {
    opts.mutable.designStarted = true;
    if (!ev.svg) return;
    const fid =
      opts.lastAgentFrameIdRef.current ||
      (opts.store.getState() as any).editor.document?.activeFrameId ||
      null;
    if (!fid) return;
    opts.lastAgentSvgByFrameRef.current.set(String(fid), ev.svg);
    opts.lastAgentFrameIdRef.current = String(fid);
  };

  const handleUiError = (ev: Extract<AgentStepEvent, { type: 'error' }>) => {
    const friendly = humanizeDesignError(opts.t, ev.code, ev.message);
    message.error(friendly);
    opts.setMessages((prev) =>
      prev.map((m) =>
        m.id === opts.assistantId
          ? opts.finishAssistantPatch(m, {
              content: m.content || friendly || opts.t('agent.requestFailed'),
              thinking: undefined,
              pipeline: undefined,
              drawing: undefined,
              canResume: false,
            })
          : m
      )
    );
    refreshWalletAfterSpend();
  };

  const handleUiPaused = (ev: Extract<AgentStepEvent, { type: 'paused' }>) => {
    const isErrorPause = String(ev.interruptKind || '').trim().toLowerCase() === 'error';
    const detail = String(ev.message || '').trim();
    const friendly = isErrorPause
      ? humanizeDesignError(opts.t, undefined, detail)
      : detail;
    if (isErrorPause && friendly) {
      message.error(friendly);
    }
    opts.setMessages((prev) =>
      prev.map((m) =>
        m.id === opts.assistantId
          ? opts.finishAssistantPatch(m, {
              content: isErrorPause && friendly ? friendly : (m.content || '').trim(),
              thinking: undefined,
              pipeline: undefined,
              drawing: undefined,
              designTaskId: ev.taskId || m.designTaskId,
              designResumeToken: ev.resumeToken || m.designResumeToken,
              canResume: Boolean(ev.taskId || m.designTaskId),
            })
          : m
      )
    );
  };

  const handleUiTask = (ev: Extract<AgentStepEvent, { type: 'task' }>) => {
    opts.setMessages((prev) =>
      prev.map((m) =>
        m.id === opts.assistantId
          ? { ...m, designTaskId: ev.taskId, canResume: false }
          : m
      )
    );
  };

  const handleUiDone = (ev: Extract<AgentStepEvent, { type: 'done' }>) => {
    const painted = Boolean(ev.painted);
    if (painted) {
      opts.mutable.canvasMutated = true;
      opts.mutable.nodesPainted = true;
    }
    opts.setMessages((prev) =>
      prev.map((m) => {
        if (m.id === opts.assistantId) {
          if (!opts.mutable.designStarted) {
            return {
              ...patchChatDoneAssistant(m, {
                t: opts.t,
                finish: opts.finishAssistantPatch,
                proposedOps: ev.proposedOps,
                proposalId: ev.proposalId,
                choiceUi: ev.choiceUi,
              }),
              ...(ev.taskId ? { designTaskId: ev.taskId } : {}),
              canResume: false,
              designResumeToken: undefined,
            };
          }
          return {
            ...patchDesignDoneAssistant(m, {
              t: opts.t,
              finish: opts.finishAssistantPatch,
              painted,
              designStarted: opts.mutable.designStarted,
              summary: ev.summary,
              proposedOps: ev.proposedOps,
              proposalId: ev.proposalId,
              choiceUi: ev.choiceUi,
            }),
            ...(ev.taskId ? { designTaskId: ev.taskId } : {}),
            canResume: false,
            designResumeToken: undefined,
          };
        }
        if (
          m.id === opts.userMsg.id &&
          painted &&
          opts.checkpointsRef.current.has(opts.userMsg.id)
        ) {
          return { ...m, canRestore: true };
        }
        return m;
      })
    );
    refreshWalletAfterSpend();
  };

  return (ev: AgentStepEvent) => {
    if (ev.type !== 'analysis_delta') flushAnalysisDelta();
    switch (ev.type) {
      case 'permission':
        return;
      case 'chat':
        handleUiChat();
        return;
      case 'session_control': {
        const action = String(ev.action || '').trim();
        if (action && opts.onSessionControl) opts.onSessionControl(action);
        return;
      }
      case 'token':
        handleUiToken(ev);
        return;
      case 'thinking':
        if (ev.text) handleUiThinking(ev);
        return;
      case 'analysis_delta':
        if (ev.text) handleUiAnalysisDelta(ev);
        return;
      case 'intelligence':
        opts.setMessages((prev) =>
          prev.map((m) =>
            m.id === opts.assistantId
              ? {
                  ...m,
                  intelligence: mergeDesignIntelligence(m.intelligence, ev.patch),
                }
              : m
          )
        );
        return;
      case 'developer': {
        const piece = String(ev.text || '').trim();
        const kind = String(ev.kind || 'debug').trim() || 'debug';
        opts.setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== opts.assistantId) return m;
            const nextRow = {
              id: `dbg-${Date.now()}-${(m.debugEvents || []).length}`,
              kind,
              text: piece || undefined,
              at: Date.now(),
            };
            return {
              ...m,
              debugEvents: [...(m.debugEvents || []), nextRow].slice(-40),
            };
          })
        );
        return;
      }
      case 'canvas':
        if (ev.size) handleUiCanvas(ev);
        return;
      case 'analysis':
        return;
      case 'drawing':
        opts.mutable.designStarted = true;
        opts.setMessages((prev) =>
          prev.map((m) =>
            m.id === opts.assistantId ? { ...m, drawing: Boolean(ev.active) } : m
          )
        );
        return;
      case 'activity':
        handleUiActivity(ev);
        return;
      case 'phase':
        handleUiPhase(ev);
        return;
      case 'svg_delta':
        handleUiSvgDelta(ev);
        return;
      case 'error':
        handleUiError(ev);
        return;
      case 'paused':
        handleUiPaused(ev);
        return;
      case 'task':
        handleUiTask(ev);
        return;
      case 'done':
        handleUiDone(ev);
        return;
      default:
        return;
    }
  };
}
