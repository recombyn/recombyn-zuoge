/**
 * Puppet ↔ timeline: inject prop rows, auto-key pin snapshots onto attrs.puppetTrack.
 */
import type { SceneDocument, SceneNodeInput } from '@/components/rcb/sceneNode';
import type {
  LottieTimelineProp,
  LottieTimelineScene,
} from '@/components/editor/nodes/AnimationNode/animationTimelineModel';
import {
  frameToSec,
  secToFrame,
} from '@/components/editor/nodes/AnimationNode/animationTimelineModel';
import { resolveAnimationLayerLink } from '@/components/editor/nodes/AnimationNode/animationAutoKey';
import { getAnimationWorkbenchTimelineFocus } from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';
import {
  findFrameAnimationMediaId,
  resolveAnimationFrameId,
} from '@/components/editor/nodes/AnimationNode/resolveAnimationFrameId';
import { parseLottieAnimationData } from '@/components/rcb/scene/document/nodeFactories';
import {
  isPuppetEnabled,
  readPuppetTrack,
  upsertPuppetTrackKeyframe,
  type PuppetPin,
  type PuppetTrackKeyframe,
} from '@/components/editor/nodes/ImageNode/puppet/puppetModel';

export const PUPPET_TIMELINE_PROP_KEY = 'puppet';

function imageForTimelineLayer(
  document: SceneDocument,
  layer: { ind: number; sceneNodeId?: string }
): SceneNodeInput | null {
  if (layer.sceneNodeId) {
    const n = document.deltaSetLike?.[layer.sceneNodeId];
    if (n?.key === 'image') return n;
  }
  for (const id of Object.keys(document.deltaSetLike || {})) {
    const n = document.deltaSetLike?.[id];
    if (!n || n.key !== 'image') continue;
    if (Number(n.attrs?.lottieLayerInd) === layer.ind) return n;
  }
  return null;
}

export function enrichTimelineScenesWithPuppet(
  scenes: LottieTimelineScene[],
  document: SceneDocument | null | undefined
): LottieTimelineScene[] {
  if (!document?.deltaSetLike || !scenes.length) return scenes;

  return scenes.map((scene) => ({
    ...scene,
    layers: scene.layers.map((layer) => {
      if (layer.props.some((p) => p.key === PUPPET_TIMELINE_PROP_KEY)) return layer;
      const node = imageForTimelineLayer(document, layer);
      if (!node) return layer;
      const attrs = (node.attrs || {}) as Record<string, unknown>;
      const track = readPuppetTrack(attrs);
      if (!isPuppetEnabled(attrs) && !track.length) return layer;

      const prop: LottieTimelineProp = {
        id: `${layer.ind}:${PUPPET_TIMELINE_PROP_KEY}`,
        key: PUPPET_TIMELINE_PROP_KEY,
        label: 'Puppet',
        times: track.map((k) => frameToSec(k.f, scene.fr)),
      };
      return { ...layer, props: [...layer.props, prop] };
    }),
  }));
}

function fpsForPuppetNode(document: any, nodeId: string, frameId: string): number {
  const link = resolveAnimationLayerLink(document, nodeId);
  if (link) return Math.max(1, Number(link.animationData.fr) || 30);
  const hostId = findFrameAnimationMediaId(document, frameId);
  const ad = parseLottieAnimationData(
    document?.deltaSetLike?.[hostId || '']?.attrs?.animationData
  );
  if (ad && Number(ad.fr) > 0) return Math.max(1, Number(ad.fr));
  const frame = (document?.frames || []).find((f: any) => String(f?.id) === frameId);
  return Math.max(1, Number(frame?.fps) || 30);
}

/**
 * Write / update a puppet keyframe at the playhead when the workbench timeline is open.
 * Does not require lottieLayerInd (track lives on image attrs).
 */
export function autoKeyPuppetPins(opts: {
  document: any;
  nodeId: string;
  pins: PuppetPin[];
  playheadSec: number;
}): { track: PuppetTrackKeyframe[] } | null {
  const focus = getAnimationWorkbenchTimelineFocus();
  if (!focus) return null;
  const node = opts.document?.deltaSetLike?.[opts.nodeId];
  if (!node || node.key !== 'image') return null;
  const frameId = resolveAnimationFrameId(opts.document, node);
  if (!frameId || frameId !== focus) return null;

  const fps = fpsForPuppetNode(opts.document, opts.nodeId, frameId);
  const attrs = (node.attrs || {}) as Record<string, unknown>;
  const track = upsertPuppetTrackKeyframe(
    readPuppetTrack(attrs),
    secToFrame(opts.playheadSec, fps),
    opts.pins
  );
  return { track };
}

/** Expand the timeline layer row so the 人偶 track is visible. */
export function expandPuppetTimelineLayer(node: SceneNodeInput | null | undefined) {
  const ind = Number(node?.attrs?.lottieLayerInd);
  if (!Number.isFinite(ind) || ind <= 0) return;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('lottie-timeline-expand-layer', { detail: { layerInd: ind } })
  );
}
