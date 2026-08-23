import { type CSSProperties, type ReactNode, memo } from 'react';
import { HiOutlineCheck, HiOutlineXMark } from 'react-icons/hi2';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/classnames';

const PROMPT_CLASS =
  'pointer-events-auto flex min-w-[min(92vw,360px)] max-w-[min(92vw,420px)] items-center gap-2 rounded-2xl border border-[var(--line)] bg-white/95 px-3 py-2 shadow-[0_12px_40px_rgba(15,23,42,0.16)] backdrop-blur-sm';

function MarkPromptBar({
  style,
  chipLabel,
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  style: CSSProperties;
  chipLabel: string;
  value: string;
  onChange: (next: string) => void;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
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
      <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-sky-50 px-1.5 text-[12px] font-semibold text-sky-700 ring-1 ring-sky-200">
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
      {onCancel ? (
        <button
          type="button"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
          aria-label={t('editor.imageToolbar.markExit')}
          onClick={onCancel}
        >
          <HiOutlineXMark className="h-4 w-4" strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}

export default memo(MarkPromptBar);
