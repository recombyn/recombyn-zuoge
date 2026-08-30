/**
 * Inject synthetic timeline prop rows from image attrs.puppetTrack.
 */
import type { SceneDocument } from '@/components/rcb/sceneNode';
import type {
  LottieTimelineProp,
  LottieTimelineScene,
} from '@/components/editor/nodes/AnimationNode/animationTimelineModel';
import { frameToSec } from '@/components/editor/nodes/AnimationNode/animationTimelineModel';
import {
  isPuppetEnabled,
  readPuppetTrack,
} from '@/components/editor/nodes/ImageNode/puppet/puppetModel';

export const PUPPET_TIMELINE_PROP_KEY = 'puppet';

export function enrichTimelineScenesWithPuppet(
  scenes: LottieTimelineScene[],
  document: SceneDocument | null | undefined
): LottieTimelineScene[] {
  if (!document?.deltaSetLike || !scenes.length) return scenes;

  return scenes.map((scene) => ({
    ...scene,
    layers: scene.layers.map((layer) => {
      const nodeId = layer.sceneNodeId;
      if (!nodeId) return layer;
      const node = document.deltaSetLike?.[nodeId];
      if (!node || node.key !== 'image') return layer;
      if (layer.props.some((p) => p.key === PUPPET_TIMELINE_PROP_KEY)) return layer;

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
