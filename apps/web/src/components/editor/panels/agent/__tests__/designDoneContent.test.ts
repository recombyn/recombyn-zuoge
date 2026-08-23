import { describe, expect, it } from 'vitest';
import {
  hasStructuredProcess,
  humanizeDesignError,
  pickDesignDoneContent,
} from '@/components/editor/panels/agent/designAgentEventRouter';
import type { ChatUiMessage } from '@/components/editor/panels/agent/messages/ChatTurnList';

const t = (key: string) => key;

function thoughtStep(summary: string): NonNullable<ChatUiMessage['steps']>[number] {
  return {
    id: 'thought-0',
    name: 'Thinking',
    status: 'done',
    kind: 'thought',
    summary,
  };
}

describe('pickDesignDoneContent', () => {
  it('uses done.summary when painted', () => {
    expect(
      pickDesignDoneContent({
        t,
        summary: '已画到画布，可直接改。',
        streamedContent: '',
        steps: [thoughtStep('正在分析…')],
        painted: true,
        designStarted: true,
        hasProposedOps: false,
      })
    ).toBe('已画到画布，可直接改。');
  });

  it('keeps empty when painted with no summary or stream', () => {
    expect(
      pickDesignDoneContent({
        t,
        summary: '',
        streamedContent: '',
        steps: [thoughtStep('用户想要一张海报')],
        painted: true,
        designStarted: true,
        hasProposedOps: false,
      })
    ).toBe('');
  });

  it('keeps empty when painted with no process and no summary', () => {
    expect(
      pickDesignDoneContent({
        t,
        summary: '',
        streamedContent: '',
        steps: [],
        painted: true,
        designStarted: true,
        hasProposedOps: false,
      })
    ).toBe('');
  });

  it('drops mid-run stream when design ran but painted nothing', () => {
    expect(
      pickDesignDoneContent({
        t,
        summary: '',
        streamedContent: '正在生成…',
        steps: [],
        painted: false,
        designStarted: true,
        hasProposedOps: false,
      })
    ).toBe('');
  });

  it('keeps streamed chat content when design never started', () => {
    expect(
      pickDesignDoneContent({
        t,
        summary: '',
        streamedContent: '这是纯聊天回复',
        steps: [],
        painted: false,
        designStarted: false,
        hasProposedOps: false,
      })
    ).toBe('这是纯聊天回复');
  });

  it('prefers summary for ask/proposed ops', () => {
    expect(
      pickDesignDoneContent({
        t,
        summary: '请确认是否应用',
        streamedContent: 'token junk',
        steps: [],
        painted: false,
        designStarted: true,
        hasProposedOps: true,
      })
    ).toBe('请确认是否应用');
  });
});

describe('hasStructuredProcess', () => {
  it('detects thought/explored bodies', () => {
    expect(hasStructuredProcess([thoughtStep('x')])).toBe(true);
    expect(
      hasStructuredProcess([
        { id: 'tool-1', name: 'tool', status: 'done', kind: 'tool', summary: 'ok' },
      ])
    ).toBe(false);
  });
});

describe('humanizeDesignError', () => {
  it('maps known codes to i18n keys', () => {
    expect(humanizeDesignError(t, 'free_daily_exhausted')).toBe('agent.freeDailyExhausted');
    expect(humanizeDesignError(t, 'insufficient_credits')).toBe('agent.insufficientCredits');
    expect(humanizeDesignError(t, 'paint_ops_failed')).toBe('agent.designExecFailed');
    expect(humanizeDesignError(t, 'cancelled')).toBe('agent.stopped');
    expect(humanizeDesignError(t, 'timeout')).toBe('agent.requestFailed');
    expect(humanizeDesignError(t, 'scene_unconfirmed')).toBe('agent.uxTipObserveSceneTimeout');
    expect(humanizeDesignError(t, 'internal_error')).toBe('agent.designExecFailed');
  });

  it('falls back for missing or unknown codes', () => {
    expect(humanizeDesignError(t, undefined)).toBe('agent.requestFailed');
    expect(humanizeDesignError(t, '')).toBe('agent.requestFailed');
    expect(humanizeDesignError(t, 'skill_failed:boom')).toBe('agent.requestFailed');
    expect(humanizeDesignError(t, '请换一种描述再试')).toBe('agent.requestFailed');
  });
});
