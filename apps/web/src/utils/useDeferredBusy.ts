import { useEffect, useRef, useState } from 'react';

/** Wait this long before showing skeleton / busy UI (skips fast responses). */
export const SKELETON_SHOW_DELAY_MS = 200;
/** Once shown, keep skeleton visible at least this long (avoids flash-out). */
export const SKELETON_MIN_VISIBLE_MS = 280;

export type DeferredBusyOptions = {
  /** @default {@link SKELETON_SHOW_DELAY_MS} */
  delayMs?: number;
  /** @default {@link SKELETON_MIN_VISIBLE_MS} */
  minVisibleMs?: number;
};

/**
 * Gate skeleton / busy chrome so fast loads do not flash.
 *
 * - `busy` shorter than `delayMs` → never shows
 * - after show, stays on for at least `minVisibleMs` after `busy` clears
 */
export function useDeferredBusy(
  busy: boolean,
  options?: DeferredBusyOptions
): boolean {
  const delayMs = options?.delayMs ?? SKELETON_SHOW_DELAY_MS;
  const minVisibleMs = options?.minVisibleMs ?? SKELETON_MIN_VISIBLE_MS;
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);
  const shownAtRef = useRef(0);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    let delayId: ReturnType<typeof setTimeout> | undefined;
    let hideId: ReturnType<typeof setTimeout> | undefined;

    if (busy) {
      if (visibleRef.current) return undefined;
      delayId = setTimeout(() => {
        shownAtRef.current = Date.now();
        visibleRef.current = true;
        setVisible(true);
      }, delayMs);
      return () => {
        if (delayId !== undefined) clearTimeout(delayId);
      };
    }

    if (!visibleRef.current) return undefined;

    const elapsed = Date.now() - shownAtRef.current;
    const remain = Math.max(0, minVisibleMs - elapsed);
    hideId = setTimeout(() => {
      visibleRef.current = false;
      shownAtRef.current = 0;
      setVisible(false);
    }, remain);
    return () => {
      if (hideId !== undefined) clearTimeout(hideId);
    };
  }, [busy, delayMs, minVisibleMs]);

  return visible;
}
