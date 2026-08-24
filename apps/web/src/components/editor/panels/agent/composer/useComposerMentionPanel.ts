import { useLayoutEffect, useState, type RefObject } from 'react';
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react';
import type { AgentComposerHandle } from '@/components/editor/panels/AgentComposerInput';

export function useComposerMentionPanel(inputRef: RefObject<AgentComposerHandle | null>) {
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');

  const mentionFloating = useFloating({
    open: mentionOpen,
    onOpenChange: (open) => {
      setMentionOpen(open);
      if (!open) setMentionQuery('');
    },
    placement: 'bottom-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      flip({ padding: 12, fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] }),
      shift({ padding: 12 }),
    ],
  });
  const mentionDismiss = useDismiss(mentionFloating.context);
  const mentionIx = useInteractions([mentionDismiss]);

  useLayoutEffect(() => {
    if (!mentionOpen) return;
    mentionFloating.refs.setPositionReference({
      getBoundingClientRect: () =>
        inputRef.current?.getAtMentionAnchorRect?.() ?? new DOMRect(),
    });
    mentionFloating.update();
  }, [mentionOpen, mentionQuery, inputRef, mentionFloating.refs, mentionFloating.update]);

  const closeMention = () => {
    setMentionOpen(false);
    setMentionQuery('');
  };

  const openMention = (query: string) => {
    setMentionQuery(query);
    setMentionOpen(true);
  };

  return {
    mentionOpen,
    mentionQuery,
    setMentionQuery,
    setMentionOpen,
    closeMention,
    openMention,
    mentionFloating,
    mentionIx,
  };
}
