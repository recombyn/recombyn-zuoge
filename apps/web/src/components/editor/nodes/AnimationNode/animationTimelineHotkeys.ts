/**
 * Keyboard ownership helpers for the Lottie timeline dock.
 * Mirrors FillPanel gradient-stop Delete consumption so canvas hotkeys don't steal.
 */

let deleteConsumer: (() => boolean) | null = null;
let copyConsumer: (() => boolean) | null = null;
let pasteConsumer: (() => boolean) | null = null;
let spaceConsumer: (() => boolean) | null = null;

export function isLottieTimelineUiActive(target?: EventTarget | null): boolean {
  if (typeof window === 'undefined') return false;
  const dock = window.document.querySelector(
    '[data-lottie-timeline-dock]'
  ) as HTMLElement | null;
  if (!dock) return false;
  const active = window.document.activeElement;
  if (active && dock.contains(active)) return true;
  if (dock.matches(':hover')) return true;
  const el = target as HTMLElement | null;
  if (el?.closest?.('[data-lottie-timeline-dock]')) return true;
  return false;
}

export function registerLottieTimelineHotkeyConsumers(opts: {
  onDelete?: () => boolean;
  onCopy?: () => boolean;
  onPaste?: () => boolean;
  onSpace?: () => boolean;
}): () => void {
  deleteConsumer = opts.onDelete || null;
  copyConsumer = opts.onCopy || null;
  pasteConsumer = opts.onPaste || null;
  spaceConsumer = opts.onSpace || null;
  return () => {
    if (deleteConsumer === opts.onDelete) deleteConsumer = null;
    if (copyConsumer === opts.onCopy) copyConsumer = null;
    if (pasteConsumer === opts.onPaste) pasteConsumer = null;
    if (spaceConsumer === opts.onSpace) spaceConsumer = null;
  };
}

function isTypingInTimeline(): boolean {
  if (typeof window === 'undefined') return false;
  const t = window.document.activeElement as HTMLElement | null;
  if (!t) return false;
  return (
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    Boolean(t.isContentEditable)
  );
}

export function tryConsumeLottieTimelineDelete(): boolean {
  if (!isLottieTimelineUiActive()) return false;
  if (isTypingInTimeline()) return false;
  return deleteConsumer?.() ?? false;
}

export function tryConsumeLottieTimelineCopy(): boolean {
  if (!isLottieTimelineUiActive()) return false;
  if (isTypingInTimeline()) return false;
  return copyConsumer?.() ?? false;
}

export function tryConsumeLottieTimelinePaste(): boolean {
  if (!isLottieTimelineUiActive()) return false;
  if (isTypingInTimeline()) return false;
  return pasteConsumer?.() ?? false;
}

export function tryConsumeLottieTimelineSpace(): boolean {
  if (!isLottieTimelineUiActive()) return false;
  if (isTypingInTimeline()) return false;
  // Canvas Space-pan runs in capture; invoke dock play/pause here.
  return spaceConsumer?.() ?? true;
}
