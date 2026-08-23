/**
 * Resolve the foreignObject HTML mount painted into a scene node’s SVG layer.
 * Lottie / video / audio portal here so CSS z-index is not a parallel stack.
 */
import { useMemo, useSyncExternalStore } from 'react';
import {
  getShapeHostEpoch,
  subscribeShapeHosts,
} from '@/components/rcb/shapes/shapeHostRegistry';
import { findHtmlMediaMount } from '@/components/rcb/scene/paint/sceneToSvg';

export function useHtmlMediaMount(nodeId: string): HTMLElement | null {
  const epoch = useSyncExternalStore(subscribeShapeHosts, getShapeHostEpoch, () => 0);
  return useMemo(() => findHtmlMediaMount(nodeId), [nodeId, epoch]);
}
