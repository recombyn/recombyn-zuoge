function wheelDeltaY(e: WheelEvent, el: HTMLElement): number {
  let deltaY = e.deltaY;
  if (e.deltaMode === 1) deltaY *= 16;
  else if (e.deltaMode === 2) deltaY *= el.clientHeight;
  return deltaY;
}

/** Element can scroll in the wheel’s direction (and should keep the event). */
export function elementConsumesWheel(el: HTMLElement | null, e: WheelEvent): boolean {
  if (!el) return false;
  if (e.ctrlKey || e.metaKey) return false;
  const canScrollY = el.scrollHeight > el.clientHeight + 1;
  if (!canScrollY) return false;
  const deltaY = wheelDeltaY(e, el);
  const atTop = el.scrollTop <= 0;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
  if (deltaY < 0 && atTop) return false;
  if (deltaY > 0 && atBottom) return false;
  return true;
}

/** Composer keeps wheel only when it can scroll; pinch/ctrl+wheel always zooms the canvas. */
export function composerConsumesWheel(target: Element | null, e: WheelEvent): boolean {
  const composer = target?.closest?.('[data-agent-composer]') as HTMLElement | null;
  return elementConsumesWheel(composer, e);
}

/**
 * Fixed text-frame FO / inline editor textarea — wheel must scroll ink, not pan the stage.
 * Checked from the canvas native wheel listener (runs before React portal handlers).
 */
export function textFrameConsumesWheel(target: Element | null, e: WheelEvent): boolean {
  const overlay = target?.closest?.('[data-text-frame-overlay]') as HTMLElement | null;
  if (overlay) return elementConsumesWheel(overlay, e);
  const editor = target?.closest?.('[data-text-inline-editor]');
  if (!editor) return false;
  const scroll =
    (editor.querySelector('[data-text-frame-scroll]') as HTMLElement | null) ||
    (editor.querySelector('textarea') as HTMLElement | null);
  return elementConsumesWheel(scroll, e);
}

/** Scrollable panels/menus that own wheel — composer / text-frame handled separately. */
export const RCB_WHEEL_SCROLL_OWNERS =
  '[data-image-tool-panel],[data-color-panel],[data-select-dropdown],[data-account-settings],[role="dialog"],[data-headlessui-portal]';

export function wheelShouldStayLocal(target: Element | null, e: WheelEvent): boolean {
  if (composerConsumesWheel(target, e)) return true;
  if (textFrameConsumesWheel(target, e)) return true;
  return Boolean(target?.closest?.(RCB_WHEEL_SCROLL_OWNERS));
}
