/**
 * Push a sampled Lottie layer transform onto the linked scene node (store).
 * Used after editing a keyframe at the playhead so chrome / anchor track the pose.
 */
import { lottieLocalToScenePoint } from '@/components/editor/nodes/AnimationNode/animationPrecompEditModel';
import { sampleLayerTransformAtFrame } from '@/components/editor/nodes/AnimationNode/animationTimelineMutate';
import { secToFrame } from '@/components/editor/nodes/AnimationNode/animationTimelineModel';

const LINK_KEY = 'ln';

export type ScenePosePatch = {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  attrs: Record<string, unknown>;
};

export function buildScenePosePatchesFromAnimation(opts: {
  document: any;
  animationData: Record<string, unknown>;
  playheadSec: number;
  /** Only update these layer inds when set. */
  layerInds?: number[];
  plate: { left: number; top: number; width: number; height: number };
}): ScenePosePatch[] {
  const anim = opts.animationData;
  if (!anim || !Array.isArray(anim.layers)) return [];
  const fps = Math.max(1, Number(anim.fr) || 30);
  const frameN = secToFrame(opts.playheadSec, fps);
  const animW = Math.max(1, Number(anim.w) || opts.plate.width);
  const animH = Math.max(1, Number(anim.h) || opts.plate.height);
  const want =
    opts.layerInds && opts.layerInds.length
      ? new Set(opts.layerInds)
      : null;
  const out: ScenePosePatch[] = [];

  for (const raw of anim.layers as Record<string, unknown>[]) {
    const ind = Number(raw.ind);
    if (!Number.isFinite(ind)) continue;
    if (want && !want.has(ind)) continue;
    const sceneNodeId = String(raw?.[LINK_KEY] || '').trim();
    if (!sceneNodeId) continue;
    const node = opts.document?.deltaSetLike?.[sceneNodeId];
    if (!node) continue;

    const sampled = sampleLayerTransformAtFrame({
      animationData: anim,
      sceneKind: 'main',
      layerInd: ind,
      frame: frameN,
    });
    if (!sampled) continue;

    const baseW = Math.max(1, Number(raw.w) || Number(node.width) || 1);
    const baseH = Math.max(1, Number(raw.h) || Number(node.height) || 1);
    const sx = Math.max(0.01, sampled.scaleX / 100);
    const sy = Math.max(0.01, sampled.scaleY / 100);
    const w = Math.max(1, baseW * sx);
    const h = Math.max(1, baseH * sy);
    const center = lottieLocalToScenePoint(
      sampled.cx,
      sampled.cy,
      opts.plate,
      animW,
      animH
    );
    const left = center.x - w / 2;
    const top = center.y - h / 2;

    const opacityPct = Math.max(0, Math.min(100, sampled.opacity));
    const prevOp = Number(node.attrs?.opacity);
    const opacityAttr =
      Number.isFinite(prevOp) && prevOp <= 1
        ? opacityPct / 100
        : opacityPct;

    out.push({
      nodeId: sceneNodeId,
      x: Math.round(left * 100) / 100,
      y: Math.round(top * 100) / 100,
      width: Math.round(w * 100) / 100,
      height: Math.round(h * 100) / 100,
      attrs: {
        angle: Math.round(sampled.rotation * 100) / 100,
        opacity: opacityAttr,
        skewX: Math.round(sampled.skew * 100) / 100,
        skewAxis: Math.round(sampled.skewAxis * 100) / 100,
        skewY: '',
      },
    });
  }
  return out;
}
