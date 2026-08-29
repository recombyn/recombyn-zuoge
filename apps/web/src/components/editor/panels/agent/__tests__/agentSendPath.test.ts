import { describe, expect, it } from 'vitest';
import {
  formatChatMediaError,
  resolveAskChoiceSend,
  resolveDesignFocusFrameId,
} from '@/components/editor/panels/agent/agentSendPath';
import type { ChatUiMessage } from '@/components/editor/panels/agent/messages/ChatTurnList';

const t = (key: string) => key;

describe('formatChatMediaError', () => {
  it('passes through free_daily_exhausted message text', () => {
    expect(formatChatMediaError(t, new Error('free_daily_exhausted'))).toBe(
      'free_daily_exhausted'
    );
  });

  it('passes through insufficient credits message text', () => {
    expect(formatChatMediaError(t, new Error('Insufficient credits'))).toBe(
      'Insufficient credits'
    );
  });

  it('surfaces provider error text', () => {
    const err = new Error('Image generation failed: model not found');
    expect(formatChatMediaError(t, err)).toBe('Image generation failed: model not found');
  });
});

describe('resolveDesignFocusFrameId', () => {
  it('prefers open animation workbench over chip frame', () => {
    expect(
      resolveDesignFocusFrameId({
        freeCanvasMention: false,
        editTargetId: null,
        chipFrameId: 'chip-frame',
        animationWorkbenchFrameId: 'workbench-frame',
      })
    ).toBe('workbench-frame');
  });

  it('falls back to chip when timeline closed', () => {
    expect(
      resolveDesignFocusFrameId({
        freeCanvasMention: false,
        editTargetId: null,
        chipFrameId: 'chip-frame',
        animationWorkbenchFrameId: null,
      })
    ).toBe('chip-frame');
  });

  it('clears focus on free-canvas mention', () => {
    expect(
      resolveDesignFocusFrameId({
        freeCanvasMention: true,
        editTargetId: null,
        chipFrameId: 'chip-frame',
        animationWorkbenchFrameId: 'workbench-frame',
      })
    ).toBeNull();
  });
});

describe('resolveAskChoiceSend', () => {
  it('binds a structured target choice without exposing its id as message text', () => {
    const messages: ChatUiMessage[] = [
      {
        id: 'ask-1',
        role: 'assistant',
        content: 'Which title?',
        choiceUi: {
          mode: 'single',
          options: [{ label: 'Top title', action: 'reply', value: 'node-title-top' }],
        },
      },
    ];

    expect(
      resolveAskChoiceSend(messages, {
        label: 'Top title',
        action: 'reply',
        value: 'node-title-top',
      })
    ).toEqual({
      kind: 'reply',
      text: 'Top title\n\n[Target element — selected from clarification]\nid: node-title-top',
      displayText: 'Top title',
    });
  });
});
