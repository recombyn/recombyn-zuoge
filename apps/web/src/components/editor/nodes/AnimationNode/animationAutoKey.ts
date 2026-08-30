/**
 * Auto-key animated transform channels when the canvas pose / attrs change.
 * Frame sync preserves animated Lottie props, so attrs-only edits would
 * otherwise leave the curve flat while the canvas looks transformed.
 */
import {
  isTransformPropAnimated,
  liveSceneValueForTransformProp,
  upsertTransformKeyframe,
  type LiveTransformValueContext,
} from '@/components/editor/nodes/AnimationNode/animationTimelineMutate';
import { secToFrame } from '@/components/editor/nodes/AnimationNode/animationTimelineModel';
import {
  findFrameAnimationMediaId,
  resolveAnimationFrameId,
} from '@/components/editor/nodes/AnimationNode/resolveAnimationFrameId';
import {
  parseLottieAnimationData,
  serializeLottieAnimationData,
} from '@/components/rcb/scene/document/nodeFactories';

export type AnimationLayerLink = {
  hostId: string;
  layerInd: number;
  animationData: Record<string, unknown>;
  frameId: string;
  plate: { left: number; top: number; width: number; height: number };
  animW: number;
  animH: number;
  layerBaseW: number;
  layerBaseH: number;
  sceneKind: 'main' | 'precomp';
  assetId?: string;
};

function asObj(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Resolve host + layer + plate for a scene child on a 动画工作台. */
export function resolveAnimationLayerLink(
  document: any,
  nodeId: string
): AnimationLayerLink | null {
  const node = document?.deltaSetLike?.[nodeId];
  if (!node) return null;
  const frameId = resolveAnimationFrameId(document, node);
  if (!frameId) return null;
  const hostId = findFrameAnimationMediaId(document, frameId);
  if (!hostId) return null;
  const layerInd = Number(node.attrs?.lottieLayerInd);
  const animationData = parseLottieAnimationData(
    document.deltaSetLike?.[hostId]?.attrs?.animationData
  );
  if (!animationData || !Number.isFinite(layerInd) || layerInd <= 0) return null;

  const frames = Array.isArray(document.frames) ? document.frames : [];
  const frame = frames.find((f: any) => String(f?.id) === frameId);
  const host = document.deltaSetLike?.[hostId];
  const plate = {
    left: num(frame?.x ?? host?.x),
    top: num(frame?.y ?? host?.y),
    width: Math.max(1, num(frame?.width ?? host?.width, 1)),
    height: Math.max(1, num(frame?.height ?? host?.height, 1)),
  };

  const sessionAsset = String(node.attrs?.precompEditSession || '').trim();
  if (sessionAsset) {
    const assets = Array.isArray(animationData.assets) ? animationData.assets : [];
    const asset = assets.find(
      (raw: unknown) => String(asObj(raw)?.id || '') === sessionAsset
    ) as Record<string, unknown> | undefined;
    if (!asset || !Array.isArray(asset.layers)) return null;
    const layer = asset.layers.find((raw: unknown) => {
      const row = asObj(raw);
      if (!row) return false;
      if (String(row.ln || '').trim() === nodeId) return true;
      return num(row.ind) === layerInd;
    }) as Record<string, unknown> | undefined;
    if (!layer) return null;
    const animW = Math.max(1, num(asset.w, plate.width));
    const animH = Math.max(1, num(asset.h, plate.height));
    return {
      hostId,
      layerInd: num(layer.ind, layerInd),
      animationData,
      frameId,
      plate,
      animW,
      animH,
      layerBaseW: Math.max(1, num(layer.w, num(node.width, 1))),
      layerBaseH: Math.max(1, num(layer.h, num(node.height, 1))),
      sceneKind: 'precomp',
      assetId: sessionAsset,
    };
  }

  const animW = Math.max(1, num(animationData.w, plate.width));
  const animH = Math.max(1, num(animationData.h, plate.height));

  const layers = Array.isArray(animationData.layers) ? animationData.layers : [];
  const layer = layers.find((raw: unknown) => num(asObj(raw)?.ind) === layerInd) as
    | Record<string, unknown>
    | undefined;
  const layerBaseW = Math.max(1, num(layer?.w, num(node.width, 1)));
  const layerBaseH = Math.max(1, num(layer?.h, num(node.height, 1)));

  return {
    hostId,
    layerInd,
    animationData,
    frameId,
    plate,
    animW,
    animH,
    layerBaseW,
    layerBaseH,
    sceneKind: 'main',
  };
}

export function liveValueContextFromLink(
  link: AnimationLayerLink
): LiveTransformValueContext {
  return {
    plate: link.plate,
    animW: link.animW,
    animH: link.animH,
    layerBaseW: link.layerBaseW,
    layerBaseH: link.layerBaseH,
  };
}

/** Ensure shape/image layers keep a stable base size when scale becomes keyed. */
function withLayerBaseSize(
  animationData: Record<string, unknown>,
  layerInd: number,
  baseW: number,
  baseH: number,
  sceneKind: 'main' | 'precomp' = 'main',
  assetId?: string
): Record<string, unknown> {
  const root = structuredClone
    ? structuredClone(animationData)
    : (JSON.parse(JSON.stringify(animationData)) as Record<string, unknown>);
  let layers: unknown[] | null = null;
  if (sceneKind === 'precomp' && assetId) {
    const assets = Array.isArray(root.assets) ? (root.assets as Record<string, unknown>[]) : [];
    const asset = assets.find((a) => String(a?.id || '') === assetId);
    layers = asset && Array.isArray(asset.layers) ? (asset.layers as unknown[]) : null;
  } else {
    layers = Array.isArray(root.layers) ? (root.layers as unknown[]) : null;
  }
  if (!layers) return root;
  for (const raw of layers) {
    const layer = asObj(raw);
    if (!layer || num(layer.ind) !== layerInd) continue;
    if (!Number.isFinite(Number(layer.w)) || Number(layer.w) <= 0) {
      layer.w = Math.round(baseW);
    }
    if (!Number.isFinite(Number(layer.h)) || Number(layer.h) <= 0) {
      layer.h = Math.round(baseH);
    }
    break;
  }
  return root;
}

export function autoKeyAnimatedProp(opts: {
  document: any;
  nodeId: string;
  propKey: string;
  playheadSec: number;
  /** Explicit value; otherwise sampled from live scene + plate. */
  value?: number | number[];
}): { hostId: string; animationJson: string } | null {
  const link = resolveAnimationLayerLink(opts.document, opts.nodeId);
  if (!link) return null;
  if (
    !isTransformPropAnimated({
      animationData: link.animationData,
      sceneKind: link.sceneKind,
      assetId: link.assetId,
      layerInd: link.layerInd,
      propKey: opts.propKey,
    })
  ) {
    return null;
  }
  const node = opts.document?.deltaSetLike?.[opts.nodeId];
  const value =
    opts.value !== undefined
      ? opts.value
      : liveSceneValueForTransformProp(
          node,
          opts.propKey,
          liveValueContextFromLink(link)
        );
  if (value === undefined) return null;

  const fps = Math.max(1, Number(link.animationData.fr) || 30);
  let anim = link.animationData;
  if (opts.propKey === 's') {
    const nodeW = Math.max(1, num(node?.width, link.layerBaseW));
    const nodeH = Math.max(1, num(node?.height, link.layerBaseH));
    anim = withLayerBaseSize(
      anim,
      link.layerInd,
      link.layerBaseW || nodeW,
      link.layerBaseH || nodeH,
      link.sceneKind,
      link.assetId
    );
  }
  const next = upsertTransformKeyframe({
    animationData: anim,
    sceneKind: link.sceneKind,
    assetId: link.assetId,
    layerInd: link.layerInd,
    propKey: opts.propKey,
    frame: secToFrame(opts.playheadSec, fps),
    value,
  });
  if (!next) return null;
  const json = serializeLottieAnimationData(next);
  if (!json) return null;
  return { hostId: link.hostId, animationJson: json };
}

/** @deprecated Prefer autoKeyAnimatedProp({ propKey: 'r', ... }) */
export function autoKeyAnimatedRotation(opts: {
  document: any;
  nodeId: string;
  angleDeg: number;
  playheadSec: number;
}): { hostId: string; animationJson: string } | null {
  return autoKeyAnimatedProp({
    document: opts.document,
    nodeId: opts.nodeId,
    propKey: 'r',
    playheadSec: opts.playheadSec,
    value: opts.angleDeg,
  });
}

/** Auto-key every animated channel that may have changed with a geometry commit. */
export function autoKeyAnimatedGeometry(opts: {
  document: any;
  nodeId: string;
  playheadSec: number;
  moved: boolean;
  resized: boolean;
}): { hostId: string; animationJson: string } | null {
  const link = resolveAnimationLayerLink(opts.document, opts.nodeId);
  if (!link) return null;
  const node = opts.document?.deltaSetLike?.[opts.nodeId];
  const fps = Math.max(1, Number(link.animationData.fr) || 30);
  const frame = secToFrame(opts.playheadSec, fps);
  const ctx = liveValueContextFromLink(link);
  let anim = link.animationData;
  let wrote = false;

  const tryKey = (propKey: string) => {
    if (
      !isTransformPropAnimated({
        animationData: anim,
        sceneKind: link.sceneKind,
        assetId: link.assetId,
        layerInd: link.layerInd,
        propKey,
      })
    ) {
      return;
    }
    const value = liveSceneValueForTransformProp(node, propKey, ctx);
    if (value === undefined) return;
    if (propKey === 's') {
      anim = withLayerBaseSize(
        anim,
        link.layerInd,
        link.layerBaseW,
        link.layerBaseH,
        link.sceneKind,
        link.assetId
      );
    }
    const next = upsertTransformKeyframe({
      animationData: anim,
      sceneKind: link.sceneKind,
      assetId: link.assetId,
      layerInd: link.layerInd,
      propKey,
      frame,
      value,
    });
    if (next) {
      anim = next;
      wrote = true;
    }
  };

  if (opts.moved) tryKey('p');
  if (opts.resized) tryKey('s');
  // Anchor can shift with resize for image pivots — refresh when animated.
  if (opts.moved || opts.resized) tryKey('a');

  if (!wrote) return null;
  const json = serializeLottieAnimationData(anim);
  if (!json) return null;
  return { hostId: link.hostId, animationJson: json };
}
