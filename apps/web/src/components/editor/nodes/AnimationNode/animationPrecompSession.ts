/**
 * LOT tab session: resize workbench to the nested plate and materialize
 * real scene shapes from the precomp JSON (tab-only; revert on exit).
 */
import {
  parseLottieAnimationData,
  serializeLottieAnimationData,
} from '@/components/rcb/scene/document/nodeFactories';
import { removeNodesFromDocument } from '@/components/rcb/scene/document/sceneDocument';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import { nodeLeftTop } from '@/components/rcb/scene/paint/sceneToSvg';
import { materializeRootShapeLayers } from '@/components/editor/nodes/AnimationNode/animationLottieMaterialize';
import {
  extractPrecompAssetJson,
  linkedLotNodeIdFromAsset,
  resolvePrecompAsset,
} from '@/components/editor/nodes/AnimationNode/animationPrecompEditModel';
import { resolveAnimationFrameId } from '@/components/editor/nodes/AnimationNode/resolveAnimationFrameId';
import { isAnimationFrameHostNode } from '@/components/rcb/scene/document/nodeCapabilities';

export const PRECOMP_EDIT_SESSION_ATTR = 'precompEditSession';

export type FrameGeomSnapshot = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PrecompSessionBegin = {
  document: SceneDocument;
  frameId: string;
  frameSnapshot: FrameGeomSnapshot;
  lotNodeId: string | null;
  sessionNodeIds: string[];
};

export type LottiePrecompEditState = {
  hostNodeId: string;
  assetId: string;
  selectedLayerInd: number | null;
  frameId?: string;
  frameSnapshot?: FrameGeomSnapshot;
  lotNodeId?: string | null;
  sessionNodeIds?: string[];
};

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function patchNode(
  doc: SceneDocument,
  nodeId: string,
  patch: Partial<{ x: number; y: number; width: number; height: number; attrs: Record<string, unknown> }>
): SceneDocument {
  const node = doc.deltaSetLike?.[nodeId];
  if (!node) return doc;
  return {
    ...doc,
    deltaSetLike: {
      ...(doc.deltaSetLike || {}),
      [nodeId]: {
        ...node,
        ...patch,
        attrs: patch.attrs ? { ...(node.attrs || {}), ...patch.attrs } : node.attrs,
      },
    },
  };
}

function stripSessionLinks(
  layers: unknown[],
  sessionIds: string[]
): Record<string, unknown>[] {
  return layers.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw as Record<string, unknown>;
    const layer = { ...(raw as Record<string, unknown>) };
    const ln = String(layer.ln || '').trim();
    if (ln && sessionIds.includes(ln)) delete layer.ln;
    return layer;
  });
}

export function isPrecompEditSessionNode(
  node: { attrs?: Record<string, unknown> | null } | null | undefined
): boolean {
  return Boolean(String(node?.attrs?.[PRECOMP_EDIT_SESSION_ATTR] || '').trim());
}

export function listPrecompSessionNodeIds(
  document: SceneDocument | null | undefined,
  assetId: string
): string[] {
  const aid = String(assetId || '').trim();
  if (!document?.deltaSetLike || !aid) return [];
  const out: string[] = [];
  for (const [id, node] of Object.entries(document.deltaSetLike)) {
    if (id === 'ROOT' || !node) continue;
    if (String(node.attrs?.[PRECOMP_EDIT_SESSION_ATTR] || '') === aid) out.push(id);
  }
  return out;
}

export function resolvePrecompSessionNodeIds(
  document: SceneDocument | null | undefined,
  edit: Pick<LottiePrecompEditState, 'assetId' | 'sessionNodeIds'>
): string[] {
  if (edit.sessionNodeIds?.length) return edit.sessionNodeIds;
  return listPrecompSessionNodeIds(document, edit.assetId);
}

function plateForLot(
  document: SceneDocument,
  hostNodeId: string,
  assetId: string
): { left: number; top: number; width: number; height: number; lotNodeId: string | null } | null {
  const lotId = linkedLotNodeIdFromAsset(assetId);
  if (lotId && document.deltaSetLike?.[lotId]) {
    const node = document.deltaSetLike[lotId];
    const { left, top } = nodeLeftTop(document, node);
    return {
      left,
      top,
      width: Math.max(1, Number(node.width) || 1),
      height: Math.max(1, Number(node.height) || 1),
      lotNodeId: lotId,
    };
  }
  const host = document.deltaSetLike?.[hostNodeId];
  if (!host) return null;
  const resolved = resolvePrecompAsset(host.attrs?.animationData, assetId);
  const aw = Math.max(1, resolved?.w || 100);
  const ah = Math.max(1, resolved?.h || 100);
  const { left, top } = nodeLeftTop(document, host);
  const hw = Math.max(1, Number(host.width) || aw);
  const hh = Math.max(1, Number(host.height) || ah);
  const scale = Math.min(hw / aw, hh / ah);
  const contentW = aw * scale;
  const contentH = ah * scale;
  return {
    left: left + (hw - contentW) / 2,
    top: top + (hh - contentH) / 2,
    width: contentW,
    height: contentH,
    lotNodeId: null,
  };
}

function writeAssetLayers(
  hostAnimationData: unknown,
  assetId: string,
  maturedLayers: unknown[],
  maturedW: number,
  maturedH: number
): string | null {
  const root = parseLottieAnimationData(hostAnimationData);
  if (!root || !Array.isArray(root.assets)) return null;
  const assets = (root.assets as Record<string, unknown>[]).map((a) =>
    a && typeof a === 'object' ? { ...a } : a
  );
  const idx = assets.findIndex((a) => String(a?.id || '') === assetId);
  if (idx < 0) return null;
  const prev = assets[idx] as Record<string, unknown>;
  assets[idx] = {
    ...prev,
    w: Math.max(1, Math.round(maturedW)),
    h: Math.max(1, Math.round(maturedH)),
    layers: maturedLayers,
  };
  return serializeLottieAnimationData({ ...root, assets });
}

function resolveSourceAnim(
  document: SceneDocument,
  hostAnimationData: unknown,
  assetId: string,
  lotId: string | null
): Record<string, unknown> | null {
  if (lotId) {
    const fromLot = parseLottieAnimationData(document.deltaSetLike?.[lotId]?.attrs?.animationData);
    if (fromLot) return fromLot;
  }
  const extracted = extractPrecompAssetJson(hostAnimationData, assetId);
  return extracted ? parseLottieAnimationData(extracted) : null;
}

/** Enter LOT tab: workbench = plate size; explode JSON → real linked shapes. */
export function beginPrecompEditSession(opts: {
  document: SceneDocument;
  hostNodeId: string;
  assetId: string;
}): PrecompSessionBegin | null {
  const hostId = String(opts.hostNodeId || '').trim();
  const assetId = String(opts.assetId || '').trim();
  if (!hostId || !assetId) return null;

  const host = opts.document.deltaSetLike?.[hostId];
  if (!host || host.key !== 'lottie') return null;
  const frameId = resolveAnimationFrameId(opts.document, host);
  if (!frameId) return null;

  const frames = Array.isArray(opts.document.frames) ? [...opts.document.frames] : [];
  const frameIdx = frames.findIndex((f) => String(f?.id) === frameId);
  if (frameIdx < 0) return null;

  const plate = plateForLot(opts.document, hostId, assetId);
  if (!plate) return null;

  const prevFrame = frames[frameIdx];
  const frameSnapshot: FrameGeomSnapshot = {
    x: num(prevFrame.x),
    y: num(prevFrame.y),
    width: Math.max(1, num(prevFrame.width, 1)),
    height: Math.max(1, num(prevFrame.height, 1)),
  };

  frames[frameIdx] = {
    ...prevFrame,
    x: plate.left,
    y: plate.top,
    width: plate.width,
    height: plate.height,
  };

  let doc: SceneDocument = {
    ...opts.document,
    frames,
    deltaSetLike: { ...(opts.document.deltaSetLike || {}) },
  };
  doc = patchNode(doc, hostId, {
    x: plate.left,
    y: plate.top,
    width: plate.width,
    height: plate.height,
  });

  const lotId = plate.lotNodeId;
  const sourceAnim = resolveSourceAnim(doc, host.attrs?.animationData, assetId, lotId);
  if (!sourceAnim) return null;

  const matured = materializeRootShapeLayers({
    document: doc,
    frameId,
    animationData: sourceAnim,
    plate: {
      x: plate.left,
      y: plate.top,
      width: plate.width,
      height: plate.height,
    },
  });

  // Resize always; materialize when layers are simple rect/ellipse.
  if (!matured?.nodeIds.length) {
    if (lotId) doc = patchNode(doc, lotId, { attrs: { hidden: true } });
    return {
      document: doc,
      frameId,
      frameSnapshot,
      lotNodeId: lotId,
      sessionNodeIds: [],
    };
  }

  doc = matured.document;
  for (const id of matured.nodeIds) {
    doc = patchNode(doc, id, { attrs: { [PRECOMP_EDIT_SESSION_ATTR]: assetId } });
  }

  const maturedParsed = parseLottieAnimationData(matured.animationJson);
  const maturedLayers = Array.isArray(maturedParsed?.layers)
    ? (maturedParsed!.layers as unknown[])
    : [];
  const hostJson = writeAssetLayers(
    doc.deltaSetLike?.[hostId]?.attrs?.animationData ?? host.attrs?.animationData,
    assetId,
    maturedLayers,
    Math.max(1, num(maturedParsed?.w, plate.width)),
    Math.max(1, num(maturedParsed?.h, plate.height))
  );
  if (hostJson) {
    doc = patchNode(doc, hostId, { attrs: { animationData: hostJson } });
  }
  if (lotId) {
    doc = patchNode(doc, lotId, {
      attrs: { animationData: matured.animationJson, hidden: true },
    });
  }

  return {
    document: doc,
    frameId,
    frameSnapshot,
    lotNodeId: lotId,
    sessionNodeIds: matured.nodeIds,
  };
}

/** Leave LOT tab: write-back JSON, drop session shapes, restore workbench size. */
export function endPrecompEditSession(opts: {
  document: SceneDocument;
  hostNodeId: string;
  assetId: string;
  frameId: string;
  frameSnapshot: FrameGeomSnapshot;
  lotNodeId: string | null;
  sessionNodeIds: string[];
}): SceneDocument {
  let doc = opts.document;
  const hostId = String(opts.hostNodeId || '').trim();
  const assetId = String(opts.assetId || '').trim();
  const frameId = String(opts.frameId || '').trim();
  const sessionIds = opts.sessionNodeIds.filter(Boolean);
  const lotId = opts.lotNodeId || linkedLotNodeIdFromAsset(assetId);

  const hostNode = hostId ? doc.deltaSetLike?.[hostId] : null;
  if (hostNode && assetId) {
    const childJson = extractPrecompAssetJson(hostNode.attrs?.animationData, assetId);
    if (childJson && lotId && doc.deltaSetLike?.[lotId]) {
      const parsed = parseLottieAnimationData(childJson);
      let lotJson = childJson;
      if (parsed && Array.isArray(parsed.layers)) {
        lotJson =
          serializeLottieAnimationData({
            ...parsed,
            layers: stripSessionLinks(parsed.layers as unknown[], sessionIds),
          }) || childJson;
      }
      doc = patchNode(doc, lotId, { attrs: { animationData: lotJson, hidden: false } });
    }

    const root = parseLottieAnimationData(
      doc.deltaSetLike?.[hostId]?.attrs?.animationData ?? hostNode.attrs?.animationData
    );
    if (root && Array.isArray(root.assets)) {
      const assets = (root.assets as Record<string, unknown>[]).map((asset) => {
        if (!asset || String(asset.id || '') !== assetId) return asset;
        if (!Array.isArray(asset.layers)) return asset;
        return {
          ...asset,
          layers: stripSessionLinks(asset.layers as unknown[], sessionIds),
        };
      });
      const json = serializeLottieAnimationData({ ...root, assets });
      if (json) doc = patchNode(doc, hostId, { attrs: { animationData: json } });
    }
  }

  if (sessionIds.length) doc = removeNodesFromDocument(doc, sessionIds);

  if (frameId) {
    const frames = Array.isArray(doc.frames) ? [...doc.frames] : [];
    const idx = frames.findIndex((f) => String(f?.id) === frameId);
    if (idx >= 0) {
      frames[idx] = { ...frames[idx], ...opts.frameSnapshot };
      doc = { ...doc, frames };
    }
    const host = doc.deltaSetLike?.[hostId];
    if (host && isAnimationFrameHostNode(host, doc)) {
      doc = patchNode(doc, hostId, { ...opts.frameSnapshot });
    }
  }

  return doc;
}

/** Apply end session when Redux edit state has a restorable snapshot. */
export function endPrecompEditFromState(
  document: SceneDocument,
  edit: LottiePrecompEditState
): SceneDocument | null {
  if (!edit.frameId || !edit.frameSnapshot) return null;
  return endPrecompEditSession({
    document,
    hostNodeId: edit.hostNodeId,
    assetId: edit.assetId,
    frameId: edit.frameId,
    frameSnapshot: edit.frameSnapshot,
    lotNodeId: edit.lotNodeId ?? null,
    sessionNodeIds: resolvePrecompSessionNodeIds(document, edit),
  });
}
