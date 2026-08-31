import type { Dispatch } from '@/store';
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
  dispatch: Dispatch,
  document: SceneDocument
): void {
  dispatch(setHoveredMarkPin(null));
  dispatch(consumePendingQuickEditMarkContexts());
  for (const { nodeId } of listCanvasImageNodes(document)) {
    dispatch(clearImageMarkPin(nodeId));
  }
}

export function clearImageGenMarkSession(
  dispatch: Dispatch,
  document: SceneDocument
): void {
  dispatch(setHoveredMarkPin(null));
  dispatch(consumePendingImageGenMarkContexts());
  for (const { nodeId } of listCanvasImageNodes(document)) {
    dispatch(clearImageMarkPin(nodeId));
  }
}

export function clearAgentMarkSession(dispatch: Dispatch, nodeId: string): void {
  dispatch(setHoveredMarkPin(null));
  dispatch(clearImageMarkPin(nodeId));
}

/** One-shot exit from mark / quick-edit box sessions (blank canvas or soft image click). */
export function dismissMarkToolSession(
  dispatch: Dispatch,
  document: SceneDocument | null | undefined,
  panel: ImageToolPanelState | null | undefined,
  pin: string
): boolean {
  if (!panel || panel.nodeId !== pin) return false;
  if (panel.kind === 'mark') {
    if (panel.markSink === 'quickEdit') {
      if (document) clearQuickEditMarkSession(dispatch, document);
      dispatch(openImageToolPanel({ nodeId: pin, kind: 'quickEdit' }));
      return true;
    }
    if (panel.markSink === 'imageGen') {
      if (document) clearImageGenMarkSession(dispatch, document);
      dispatch(closeImageToolPanel());
      return true;
    }
    clearAgentMarkSession(dispatch, pin);
    dispatch(closeImageToolPanel());
    dispatch(setSelectedNodeIds([]));
    return true;
  }
  if (panel.kind === 'quickEdit') {
    dispatch(closeImageToolPanel());
    return true;
  }
  return false;
}
