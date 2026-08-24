function wheelDeltaY(e: WheelEvent, el: HTMLElement): number {
  let deltaY = e.deltaY;
  if (e.deltaMode === 1) deltaY *= 16;
  else if (e.deltaMode === 2) deltaY *= el.clientHeight;
  return deltaY;
}

/** Composer keeps wheel only when it can scroll; pinch/ctrl+wheel always zooms the canvas. */
export function composerConsumesWheel(target: Element | null, e: WheelEvent): boolean {
  const composer = target?.closest?.('[data-agent-composer]') as HTMLElement | null;
  if (!composer) return false;
  if (e.ctrlKey || e.metaKey) return false;
  const canScrollY = composer.scrollHeight > composer.clientHeight + 1;
  if (!canScrollY) return false;
  const deltaY = wheelDeltaY(e, composer);
  const atTop = composer.scrollTop <= 0;
  const atBottom = composer.scrollTop + composer.clientHeight >= composer.scrollHeight - 1;
  if (deltaY < 0 && atTop) return false;
  if (deltaY > 0 && atBottom) return false;
  return true;
}

/** Scrollable panels/menus that own wheel — composer handled separately. */
export const RCB_WHEEL_SCROLL_OWNERS =
  '[data-image-tool-panel],[data-color-panel],[data-select-dropdown],[data-account-settings],[role="dialog"],[data-headlessui-portal]';

export function wheelShouldStayLocal(target: Element | null, e: WheelEvent): boolean {
  if (composerConsumesWheel(target, e)) return true;
  return Boolean(target?.closest?.(RCB_WHEEL_SCROLL_OWNERS));
}
