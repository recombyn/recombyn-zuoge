import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react';
import {
  parseAtMentionQuery,
  parseSlashSkillQuery,
  stripTrailingSlashQuery,
  type AgentComposerHandle,
  type ComposerContext,
} from '@/components/editor/panels/AgentComposerInput';
import type { MentionAttachItem } from '@/components/editor/panels/agent/composer/MentionAttachPanel';
import { apiQuery } from '@/service/client';
import type { DesignSkillCard } from '@/service/design';

function slashTriggerIndex(value: string): number {
  for (let i = value.length - 1; i >= 0; i -= 1) {
    if (value[i] !== '/') continue;
    if (/\s/.test(value.slice(i + 1))) return -1;
    if (i > 0 && !/\s/.test(value[i - 1]!)) continue;
    return i;
  }
  return -1;
}

type SlashSkillsOpts = {
  inputRef: RefObject<AgentComposerHandle | null>;
  setPrompt: (next: string | ((prev: string) => string)) => void;
  /** Close sibling @-mention panel when `/` wins. */
  onCloseAtMention?: () => void;
  /** Open sibling @-mention when `@` wins. */
  onOpenAtMention?: (query: string) => void;
  enabled?: boolean;
};

/**
 * `/` skill picker for generator composers (same catalog as Agent dock).
 * Prefer the later of `@` vs `/` when both are open.
 */
export function useComposerSlashSkills(opts: SlashSkillsOpts) {
  const { t } = useTranslation();
  const enabled = opts.enabled !== false;
  const [skillOpen, setSkillOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const [skillsWanted, setSkillsWanted] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const skillsQuery = useQuery({
    ...apiQuery.designDesignSkillsPicker.queryOptions({
      input: { query: {} },
    }),
    staleTime: 60_000,
    enabled: enabled && skillsWanted,
  });

  const skillCatalog = useMemo((): DesignSkillCard[] => {
    if (!skillsWanted || skillsQuery.isError) return [];
    return ((skillsQuery.data as { items?: DesignSkillCard[] } | undefined)?.items || []).filter(
      (s) => String(s.skillKey || '').trim()
    );
  }, [skillsWanted, skillsQuery.data, skillsQuery.isError]);

  const skillItems = useMemo((): MentionAttachItem[] => {
    const mineLabel = t('agent.skillsMine');
    const officialLabel = t('agent.skillsOfficial');
    return skillCatalog.map((s) => ({
      id: String(s.skillKey || ''),
      label: s.name,
      hint: s.whenToUse || undefined,
      group: s.mine ? mineLabel : officialLabel,
      ...(s.logo ? { thumbUrl: s.logo } : {}),
    }));
  }, [skillCatalog, t]);

  const loadSkillCatalog = useCallback(() => {
    setSkillsWanted(true);
  }, []);

  const closeSkillPanel = useCallback(() => {
    setSkillOpen(false);
    setSkillQuery('');
  }, []);

  const maybeOpenComposerMentions = useCallback(
    (value: string) => {
      const o = optsRef.current;
      if (!enabled) {
        closeSkillPanel();
        return;
      }
      const at = parseAtMentionQuery(value);
      const slash = parseSlashSkillQuery(value);
      const atIdx = at.open ? value.lastIndexOf('@') : -1;
      const slashIdx = slash.open ? slashTriggerIndex(value) : -1;
      const preferSkill = slash.open && (!at.open || slashIdx > atIdx);

      if (preferSkill) {
        o.onCloseAtMention?.();
        setSkillQuery(slash.query);
        setSkillOpen(true);
        loadSkillCatalog();
        return;
      }
      if (at.open) {
        closeSkillPanel();
        o.onOpenAtMention?.(at.query);
        return;
      }
      closeSkillPanel();
      o.onCloseAtMention?.();
    },
    [closeSkillPanel, enabled, loadSkillCatalog]
  );

  const pickSkill = useCallback(
    (pickId: string) => {
      const skill = skillCatalog.find((s) => String(s.skillKey) === pickId);
      if (!skill) return;
      const key = String(skill.skillKey);
      const ctx: ComposerContext = {
        key: `skill:${key}`,
        label: skill.name,
        kind: 'skill',
        payload: key,
        ...(skill.logo ? { thumbUrl: skill.logo } : {}),
      };
      const o = optsRef.current;
      o.setPrompt(stripTrailingSlashQuery);
      closeSkillPanel();
      queueMicrotask(() => {
        o.inputRef.current?.insertContextAtCaret(ctx);
        o.inputRef.current?.focus();
      });
    },
    [closeSkillPanel, skillCatalog]
  );

  const skillFloating = useFloating({
    open: skillOpen,
    onOpenChange: (open) => {
      setSkillOpen(open);
      if (!open) setSkillQuery('');
      else loadSkillCatalog();
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
  const skillDismiss = useDismiss(skillFloating.context);
  const skillIx = useInteractions([skillDismiss]);
  const setPositionReference = useRef(skillFloating.refs.setPositionReference);
  setPositionReference.current = skillFloating.refs.setPositionReference;

  useLayoutEffect(() => {
    if (!skillOpen) return;
    const inputRef = optsRef.current.inputRef;
    const sync = () => {
      const rect =
        inputRef.current?.getSlashMentionAnchorRect?.() ??
        inputRef.current?.getAtMentionAnchorRect?.() ??
        null;
      if (rect) setPositionReference.current(rect);
    };
    sync();
    const id = window.setInterval(sync, 120);
    return () => window.clearInterval(id);
  }, [skillOpen, skillQuery]);

  return {
    skillOpen,
    skillQuery,
    skillItems,
    skillFloating,
    skillIx,
    maybeOpenComposerMentions,
    pickSkill,
    closeSkillPanel,
  };
}
