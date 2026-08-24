import type { AgentComposerHandle, ComposerContext } from '@/components/editor/panels/AgentComposerInput';

/** Chip staged via Redux (mark / agent) or built for canvas attach. */
export type PendingComposerChip = {
  key: string;
  label: string;
  kind: string;
  payload: string;
  dataUrl?: string;
  thumbUrl?: string;
  /** Plain text inserted immediately after the chip (e.g. mark prompt). */
  appendText?: string;
};

/**
 * Pick plain-text caret offset for programmatic chip insert.
 * - While focused: trust live caret (snapshot *before* focus() — browsers reset to 0).
 * - After blur: trust saved caret from rememberCaret / pointerdown.
 * - Unknown: append at end — never silently jump to 0 when text exists.
 */
export function pickComposerInsertOffset(opts: {
  plainLen: number;
  wasFocused: boolean;
  /** Live caret *before* any focus() that may reset selection. */
  liveOffsetBeforeFocus: number | null;
  savedOffset: number | null;
}): number {
  const len = Math.max(0, opts.plainLen);
  if (len === 0) return 0;

  if (opts.wasFocused && opts.liveOffsetBeforeFocus != null) {
    return Math.min(Math.max(0, opts.liveOffsetBeforeFocus), len);
  }

  if (opts.savedOffset != null) {
    return Math.min(Math.max(0, opts.savedOffset), len);
  }

  return len;
}

function toComposerContext(chip: PendingComposerChip): ComposerContext {
  return {
    key: chip.key,
    label: chip.label,
    kind: chip.kind,
    payload: chip.payload,
    ...(chip.dataUrl ? { dataUrl: chip.dataUrl } : {}),
    ...(chip.thumbUrl ? { thumbUrl: chip.thumbUrl } : {}),
  };
}

/**
 * Insert one or more chips at the composer caret — same path as Add from canvas.
 * Retries briefly if the input handle is not mounted yet (mark queue / StrictMode).
 */
export function insertPendingComposerChips(
  getInput: () => AgentComposerHandle | null | undefined,
  chips: PendingComposerChip[],
  opts?: { focus?: 'caret' | 'end' | 'none' }
): void {
  if (!chips.length) return;
  const focusMode = opts?.focus ?? 'caret';

  const run = (): boolean => {
    const el = getInput();
    if (!el) return false;
    for (const item of chips) {
      el.insertContextAtCaret(toComposerContext(item));
      const tail = item.appendText?.trim();
      if (tail) el.insertPlainAtCaret(tail.startsWith(' ') ? tail : ` ${tail}`);
    }
    if (focusMode === 'end') el.focusEnd();
    else if (focusMode === 'caret') el.focus();
    return true;
  };

  queueMicrotask(() => {
    if (run()) return;
    requestAnimationFrame(() => {
      if (run()) return;
      requestAnimationFrame(() => run());
    });
  });
}
