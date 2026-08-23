import { describe, expect, it } from 'vitest';
import { resolveAskChoiceSend } from '@/components/editor/panels/agent/agentSendPath';
import type { ChatUiMessage } from '@/components/editor/panels/agent/messages/ChatTurnList';

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
