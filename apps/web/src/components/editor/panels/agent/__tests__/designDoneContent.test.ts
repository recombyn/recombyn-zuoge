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
  it('prefers backend message when present', () => {
    expect(humanizeDesignError(t, 'free_daily_exhausted', '今日免费执行次数已用完')).toBe(
      '今日免费执行次数已用完'
    );
    expect(humanizeDesignError(t, 'insufficient_credits', '积分不足，请充值后重试。')).toBe(
      '积分不足，请充值后重试。'
    );
  });

  it('uses backend message over code when both are provided', () => {
    expect(
      humanizeDesignError(t, 'internal_error', 'intent_classify: prompt pack missing')
    ).toBe('intent_classify: prompt pack missing');
  });

  it('shows code when message is absent; FE i18n only when both are empty', () => {
    expect(humanizeDesignError(t, 'free_daily_exhausted')).toBe('free_daily_exhausted');
    expect(humanizeDesignError(t, 'skill_failed:boom')).toBe('skill_failed:boom');
    expect(humanizeDesignError(t, '请换一种描述再试')).toBe('请换一种描述再试');
    expect(humanizeDesignError(t, undefined)).toBe('agent.requestFailed');
    expect(humanizeDesignError(t, '')).toBe('agent.requestFailed');
  });
});
