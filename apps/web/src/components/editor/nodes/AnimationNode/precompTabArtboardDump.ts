/**
 * DEV diagnostic: dump artboard / nested LOT / precomp session when switching
 * 主场景 ↔ LOT tabs. Helps separate “data missing” vs “paint hidden”.
 */
import { extractPrecompAssetJson } from '@/components/editor/nodes/AnimationNode/animationPrecompEditModel';
import { isMainSceneLotPreviewReady } from '@/components/editor/nodes/AnimationNode/mainSceneLotPreview';
import { getLottiePrecompEditFocus } from '@/components/editor/nodes/AnimationNode/animationPrecompEditFocus';
import { isHiddenByAnimationWorkbenchFocus } from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';
import { parseLottieAnimationData } from '@/components/rcb/scene/document/nodeFactories';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import store from '@/store';

function layerStats(anim: Record<string, unknown> | null | undefined) {
  const layers = Array.isArray(anim?.layers) ? (anim!.layers as unknown[]) : [];
  let shape = 0;
  let precomp = 0;
  let other = 0;
  for (const raw of layers) {
    if (!raw || typeof raw !== 'object') continue;
    const ty = Number((raw as { ty?: unknown }).ty);
    if (ty === 4) shape += 1;
    else if (ty === 0) precomp += 1;
    else other += 1;
  }
  return { total: layers.length, shape, precomp, other };
}

function nodeBrief(id: string, node: any) {
  const attrs = node?.attrs || {};
  return {
    id,
    key: node?.key,
    name: attrs.name || attrs.label || undefined,
    x: node?.x,
    y: node?.y,
    w: node?.width,
    h: node?.height,
    frameId: attrs.frameId || undefined,
    hidden: Boolean(attrs.hidden),
    workbenchHidden: isHiddenByAnimationWorkbenchFocus(id, node),
    animationFrameHost: Boolean(attrs.animationFrameHost),
    precompEditSession: attrs.precompEditSession || undefined,
    hasAnimJson: Boolean(String(attrs.animationData || '').trim()),
    animJsonLen: String(attrs.animationData || '').length || undefined,
    shapeType: attrs.shapeType || undefined,
    fill: attrs['fill-color'] || attrs.fill || undefined,
  };
}

export type PrecompTabDumpReason =
  | 'tab→precomp'
  | 'tab→main'
  | 'enter-session'
  | 'exit-session'
  | string;

/**
 * Snapshot current editor document for the active animation workbench frame.
 * Always safe to call; no-ops outside DEV.
 */
export function logPrecompTabArtboardDump(
  reason: PrecompTabDumpReason,
  opts?: {
    hostNodeId?: string | null;
    assetId?: string | null;
    frameId?: string | null;
    lotNodeId?: string | null;
  }
) {
  if (!import.meta.env.DEV) return;
  try {
    const editor = (store.getState() as { editor?: any }).editor;
    const doc = editor?.document as SceneDocument | null | undefined;
    if (!doc) {
      // eslint-disable-next-line no-console
      console.info('[precomp-tab]', reason, { document: null });
      return;
    }

    const pre = editor?.lottiePrecompEdit as null | {
      hostNodeId?: string;
      assetId?: string;
      frameId?: string;
      lotNodeId?: string | null;
      sessionNodeIds?: string[];
      sessionHidesLotInk?: boolean;
    };

    const hostNodeId = String(opts?.hostNodeId || pre?.hostNodeId || '').trim();
    const assetId = String(opts?.assetId || pre?.assetId || '').trim();
    let frameId = String(opts?.frameId || pre?.frameId || doc.activeFrameId || '').trim();
    let lotNodeId = String(opts?.lotNodeId || pre?.lotNodeId || '').trim();
    if (!lotNodeId && assetId.startsWith('lot_')) lotNodeId = assetId.slice(4);

    const host = hostNodeId ? doc.deltaSetLike?.[hostNodeId] : null;
    if (!frameId && host) frameId = String(host.attrs?.frameId || '').trim();

    const frame = (doc.frames || []).find((f) => String(f?.id) === frameId) || null;
    const bound: ReturnType<typeof nodeBrief>[] = [];
    for (const [id, node] of Object.entries(doc.deltaSetLike || {})) {
      if (!node || id === 'ROOT') continue;
      if (frameId && String(node.attrs?.frameId || '').trim() !== frameId) continue;
      bound.push(nodeBrief(id, node));
    }
    bound.sort((a, b) => String(a.id).localeCompare(String(b.id)));

    const lot = lotNodeId ? doc.deltaSetLike?.[lotNodeId] : null;
    const lotAnim = lot ? parseLottieAnimationData(lot.attrs?.animationData) : null;
    const hostAsset = host && assetId ? extractPrecompAssetJson(host.attrs?.animationData, assetId) : null;
    const hostAssetAnim = hostAsset ? parseLottieAnimationData(hostAsset) : null;
    const focus = getLottiePrecompEditFocus();

    const dump = {
      reason,
      tab: pre ? 'LOT/precomp' : '主场景/main',
      frameId: frameId || null,
      frame: frame
        ? {
            name: (frame as { name?: string }).name,
            x: frame.x,
            y: frame.y,
            w: frame.width,
            h: frame.height,
          }
        : null,
      host: hostNodeId ? nodeBrief(hostNodeId, host) : null,
      lot: lotNodeId
        ? {
            ...nodeBrief(lotNodeId, lot),
            layers: layerStats(lotAnim),
            previewReady: isMainSceneLotPreviewReady(doc, lotNodeId),
          }
        : null,
      hostAssetLayers: layerStats(hostAssetAnim),
      precompEdit: pre
        ? {
            hostNodeId: pre.hostNodeId,
            assetId: pre.assetId,
            lotNodeId: pre.lotNodeId,
            sessionHidesLotInk: pre.sessionHidesLotInk,
            sessionCount: (pre.sessionNodeIds || []).length,
            sessionNodeIds: pre.sessionNodeIds || [],
          }
        : null,
      focus,
      boundToFrame: bound,
      boundCount: bound.length,
      selectedFrameIds: editor?.selectedFrameIds || [],
      selectedNodeIds: editor?.selectedNodeIds || [],
    };

    // eslint-disable-next-line no-console
    console.info('[precomp-tab] artboard dump', dump);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[precomp-tab] dump failed', reason, err);
  }
}

/** After Redux mutators flush — dump once on next microtask. */
export function schedulePrecompTabArtboardDump(
  reason: PrecompTabDumpReason,
  opts?: Parameters<typeof logPrecompTabArtboardDump>[1]
) {
  if (!import.meta.env.DEV) return;
  queueMicrotask(() => logPrecompTabArtboardDump(reason, opts));
}
