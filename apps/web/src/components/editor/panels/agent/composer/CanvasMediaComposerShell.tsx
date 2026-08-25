import type { ChangeEvent, CSSProperties, ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlinePlus, HiOutlineViewfinderCircle } from 'react-icons/hi2';
import { Tooltip } from '@/components/base';
import type { ComposerContext } from '@/components/editor/panels/AgentComposerInput';
import {
  ComposerAttachmentChip,
  composerAttachActionClass,
} from '@/components/editor/panels/agent/composer/AgentComposerShell';
import {
  GeneratorComposerPanel,
  type GeneratorComposerPanelSize,
} from '@/components/editor/panels/agent/composer/GeneratorComposerPanel';
import { cn } from '@/utils/classnames';

/** Attachment row — chips + attach actions (+, pick, mark, …). */
export function ComposerAttachmentRow({
  scrollable = false,
  trailing,
  children,
  className,
}: {
  scrollable?: boolean;
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
}): ReactNode {
  const stripClass = cn(
    'flex min-w-0 flex-1 flex-wrap items-center gap-1.5',
    scrollable && 'max-h-[72px] overflow-y-auto'
  );

  if (trailing) {
    return (
      <div
        className={cn(
          'flex min-h-0 shrink-0 items-start justify-between gap-2 px-3 pt-2.5',
          className
        )}
      >
        <div className={stripClass}>{children}</div>
        {trailing}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5 px-3 pt-2.5',
        scrollable && 'max-h-[72px] shrink-0 overflow-y-auto',
        className
      )}
    >
      {children}
    </div>
  );
}

export function ComposerAddAttachButton({
  disabled,
  tooltip,
  ariaLabel,
  onClick,
}: {
  disabled?: boolean;
  tooltip: string;
  ariaLabel?: string;
  onClick: () => void;
}): ReactNode {
  return (
    <Tooltip tip={tooltip} placement="top">
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel || tooltip}
        onClick={onClick}
        className={composerAttachActionClass()}
      >
        <HiOutlinePlus className="h-4 w-4" strokeWidth={2} />
      </button>
    </Tooltip>
  );
}

export function ComposerCanvasPickButton({
  pickingFromCanvas,
  disabled,
  onClick,
}: {
  pickingFromCanvas: boolean;
  disabled?: boolean;
  onClick: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <Tooltip
      tip={pickingFromCanvas ? t('agent.pickFromCanvasCancel') : t('agent.pickFromCanvas')}
      placement="top"
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={t('agent.pickFromCanvas')}
        aria-pressed={pickingFromCanvas}
        onClick={onClick}
        className={composerAttachActionClass(pickingFromCanvas)}
      >
        <HiOutlineViewfinderCircle className="h-4 w-4" strokeWidth={2} />
      </button>
    </Tooltip>
  );
}

export function ComposerAttachmentStrip({
  attachments,
  disabled,
  onRemove,
  attachTooltip,
  onAttachClick,
  attachAriaLabel,
  fileInput,
  leading,
  extraActions,
  scrollable = false,
  rowTrailing,
}: {
  attachments: ComposerContext[];
  disabled?: boolean;
  onRemove: (key: string) => void;
  attachTooltip: string;
  onAttachClick: () => void;
  attachAriaLabel?: string;
  fileInput?: {
    ref: RefObject<HTMLInputElement | null>;
    accept: string;
    multiple?: boolean;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  };
  leading?: ReactNode;
  extraActions?: ReactNode;
  scrollable?: boolean;
  rowTrailing?: ReactNode;
}): ReactNode {
  return (
    <ComposerAttachmentRow scrollable={scrollable} trailing={rowTrailing}>
      {leading}
      {attachments.map((att) => (
        <ComposerAttachmentChip
          key={att.key}
          attachment={att}
          disabled={disabled}
          onRemove={onRemove}
        />
      ))}
      <ComposerAddAttachButton
        disabled={disabled}
        tooltip={attachTooltip}
        ariaLabel={attachAriaLabel}
        onClick={onAttachClick}
      />
      {extraActions}
      {fileInput ? (
        <input
          ref={fileInput.ref}
          type="file"
          accept={fileInput.accept}
          multiple={fileInput.multiple}
          className="hidden"
          onChange={fileInput.onChange}
        />
      ) : null}
    </ComposerAttachmentRow>
  );
}

/** Click padding around AgentComposerInput — focuses the contenteditable. */
export function ComposerPromptRegion({
  children,
  onFocusInput,
  className,
}: {
  children: ReactNode;
  onFocusInput: () => void;
  className?: string;
}): ReactNode {
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- pointer padding to focus; keyboard tabs into contenteditable
    <div
      className={cn('min-h-0 min-w-0 flex-1 cursor-text overflow-hidden px-3 pt-2', className)}
      onClick={(e) => {
        if ((e.target as HTMLElement | null)?.closest?.('[data-agent-composer]')) return;
        onFocusInput();
      }}
    >
      {children}
    </div>
  );
}

/** Footer toolbar row under the prompt (settings + model + send). */
export function ComposerFooterBar({
  children,
  align = 'toolbar',
  className,
}: {
  children: ReactNode;
  align?: 'toolbar' | 'end';
  className?: string;
}): ReactNode {
  return (
    <div
      className={cn(
        align === 'end'
          ? 'flex items-center justify-end gap-1.5 px-3 pb-2.5 pt-1'
          : 'mt-1 flex items-center gap-1.5 px-2.5 pb-2',
        className
      )}
    >
      {children}
    </div>
  );
}

/** Right-aligned model + send cluster in generator footers. */
export function ComposerFooterActions({ children }: { children: ReactNode }): ReactNode {
  return <div className="ml-auto flex items-center gap-1">{children}</div>;
}

type CanvasMediaComposerShellProps = {
  panelSize?: GeneratorComposerPanelSize;
  panelOverflow?: 'hidden' | 'visible';
  panelClassName?: string;
  panelStyle?: CSSProperties;
  attachment: ReactNode;
  prompt: ReactNode;
  footer: ReactNode;
};

/** Generator / quick-edit composer layout: panel → attachments → prompt → footer. */
export function CanvasMediaComposerShell({
  panelSize = 'default',
  panelOverflow = 'hidden',
  panelClassName,
  panelStyle,
  attachment,
  prompt,
  footer,
}: CanvasMediaComposerShellProps): ReactNode {
  return (
    <GeneratorComposerPanel
      size={panelSize}
      overflow={panelOverflow}
      className={panelClassName}
      style={panelStyle}
    >
      {attachment}
      {prompt}
      {footer}
    </GeneratorComposerPanel>
  );
}
