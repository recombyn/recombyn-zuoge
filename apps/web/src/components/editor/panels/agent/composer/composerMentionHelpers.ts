import type { RefObject } from 'react';
import {
  buildAttachRefMentionContext,
  stripTrailingAtQuery,
  type AgentComposerHandle,
  type ComposerContext,
} from '@/components/editor/panels/AgentComposerInput';

export function insertMentionFromAttachment(opts: {
  att: ComposerContext;
  n: number;
  label: string;
  payload: string;
  prompt: string;
  setPrompt: (next: string) => void;
  closeMention: () => void;
  inputRef: RefObject<AgentComposerHandle | null>;
}) {
  const { att, n, label, payload, prompt, setPrompt, closeMention, inputRef } = opts;
  const ctx = buildAttachRefMentionContext(att, label, payload || `[User attachment ${n}]`);
  setPrompt(stripTrailingAtQuery(prompt));
  closeMention();
  queueMicrotask(() => {
    inputRef.current?.insertContextAtCaret(ctx);
    inputRef.current?.focus();
  });
}

/** Unified quick-edit / generator composer root marker. */
export const MEDIA_QUICK_EDIT_ATTR = 'data-media-quick-edit';
