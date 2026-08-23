import {
  isExportableSceneNode,
  isGeneratorNode,
  isNodeHidden,
  isNodeLocked,
  isVideoNode,
} from '@/components/rcb/scene/document/nodeCapabilities';
import { resolveSelectionNodeIds } from '@/components/rcb/scene/document/sceneClipboard';
import { selectionSharedGroupId } from '@/components/rcb/scene/document/sceneGroups';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import type { ContextMenuState } from '@/components/rcb/selection/chrome/CanvasContextMenu';
import {
  ctxMenuSeedFrameIds,
  ctxMenuSeedNodeIds,
  filterChatAttachNodeIds,
} from './attachPick';
import { canDeleteCtxMenuTargets } from './ctxMenuGuards';

export type CtxMenuScope = {
  document: SceneDocument | null | undefined;
  readOnly: boolean;
  ids: string[];
  selectedFrameIds: string[];
  ctxMenu: ContextMenuState | null;
  activeFrameId: string | null;
};

type CtxMenuSeeds = {
  ctxNodeId: string | null | undefined;
  ctxFrameId: string | null | undefined;
  seedNodes: string[];
  seedFrames: string[];
  targetIds: string[];
};

function resolveCtxMenuSeeds(scope: CtxMenuScope): CtxMenuSeeds {
  const ctxNodeId = scope.ctxMenu?.nodeId;
  const ctxFrameId = scope.ctxMenu?.frameId;
  const seedNodes = ctxMenuSeedNodeIds(scope.ids, ctxNodeId);
  const seedFrames = ctxMenuSeedFrameIds(scope.selectedFrameIds, ctxFrameId);
  const targetIds = resolveSelectionNodeIds(scope.document, seedNodes, seedFrames);
  return { ctxNodeId, ctxFrameId, seedNodes, seedFrames, targetIds };
}

function ctxMenuHasTarget(scope: CtxMenuScope): boolean {
  const { ids, selectedFrameIds, ctxMenu, activeFrameId } = scope;
  return Boolean(
    ids.length || ctxMenu?.nodeId || selectedFrameIds.length || ctxMenu?.frameId || activeFrameId
  );
}

function ctxMenuCanReplace(scope: CtxMenuScope, seeds: CtxMenuSeeds): boolean {
  if (scope.readOnly) return false;
  const targetId = seeds.ctxNodeId || (scope.ids.length === 1 ? scope.ids[0] : null);
  if (!targetId) return false;
  const node = scope.document?.deltaSetLike?.[targetId];
  if (!node || isGeneratorNode(node)) return false;
  if (String(node?.attrs?.processStatus || '') === 'running') return false;
  return node.key === 'image' || isVideoNode(node);
}

function ctxMenuCanAddToChat(scope: CtxMenuScope, seeds: CtxMenuSeeds): boolean {
  if (seeds.targetIds.length) {
    return filterChatAttachNodeIds(scope.document, seeds.targetIds).length > 0;
  }
  return Boolean(seeds.ctxFrameId || scope.activeFrameId);
}

function ctxMenuCanExport(scope: CtxMenuScope, seeds: CtxMenuSeeds): boolean {
  if (seeds.targetIds.length) {
    return seeds.targetIds.some((id) =>
      isExportableSceneNode(scope.document?.deltaSetLike?.[id])
    );
  }
  return Boolean(seeds.seedFrames.length || seeds.ctxFrameId || scope.activeFrameId);
}

function ctxMenuCanToggleHidden(scope: CtxMenuScope, seeds: CtxMenuSeeds): boolean {
  if (!seeds.seedNodes.length) return false;
  return seeds.seedNodes.some((id) => !isGeneratorNode(scope.document?.deltaSetLike?.[id]));
}

function ctxMenuCanToggleLocked(scope: CtxMenuScope, seeds: CtxMenuSeeds): boolean {
  if (seeds.seedNodes.length) {
    return seeds.seedNodes.some((id) => !isGeneratorNode(scope.document?.deltaSetLike?.[id]));
  }
  return Boolean(seeds.ctxFrameId || scope.selectedFrameIds.length || scope.activeFrameId);
}

function ctxMenuCanGroup(scope: CtxMenuScope, seeds: CtxMenuSeeds): boolean {
  if (seeds.targetIds.length < 2) return false;
  return !selectionSharedGroupId(scope.document, seeds.targetIds);
}

function ctxMenuCanUngroup(scope: CtxMenuScope, seeds: CtxMenuSeeds): boolean {
  if (seeds.targetIds.length < 2) return false;
  return Boolean(selectionSharedGroupId(scope.document, seeds.targetIds));
}

function ctxMenuTargetHidden(scope: CtxMenuScope, seeds: CtxMenuSeeds): boolean {
  if (!seeds.seedNodes.length) return false;
  return seeds.seedNodes.every((id) => isNodeHidden(scope.document?.deltaSetLike?.[id]));
}

function ctxMenuTargetLocked(scope: CtxMenuScope, seeds: CtxMenuSeeds): boolean {
  if (seeds.seedNodes.length) {
    return seeds.seedNodes.every((id) => isNodeLocked(scope.document?.deltaSetLike?.[id]));
  }
  const frameId = seeds.ctxFrameId || scope.activeFrameId;
  if (!frameId) return false;
  const frames = Array.isArray(scope.document?.frames) ? scope.document.frames : [];
  const frame = frames.find((item) => item?.id === frameId);
  return Boolean(frame?.locked);
}

function ctxMenuExportKind(scope: CtxMenuScope, seeds: CtxMenuSeeds): 'image' | 'video' {
  if (!seeds.targetIds.length) return 'image';
  const allVideo = seeds.targetIds.every((id) => {
    const node = scope.document?.deltaSetLike?.[id];
    return isVideoNode(node) && Boolean(String(node?.attrs?.src || '').trim());
  });
  return allVideo ? 'video' : 'image';
}

export type CanvasContextMenuCapabilities = {
  hasNode: boolean;
  canReplace: boolean;
  canAddToChat: boolean;
  canDelete: boolean;
  canLayerActions: boolean;
  canExport: boolean;
  canToggleHidden: boolean;
  canToggleLocked: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  targetHidden: boolean;
  targetLocked: boolean;
  exportKind: 'image' | 'video';
};

export function buildCanvasContextMenuProps(scope: CtxMenuScope): CanvasContextMenuCapabilities {
  const seeds = resolveCtxMenuSeeds(scope);
  const guardOpts = {
    document: scope.document,
    ids: scope.ids,
    selectedFrameIds: scope.selectedFrameIds,
    ctxNodeId: seeds.ctxNodeId,
    ctxFrameId: seeds.ctxFrameId,
    activeFrameId: scope.activeFrameId,
  };

  return {
    hasNode: ctxMenuHasTarget(scope),
    canReplace: ctxMenuCanReplace(scope, seeds),
    canAddToChat: ctxMenuCanAddToChat(scope, seeds),
    canDelete: canDeleteCtxMenuTargets(guardOpts),
    canLayerActions: ctxMenuHasTarget(scope),
    canExport: ctxMenuCanExport(scope, seeds),
    canToggleHidden: ctxMenuCanToggleHidden(scope, seeds),
    canToggleLocked: ctxMenuCanToggleLocked(scope, seeds),
    canGroup: ctxMenuCanGroup(scope, seeds),
    canUngroup: ctxMenuCanUngroup(scope, seeds),
    targetHidden: ctxMenuTargetHidden(scope, seeds),
    targetLocked: ctxMenuTargetLocked(scope, seeds),
    exportKind: ctxMenuExportKind(scope, seeds),
  };
}
