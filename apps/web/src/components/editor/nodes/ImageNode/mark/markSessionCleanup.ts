
import {
  clearImageMarkPin,
  closeImageToolPanel,
  consumePendingImageGenMarkContexts,
  consumePendingQuickEditMarkContexts,
  openImageToolPanel,
  setHoveredMarkPin,
  setSelectedNodeIds,
  type ImageToolPanelState,
} from '@/store/modules/editor';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import { listCanvasImageNodes } from './markGeometry';

export function clearQuickEditMarkSession(
  document: SceneDocument
): void {
  setHoveredMarkPin(null);
  consumePendingQuickEditMarkContexts();
  for (const { nodeId } of listCanvasImageNodes(document)) {
    clearImageMarkPin(nodeId);
  }
}

export function clearImageGenMarkSession(
  document: SceneDocument
): void {
  setHoveredMarkPin(null);
  consumePendingImageGenMarkContexts();
  for (const { nodeId } of listCanvasImageNodes(document)) {
    clearImageMarkPin(nodeId);
  }
}

export function clearAgentMarkSession(nodeId: string): void {
  setHoveredMarkPin(null);
  clearImageMarkPin(nodeId);
}

/** One-shot exit from mark / quick-edit box sessions (blank canvas or soft image click). */
export function dismissMarkToolSession(
  document: SceneDocument | null | undefined,
  panel: ImageToolPanelState | null | undefined,
  pin: string
): boolean {
  if (!panel || panel.nodeId !== pin) return false;
  if (panel.kind === 'mark') {
    if (panel.markSink === 'quickEdit') {
      if (document) clearQuickEditMarkSession(document);
      openImageToolPanel({ nodeId: pin, kind: 'quickEdit' });
      return true;
    }
    if (panel.markSink === 'imageGen') {
      if (document) clearImageGenMarkSession(document);
      closeImageToolPanel();
      return true;
    }
    clearAgentMarkSession(pin);
    closeImageToolPanel();
    setSelectedNodeIds([]);
    return true;
  }
  if (panel.kind === 'quickEdit') {
    closeImageToolPanel();
    return true;
  }
  return false;
}
