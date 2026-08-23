import { FloatingPortal } from '@floating-ui/react';
import type { CSSProperties } from 'react';
import type { UserAsset } from '@/models/assets';
import MentionAttachPanel, {
  type MentionAttachItem,
} from '@/components/editor/panels/agent/composer/MentionAttachPanel';

type FloatingPanelBinding = {
  refs: {
    setFloating: (node: HTMLElement | null) => void;
  };
  floatingStyles: CSSProperties;
};

type InteractionBinding = {
  getFloatingProps: () => Record<string, unknown>;
};

type AgentDockFloatingPanelsProps = {
  historyOpen: boolean;
  mentionPanelOpen: boolean;
  skillPanelOpen: boolean;
  mentionFloating: FloatingPanelBinding;
  mentionIx: InteractionBinding;
  mentionItems: MentionAttachItem[];
  mentionQuery: string;
  onPickMention: (pickId: string) => void;
  onPickMentionLibraryAsset: (asset: UserAsset) => void;
  skillFloating: FloatingPanelBinding;
  skillIx: InteractionBinding;
  skillMentionItems: MentionAttachItem[];
  skillQuery: string;
  onPickSkillMention: (pickId: string) => void;
};

export default function AgentDockFloatingPanels({
  historyOpen,
  mentionPanelOpen,
  skillPanelOpen,
  mentionFloating,
  mentionIx,
  mentionItems,
  mentionQuery,
  onPickMention,
  onPickMentionLibraryAsset,
  skillFloating,
  skillIx,
  skillMentionItems,
  skillQuery,
  onPickSkillMention,
}: AgentDockFloatingPanelsProps) {
  return (
    <>
      {!historyOpen && mentionPanelOpen ? (
        <FloatingPortal>
          <div
            ref={mentionFloating.refs.setFloating}
            style={mentionFloating.floatingStyles as CSSProperties}
            className="z-[80]"
            {...mentionIx.getFloatingProps()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <MentionAttachPanel
              items={mentionItems}
              query={mentionQuery}
              onPick={onPickMention}
              onPickLibraryAsset={onPickMentionLibraryAsset}
            />
          </div>
        </FloatingPortal>
      ) : null}

      {!historyOpen && skillPanelOpen ? (
        <FloatingPortal>
          <div
            ref={skillFloating.refs.setFloating}
            style={skillFloating.floatingStyles as CSSProperties}
            className="z-[80]"
            {...skillIx.getFloatingProps()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <MentionAttachPanel
              variant="skill"
              items={skillMentionItems}
              query={skillQuery}
              onPick={onPickSkillMention}
            />
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}
