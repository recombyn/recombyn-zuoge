import { type CSSProperties, type ReactNode, memo } from 'react';
import { HiOutlineCheck } from 'react-icons/hi2';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/classnames';

const PROMPT_CLASS =
  'pointer-events-auto flex w-[min(72vw,240px)] items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 shadow-[0_12px_40px_rgba(15,23,42,0.16)] backdrop-blur-sm';

function MarkPromptBar({
  style,
  chipLabel,
  value,
  onChange,
  onSubmit,
}: {
  style: CSSProperties;
  chipLabel: string;
  value: string;
  onChange: (next: string) => void;
  onSubmit: (text: string) => void;
}): ReactNode {
  const { t } = useTranslation();
  const trimmed = value.trim();

  const submit = () => {
    onSubmit(trimmed);
  };

  return (
    <div
      data-mark-prompt
      data-image-tool-panel
      className={PROMPT_CLASS}
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-[var(--accent-soft)] px-2 text-[12px] font-semibold text-[var(--ink)] ring-1 ring-[var(--line)]">
        {chipLabel}
      </span>
      <input
        type="text"
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('editor.imageToolbar.markPromptPh')}
        className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
          e.preventDefault();
          submit();
        }}
      />
      <button
        type="button"
        className={cn(
          'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          'bg-[var(--ink)] text-[var(--on-brand)] transition-opacity hover:opacity-90'
        )}
        aria-label={t('editor.imageToolbar.markConfirm', '确认标记')}
        onClick={submit}
      >
        <HiOutlineCheck className="h-4 w-4" strokeWidth={2.5} />
      </button>
    </div>
  );
}

export default memo(MarkPromptBar);
