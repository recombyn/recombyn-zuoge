/**
 * Apply playhead pose to 动画工作台 scene children (DOM preview).
 * Shared by AnimationPlayheadSceneSync (scrub + resting ink).
 *
 * Geometry preview is only for an active scrub/play session.
 * Resting canvas (dock closed): ink in/out only — restore document x/y/w/h
 * so other hosts / duplicate ops cannot drag sibling node boxes around.
 */
import { getSharedNodeEls, notifyShapeHostGeometry } from '@/components/rcb/shapes/shapeHostRegistry';
import {
  previewSvgNodeAngle,
  previewSvgNodeCornerRadii,
  previewSvgNodeGeometry,
  previewSvgNodeTransform,
} from '@/components/rcb/scene/paint/sceneToSvg';
import { parseLottieAnimationData } from '@/components/rcb/scene/document/nodeFactories';
import { radiiFromAttrs } from '@/components/rcb/scene/document/sceneRadii';
import { lottieLocalToScenePoint } from '@/components/editor/nodes/AnimationNode/animationPrecompEditModel';
import { secToFrame } from '@/components/editor/nodes/AnimationNode/animationTimelineModel';
import { sampleLayerTransformAtFrame } from '@/components/editor/nodes/AnimationNode/animationTimelineMutate';
import { resolveAnimationFrameId } from '@/components/editor/nodes/AnimationNode/resolveAnimationFrameId';
import type { SceneDocument } from '@/components/rcb/sceneNode';

const LINK_KEY = 'ln';

function applyLayerInkVisibility(
  el: SVGElement | HTMLElement | null | undefined,
  inRange: boolean,
  opacityPct: number
) {
  if (!el) return;
  if (inRange) {
    const opN = Math.max(0, Math.min(1, opacityPct / 100));
    if (opN < 0.999) {
      el.style.opacity = String(opN);
      el.setAttribute('opacity', String(opN));
    } else {
      el.style.opacity = '';
      el.removeAttribute('opacity');
    }
    el.style.visibility = '';
    el.style.pointerEvents = '';
  } else {
    el.style.opacity = '0';
    el.setAttribute('opacity', '0');
    el.style.visibility = 'hidden';
    el.style.pointerEvents = 'none';
  }
}

function documentOpacityPct(node: { attrs?: Record<string, unknown> | null }): number {
  const prevOp = Number(node.attrs?.opacity);
  if (!Number.isFinite(prevOp)) return 100;
  return prevOp <= 1 ? prevOp * 100 : prevOp;
}

function restoreDocumentGeometry(
  nodeEls: Map<string, SVGElement>,
  sceneNodeId: string,
  node: {
    x?: unknown;
    y?: unknown;
    width?: unknown;
    height?: unknown;
    attrs?: Record<string, unknown> | null;
  }
) {
  const left = Number(node.x) || 0;
  const top = Number(node.y) || 0;
  const width = Math.max(1, Number(node.width) || 1);
  const height = Math.max(1, Number(node.height) || 1);
  previewSvgNodeGeometry(nodeEls, sceneNodeId, { left, top, width, height });
  const el = nodeEls.get(sceneNodeId) as any;
  if (el) {
    el.__sceneAngle = Number(node.attrs?.angle) || 0;
    el.__sceneSkewX = Number(node.attrs?.skewX) || 0;
    el.__sceneSkewY = Number(node.attrs?.skewY) || 0;
    el.__sceneSkewAxis = Number(node.attrs?.skewAxis) || 0;
    // Drop scrub resize bases so the next paint matches document size.
    delete el.__sceneDidResize;
    delete el.__sceneDragBaseW;
    delete el.__sceneDragBaseH;
  }
  previewSvgNodeAngle(nodeEls, sceneNodeId, Number(node.attrs?.angle) || 0);
  previewSvgNodeTransform(nodeEls, sceneNodeId);
  notifyShapeHostGeometry(sceneNodeId);
  return { left, top, width, height };
}

/** Scrub / resting: map host animation layers → live scene DOM. */
export function applyAnimationPlayheadScenePose(opts: {
  document: SceneDocument;
  hostNodeId: string;
  playheadSec: number;
  /**
   * true (default while scrubbing): sample Lottie transform onto live DOM.
   * false (resting canvas): restore each linked node from document attrs;
   * only apply in/out ink.
   */
  applyGeometry?: boolean;
}): string {
  const { document, hostNodeId } = opts;
  const applyGeometry = opts.applyGeometry !== false;
  const playheadSec = Math.max(0, Number(opts.playheadSec) || 0);
  const host = document?.deltaSetLike?.[hostNodeId];
  if (!host) return '';

  const anim = parseLottieAnimationData(host.attrs?.animationData);
  if (!anim || !Array.isArray(anim.layers)) return '';

  const frameId = resolveAnimationFrameId(document, host);
  const frames = Array.isArray(document.frames) ? document.frames : [];
  const frame = frameId ? frames.find((f) => String(f?.id) === frameId) : null;
  const plate = {
    left: Number(frame?.x ?? host.x) || 0,
    top: Number(frame?.y ?? host.y) || 0,
    width: Math.max(1, Number(frame?.width ?? host.width) || 1),
    height: Math.max(1, Number(frame?.height ?? host.height) || 1),
  };
  const animW = Math.max(1, Number(anim.w) || plate.width);
  const animH = Math.max(1, Number(anim.h) || plate.height);
  const fps = Math.max(1, Number(anim.fr) || Number(frame?.fps) || 30);
  const frameN = secToFrame(playheadSec, fps);

  const nodeEls = getSharedNodeEls();
  if (!nodeEls || !(nodeEls instanceof Map)) return '';

  const sigParts: string[] = [String(frameN), applyGeometry ? 'g' : 'i'];

  const applyLinkedLayers = (
    layers: Record<string, unknown>[],
    sceneKind: 'main' | 'precomp',
    assetId: string | undefined,
    localAnimW: number,
    localAnimH: number
  ) => {
    for (const raw of layers) {
      const sceneNodeId = String(raw?.[LINK_KEY] || '').trim();
      if (!sceneNodeId) continue;
      const node = document.deltaSetLike?.[sceneNodeId];
      if (!node) continue;
      // Never let another plate's layer links rewrite this node's live DOM.
      const nodeFrame = String(node.attrs?.frameId || '').trim();
      if (frameId && nodeFrame && nodeFrame !== frameId) continue;
      const ind = Number(raw.ind);
      if (!Number.isFinite(ind)) continue;

      const ip = Number(raw.ip);
      const op = Number(raw.op);
      const inRange =
        (!Number.isFinite(ip) || frameN >= ip - 1e-6) &&
        (!Number.isFinite(op) || frameN < op - 1e-6);

      if (!applyGeometry) {
        const box = restoreDocumentGeometry(nodeEls, sceneNodeId, node);
        const el = nodeEls.get(sceneNodeId) as any;
        applyLayerInkVisibility(el, inRange, documentOpacityPct(node));
        sigParts.push(
          `${sceneNodeId}:${box.left.toFixed(1)},${box.top.toFixed(1)},${box.width.toFixed(1)},${box.height.toFixed(1)},ink:${inRange ? 1 : 0}`
        );
        continue;
      }

      const sampled = sampleLayerTransformAtFrame({
        animationData: anim,
        sceneKind,
        assetId,
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
        plate,
        localAnimW,
        localAnimH
      );
      const left = center.x - w / 2;
      const top = center.y - h / 2;

      previewSvgNodeGeometry(nodeEls, sceneNodeId, { left, top, width: w, height: h });
      const el = nodeEls.get(sceneNodeId) as any;
      if (el) {
        el.__sceneAngle = sampled.rotation;
        el.__sceneSkewX = sampled.skew;
        el.__sceneSkewY = 0;
        el.__sceneSkewAxis = sampled.skewAxis;
      }
      previewSvgNodeAngle(nodeEls, sceneNodeId, sampled.rotation);
      previewSvgNodeTransform(nodeEls, sceneNodeId);

      const shapeType = String(node.attrs?.shapeType || '');
      if (shapeType && sampled.roundness >= 0) {
        const radii = radiiFromAttrs({
          ...(node.attrs || {}),
          rx: sampled.roundness,
          ry: sampled.roundness,
          cornerRadius: sampled.roundness,
        });
        previewSvgNodeCornerRadii(nodeEls, sceneNodeId, {
          width: w,
          height: h,
          shapeType,
          radii,
          attrs: node.attrs || {},
        });
      }

      notifyShapeHostGeometry(sceneNodeId);
      applyLayerInkVisibility(el, inRange, sampled.opacity);

      sigParts.push(
        `${sceneNodeId}:${left.toFixed(1)},${top.toFixed(1)},${w.toFixed(1)},${h.toFixed(1)},${sampled.rotation.toFixed(1)},${sampled.skew.toFixed(1)},${sampled.roundness.toFixed(1)},${inRange ? 1 : 0}`
      );
    }
  };

  applyLinkedLayers(anim.layers as Record<string, unknown>[], 'main', undefined, animW, animH);

  // LOT-tab session shapes are linked inside precomp assets.
  const assets = Array.isArray(anim.assets) ? (anim.assets as Record<string, unknown>[]) : [];
  for (const asset of assets) {
    if (!asset || !Array.isArray(asset.layers)) continue;
    const assetId = String(asset.id || '').trim();
    if (!assetId) continue;
    applyLinkedLayers(
      asset.layers as Record<string, unknown>[],
      'precomp',
      assetId,
      Math.max(1, Number(asset.w) || animW),
      Math.max(1, Number(asset.h) || animH)
    );
  }
  return sigParts.join('|');
}
