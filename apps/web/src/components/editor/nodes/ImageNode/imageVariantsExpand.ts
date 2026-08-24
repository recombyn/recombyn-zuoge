import { useSyncExternalStore } from 'react';

/** Which image node has its multi-gen stack expanded (shared across hover + selected overlays). */
let expandedNodeId: string | null = null;
const listeners = new Set<() => void>();

export function getImageVariantsExpandedNodeId(): string | null {
  return expandedNodeId;
}

export function setImageVariantsExpanded(nodeId: string | null): void {
  const next = nodeId ? String(nodeId) : null;
  if (expandedNodeId === next) return;
  expandedNodeId = next;
  listeners.forEach((fn) => fn());
}

export function useImageVariantsExpandedNodeId(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getImageVariantsExpandedNodeId,
    getImageVariantsExpandedNodeId
  );
}
