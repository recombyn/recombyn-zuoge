import { useCallback, useEffect, useState } from 'react';

export const HOME_RAIL_W_COLLAPSED = 64;
export const HOME_RAIL_W_EXPANDED = 240;
const STORAGE_KEY = 'rcb.home.railExpanded';
const EVENT = 'rcb:home-rail-expanded';

function readStored(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    // No preference yet → expanded by default.
    if (v === null) return true;
    return v === '1';
  } catch {
    return true;
  }
}

function writeStored(expanded: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, expanded ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: expanded }));
  }
}

/** Persist home sidebar expand/collapse across HomePage / Titlebar. */
export function useHomeRailExpanded(): [boolean, (next: boolean | ((v: boolean) => boolean)) => void] {
  const [expanded, setExpandedState] = useState(readStored);

  useEffect(() => {
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      if (typeof detail === 'boolean') setExpandedState(detail);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setExpandedState(e.newValue === '1');
    };
    window.addEventListener(EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setExpanded = useCallback((next: boolean | ((v: boolean) => boolean)) => {
    setExpandedState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      writeStored(value);
      return value;
    });
  }, []);

  return [expanded, setExpanded];
}

export function homeRailWidthPx(expanded: boolean): number {
  return expanded ? HOME_RAIL_W_EXPANDED : HOME_RAIL_W_COLLAPSED;
}
