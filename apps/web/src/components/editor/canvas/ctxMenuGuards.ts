import { selectionHasProcessing } from '@/components/rcb/scene/document/nodeCapabilities';
import {
  nodeIdsBoundToFrames,
  resolveSelectionNodeIds,
} from '@/components/rcb/scene/document/sceneClipboard';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import { ctxMenuSeedFrameIds, ctxMenuSeedNodeIds } from './attachPick';

/** Resolve node + frame targets for a context-menu action (selection or menu hit). */
export function resolveCtxMenuTargets(opts: {
  document: SceneDocument | null | undefined;
  ids: string[];
  selectedFrameIds: string[];
  ctxNodeId?: string | null;
  ctxFrameId?: string | null;
  activeFrameId?: string | null;
}): { nodeIds: string[]; frameIds: string[] } {
  const seedNodes = ctxMenuSeedNodeIds(opts.ids, opts.ctxNodeId);
  const seedFrames = ctxMenuSeedFrameIds(opts.selectedFrameIds, opts.ctxFrameId);
  let nodeIds = resolveSelectionNodeIds(opts.document, seedNodes, seedFrames);
  let frameIds = [...seedFrames];
  if (!nodeIds.length && !frameIds.length) {
    if (opts.ctxFrameId) frameIds = [String(opts.ctxFrameId)];
    else if (opts.activeFrameId) frameIds = [String(opts.activeFrameId)];
    else if (opts.ctxNodeId) nodeIds = [String(opts.ctxNodeId)];
  }
  return { nodeIds, frameIds };
}

/** True when any resolved target is still uploading / processing. */
export function ctxMenuTargetHasProcessing(opts: {
  document: SceneDocument | null | undefined;
  ids: string[];
  selectedFrameIds: string[];
  ctxNodeId?: string | null;
  ctxFrameId?: string | null;
  activeFrameId?: string | null;
}): boolean {
  const { nodeIds, frameIds } = resolveCtxMenuTargets(opts);
  return selectionMutationBlocked(opts.document, nodeIds, frameIds);
}

/** Block cut / copy / duplicate / reorder / hide / lock while process shimmer is active. */
export function selectionMutationBlocked(
  document: SceneDocument | null | undefined,
  nodeIds: string[],
  frameIds: string[]
): boolean {
  if (!nodeIds.length && !frameIds.length) return false;
  const bound = frameIds.length ? nodeIdsBoundToFrames(document, frameIds) : [];
  const allNodes = [...new Set([...nodeIds, ...bound])];
  return selectionHasProcessing(document, allNodes, frameIds, {
    expandFrameChildren: false,
  });
}

/** Delete is always allowed — including in-flight SoftGlow nodes. */
export function canDeleteCtxMenuTargets(opts: {
  document: SceneDocument | null | undefined;
  ids: string[];
  selectedFrameIds: string[];
  ctxNodeId?: string | null;
  ctxFrameId?: string | null;
  activeFrameId?: string | null;
}): boolean {
  const { nodeIds, frameIds } = resolveCtxMenuTargets(opts);
  return nodeIds.length > 0 || frameIds.length > 0;
}
