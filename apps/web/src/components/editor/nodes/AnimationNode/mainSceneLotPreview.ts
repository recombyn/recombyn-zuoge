/**
 * 主场景 nested LOT 预览：host precomp asset 为唯一数据源，nested plate JSON 与之对齐。
 */
import { extractPrecompAssetJson } from '@/components/editor/nodes/AnimationNode/animationPrecompEditModel';
import {
  isAnimationFrameHostNode,
  isNodeHidden,
  isWorkbenchNestedLottieNode,
} from '@/components/rcb/scene/document/nodeCapabilities';
import { isHiddenByAnimationWorkbenchFocus } from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';
import {
  parseLottieAnimationData,
} from '@/components/rcb/scene/document/nodeFactories';
import type { SceneDocument } from '@/components/rcb/sceneNode';

export type MainSceneLotPreviewState = {
  lotNodeId: string;
  animationJson: string | null;
  /** False when ink should paint on 主场景. */
  structurallyHidden: boolean;
  layerCount: number;
  hasShapeInk: boolean;
};

function findFrameHostId(document: SceneDocument, frameId: string): string | null {
  const fid = String(frameId || '').trim();
  if (!fid) return null;
  for (const [id, node] of Object.entries(document.deltaSetLike || {})) {
    if (!node || id === 'ROOT') continue;
    if (!isAnimationFrameHostNode(node, document)) continue;
    if (String(node.attrs?.frameId || '').trim() === fid) return id;
  }
  return null;
}

/** Resolve nested LOT ink JSON for 主场景 — prefer host precomp asset over plate attrs. */
export function resolveMainSceneNestedLotAnimationJson(
  document: SceneDocument,
  lotNodeId: string
): string | null {
  const lotId = String(lotNodeId || '').trim();
  const lot = document.deltaSetLike?.[lotId];
  if (!lot || lot.key !== 'lottie') return null;

  const assetId = `lot_${lotId}`;
  const frameId = String(lot.attrs?.frameId || '').trim();
  if (frameId) {
    const hostId = findFrameHostId(document, frameId);
    const host = hostId ? document.deltaSetLike?.[hostId] : null;
    const fromHost = host
      ? extractPrecompAssetJson(host.attrs?.animationData, assetId)
      : null;
    if (fromHost && parseLottieAnimationData(fromHost)) return fromHost;
  }

  const fallback = String(lot.attrs?.animationData || '').trim();
  return parseLottieAnimationData(fallback) ? fallback : null;
}

/** Resolve lottie JSON for paint/overlay — nested LOT prefers host precomp (主场景 preview). */
export function resolveLottieInkJson(
  document: SceneDocument,
  nodeId: string,
  node: { key?: string; attrs?: Record<string, unknown> | null } | null | undefined,
  opts?: { hostFallback?: boolean }
): string | null {
  const useHost =
    opts?.hostFallback ?? isWorkbenchNestedLottieNode(node, document);
  // 主场景 = locked preview of the same host asset the LOT tab edits.
  if (useHost && isWorkbenchNestedLottieNode(node, document)) {
    const fromHost = resolveMainSceneNestedLotAnimationJson(document, nodeId);
    if (fromHost) return fromHost;
  }
  const plate = String(node?.attrs?.animationData || '').trim();
  if (parseLottieAnimationData(plate)) return plate;
  return useHost ? resolveMainSceneNestedLotAnimationJson(document, nodeId) : null;
}

/** True when a lottie node has JSON the SVG stack can mount. */
export function lottieNodeHasInkJson(
  document: SceneDocument,
  nodeId: string,
  node: { key?: string; attrs?: Record<string, unknown> | null } | null | undefined
): boolean {
  return resolveLottieInkJson(document, nodeId, node) != null;
}

function layerHasVisibleInk(layer: Record<string, unknown>): boolean {
  const ty = Number(layer.ty);
  if (ty === 4) {
    return Array.isArray(layer.shapes) && (layer.shapes as unknown[]).length > 0;
  }
  if (ty === 0) return Boolean(String(layer.refId || '').trim());
  return true;
}

/** Test + debug helper: full 主场景 nested LOT preview gate. */
export function getMainSceneLotPreviewState(
  document: SceneDocument,
  lotNodeId: string
): MainSceneLotPreviewState | null {
  const lotId = String(lotNodeId || '').trim();
  const lot = document.deltaSetLike?.[lotId];
  if (!lot || !isWorkbenchNestedLottieNode(lot, document)) return null;

  const animationJson = resolveMainSceneNestedLotAnimationJson(document, lotId);
  const parsed = animationJson ? parseLottieAnimationData(animationJson) : null;
  const layers = Array.isArray(parsed?.layers)
    ? (parsed!.layers as Record<string, unknown>[])
    : [];
  const structurallyHidden =
    isNodeHidden(lot) ||
    isHiddenByAnimationWorkbenchFocus(lot) ||
    lot.attrs?.hidden === true ||
    lot.attrs?.hidden === 'true';

  return {
    lotNodeId: lotId,
    animationJson,
    structurallyHidden,
    layerCount: layers.length,
    hasShapeInk: layers.some((l) => l && typeof l === 'object' && layerHasVisibleInk(l)),
  };
}

/** True when 主场景 should show nested LOT lottie ink. */
export function isMainSceneLotPreviewReady(
  document: SceneDocument,
  lotNodeId: string
): boolean {
  const state = getMainSceneLotPreviewState(document, lotNodeId);
  if (!state) return false;
  if (state.structurallyHidden) return false;
  if (!state.animationJson || !parseLottieAnimationData(state.animationJson)) return false;
  return state.layerCount > 0 && state.hasShapeInk;
}
