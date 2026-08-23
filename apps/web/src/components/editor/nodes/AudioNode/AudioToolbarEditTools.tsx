/**
 * Audio selection toolbar — 快速编辑 / 截取 / 变速.
 */
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineClock, HiOutlineScissors } from 'react-icons/hi2';
import { cn } from '@/utils/classnames';
import AppLogo from '@/components/base/AppLogo';
import { videoToolBtn, VideoToolSep } from '@/components/editor/nodes/VideoNode/videoToolbarShared';

const TOOL_ICON_SLOT =
  'pointer-events-none inline-flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:block [&>svg]:h-full [&>svg]:w-full';
const TOOL_ICON_STROKE = 1.75;

function ToolIconSlot({ children }: { children: ReactNode }) {
  return <span className={TOOL_ICON_SLOT}>{children}</span>;
}

function Tool({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(videoToolBtn, active && 'bg-[var(--accent-soft)]')}
      onClick={onClick}
    >
      <ToolIconSlot>{children}</ToolIconSlot>
      <span>{label}</span>
    </button>
  );
}

function AudioToolbarEditTools({
  onQuickEdit,
  onTrim,
  onSpeed,
}: {
  onQuickEdit?: () => void;
  onTrim?: () => void;
  onSpeed?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      {onQuickEdit ? (
        <>
          <Tool label={t('editor.imageToolbar.chat')} onClick={onQuickEdit}>
            <AppLogo size={16} />
          </Tool>
          <VideoToolSep />
        </>
      ) : null}
      <Tool
        label={t('editor.audioToolbar.trim', { defaultValue: '截取' })}
        onClick={onTrim}
      >
        <HiOutlineScissors strokeWidth={TOOL_ICON_STROKE} />
      </Tool>
      <Tool
        label={t('editor.audioToolbar.speed', { defaultValue: '变速' })}
        onClick={onSpeed}
      >
        <HiOutlineClock strokeWidth={TOOL_ICON_STROKE} />
      </Tool>
    </>
  );
}

export default memo(AudioToolbarEditTools);
