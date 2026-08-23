import { type CSSProperties, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';

const PROMPT_CLASS =
  'pointer-events-auto flex min-w-[min(92vw,360px)] max-w-[min(92vw,420px)] items-center gap-2 rounded-2xl border border-[var(--line)] bg-white/95 px-3 py-2 shadow-[0_12px_40px_rgba(15,23,42,0.16)] backdrop-blur-sm';

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
          const text = value.trim();
          if (!text) return;
          onSubmit(text);
        }}
      />
    </div>
  );
}

export default memo(MarkPromptBar);
