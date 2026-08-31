/**
 * Import → parse → spawn → timeline recognition (no browser).
 * Uses real LottieFiles exports + SAMPLE + adversarial cases.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  editorReducers,
  reduceEditor,
  createTemplate,
  openLottieTimelinePanel,
  spawnLottie,
  spawnAnimationBoard,
  placeUploadedLottie,
  patchDocumentNode,
} from '@/store/modules/editor';
import { createEmptyDocument } from '@/components/rcb/scene/document/sceneDocument';
import {
  parseLottieAnimationData,
  serializeLottieAnimationData,
  SAMPLE_LOTTIE_ANIMATION,
  createLottieNode,
} from '@/components/rcb/scene/document/nodeFactories';
import {
  buildLottieTimelineScenes,
  snapSecToFrame,
  secToFrame,
} from '@/components/editor/nodes/AnimationNode/animationTimelineModel';
import {
  upsertTransformKeyframe,
  setLayerTimeRange,
  setTransformKeyframeValue,
  readTransformKeyframe,
} from '@/components/editor/nodes/AnimationNode/animationTimelineMutate';
import {
  setAnimationWorkbenchPlayheadSec,
  setAnimationWorkbenchTimelineFocus,
  getAnimationWorkbenchTimelineFocus,
} from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures'
);

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

afterEach(() => {
  setAnimationWorkbenchTimelineFocus(null);
  setAnimationWorkbenchPlayheadSec(0);
});

function seed() {
  setAnimationWorkbenchTimelineFocus(null);
  setAnimationWorkbenchPlayheadSec(0);
  let state = reduceEditor(undefined, () => {});
  state = reduceEditor(state, editorReducers.createTemplate, {
      name: 'lottie-import-timeline',
      document: createEmptyDocument({ emptyWorld: true }),
      emptyWorld: true,
      source: 'scratch',
    });
  return state;
}

describe('Lottie import → timeline (integration)', () => {
  it('rejects invalid / non-lottie payloads like the toolstrip upload path', () => {
    expect(parseLottieAnimationData('')).toBeNull();
    expect(parseLottieAnimationData('{')).toBeNull();
    expect(parseLottieAnimationData('[]')).toBeNull();
    expect(parseLottieAnimationData({ w: 100, h: 100 })).toBeNull(); // no layers
    expect(parseLottieAnimationData({ layers: 'nope' })).toBeNull();
  });

  it('accepts SAMPLE_LOTTIE and builds a usable Main Scene timeline', () => {
    const parsed = parseLottieAnimationData(SAMPLE_LOTTIE_ANIMATION);
    expect(parsed).toBeTruthy();
    expect(Array.isArray(parsed!.layers)).toBe(true);

    const scenes = buildLottieTimelineScenes(parsed, 'Sample', {
      includeEmptyProps: true,
    });
    expect(scenes).toHaveLength(1);
    expect(scenes[0].id).toBe('main');
    expect(scenes[0].fr).toBe(60);
    expect(scenes[0].durationSec).toBe(2); // 120/60
    expect(scenes[0].layers).toHaveLength(1);
    const scale = scenes[0].layers[0].props.find((p) => p.key === 's');
    expect(scale?.times).toEqual([0, 1, 2]);
  });

  it('toolstrip-style JSON upload: parse → spawnLottie → independent preview plate', () => {
    const text = JSON.stringify(SAMPLE_LOTTIE_ANIMATION);
    const animationData = parseLottieAnimationData(text);
    expect(animationData).toBeTruthy();

    let state = seed();
    state = reduceEditor(state, editorReducers.spawnLottie, {
        animationData,
        width: Number(animationData!.w) || 200,
        height: Number(animationData!.h) || 200,
        x: 40,
        y: 40,
        name: 'pulse-upload',
      });
    const plateId = String(state.selectedNodeId || '');
    expect(plateId).toBeTruthy();
    const plate = state.document!.deltaSetLike[plateId];
    expect(plate.key).toBe('lottie');
    expect(plate.attrs?.animationFrameHost).toBeFalsy();
    expect(plate.attrs?.frameId).toBeFalsy();
    expect(state.selectedFrameIds || []).toEqual([]);
    const animFrames = (state.document!.frames || []).filter(
      (f: any) => f?.kind === 'animation'
    );
    expect(animFrames).toHaveLength(0);

    const stored = parseLottieAnimationData(plate.attrs?.animationData);
    expect(stored).toBeTruthy();
    expect((stored!.layers as unknown[]).length).toBeGreaterThan(0);
  });

  it('spawnLottie with frameId still lands as free preview (does not nest into workbench)', () => {
    const animationData = parseLottieAnimationData(SAMPLE_LOTTIE_ANIMATION);
    expect(animationData).toBeTruthy();

    let state = seed();
    state = reduceEditor(state, editorReducers.spawnAnimationBoard, {
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        name: '动画工作台',
      });
    const frameId = String(state.selectedFrameIds?.[0] || '');
    expect(frameId).toBeTruthy();
    setAnimationWorkbenchTimelineFocus(frameId);

    state = reduceEditor(state, editorReducers.spawnLottie, {
        animationData,
        name: 'free-preview',
        frameId,
      });
    const plateId = String(state.selectedNodeId || '');
    expect(plateId).toBeTruthy();
    const plate = state.document!.deltaSetLike[plateId];
    expect(plate.key).toBe('lottie');
    expect(plate.attrs?.frameId).toBeFalsy();
    expect(plate.attrs?.animationFrameHost).toBeFalsy();
    // Edit isolation: pasteboard surround — not nested into the plate.
    expect(String(plate.attrs?.animationWorkbenchSurround || '')).toBe(frameId);
    expect(state.lottiePrecompEdit).toBeNull();
  });

  it('desktop retake LOT promote nests as lot plate with precomp tab (not exploded shapes)', () => {
    const raw = loadFixture('retake-lot-edited.json');
    const animationData = parseLottieAnimationData(raw);
    expect(animationData).toBeTruthy();

    let state = seed();
    state = reduceEditor(state, editorReducers.placeUploadedLottie, {
        animationData,
        name: '重测生成LOT-edited',
      });
    const frameId = String(state.selectedFrameIds?.[0] || '');
    expect(frameId).toBeTruthy();
    const hostId = Object.keys(state.document!.deltaSetLike || {}).find((id) => {
      const n = state.document!.deltaSetLike[id];
      return (
        n?.key === 'lottie' &&
        (n.attrs?.animationFrameHost === true || n.attrs?.animationFrameHost === 'true') &&
        String(n.attrs?.frameId || '') === frameId
      );
    });
    expect(hostId).toBeTruthy();
    expect(state.lottieTimelinePanel?.nodeId).toBe(hostId);
    expect(state.lottiePrecompEdit).toBeNull();

    const nested = Object.entries(state.document!.deltaSetLike || {}).find(
      ([id, n]) =>
        id !== hostId &&
        n?.key === 'lottie' &&
        String(n.attrs?.frameId || '') === frameId &&
        !n.attrs?.animationFrameHost
    );
    expect(nested).toBeTruthy();
    const [lotId] = nested!;

    const host = state.document!.deltaSetLike[hostId!];
    const hostAnim = parseLottieAnimationData(host.attrs?.animationData);
    const scenes = buildLottieTimelineScenes(hostAnim, 'wb', { includeEmptyProps: true });
    expect(scenes.some((s) => s.id === 'main')).toBe(true);
    expect(scenes.some((s) => s.id === `precomp:lot_${lotId}`)).toBe(true);
  });

  it('openLottieTimelinePanel promotes free LOT plate into workbench with LOT tab', () => {
    const animationData = parseLottieAnimationData(SAMPLE_LOTTIE_ANIMATION);
    expect(animationData).toBeTruthy();
    let state = seed();
    state = reduceEditor(state, editorReducers.spawnLottie, {
        animationData,
        name: 'free-lot',
        x: 10,
        y: 10,
      });
    const freeId = String(state.selectedNodeId || '');
    expect(freeId).toBeTruthy();
    expect(state.selectedFrameIds || []).toEqual([]);

    state = reduceEditor(state, editorReducers.openLottieTimelinePanel, { nodeId: freeId });
    expect(state.document!.deltaSetLike[freeId]).toBeUndefined();
    const frameId = String(state.selectedFrameIds?.[0] || '');
    expect(frameId).toBeTruthy();
    expect(getAnimationWorkbenchTimelineFocus()).toBe(frameId);
    expect(state.lottieTimelinePanel?.nodeId).toBeTruthy();
    expect(state.lottiePrecompEdit).toBeNull();

    const hostId = String(state.lottieTimelinePanel!.nodeId);
    const nested = Object.entries(state.document!.deltaSetLike || {}).find(
      ([id, n]) =>
        id !== hostId &&
        n?.key === 'lottie' &&
        String(n.attrs?.frameId || '') === frameId
    );
    expect(nested).toBeTruthy();
    const hostAnim = parseLottieAnimationData(
      state.document!.deltaSetLike[hostId].attrs?.animationData
    );
    const scenes = buildLottieTimelineScenes(hostAnim, 'wb', { includeEmptyProps: true });
    expect(scenes.some((s) => s.kind === 'precomp')).toBe(true);
  });

  it('recognizes real LottieFiles export with precomps (cannons)', () => {
    const raw = loadFixture('animation-sample-cannons.json');
    const parsed = parseLottieAnimationData(raw);
    expect(parsed).toBeTruthy();
    expect(parsed!.w).toBe(609);
    expect(parsed!.h).toBe(812);
    expect(parsed!.fr).toBe(60);
    expect((parsed!.layers as unknown[]).length).toBe(3);

    const scenes = buildLottieTimelineScenes(parsed, 'cannons', {
      includeEmptyProps: true,
    });
    // Main + 5 precomp assets
    expect(scenes.length).toBe(6);
    expect(scenes[0].kind).toBe('main');
    expect(scenes[0].durationSec).toBe(5); // 300/60
    expect(scenes[0].layers).toHaveLength(3);
    // Main layers are precomp refs — transforms often static on root
    expect(scenes[0].layers.every((l) => l.props.length === 7)).toBe(true);

    const precomps = scenes.filter((s) => s.kind === 'precomp');
    expect(precomps).toHaveLength(5);
    expect(precomps.some((s) => s.layers.length >= 20)).toBe(true);
    // At least one precomp should expose animated transform tracks
    const animatedPropCount = precomps.reduce(
      (n, s) =>
        n +
        s.layers.reduce(
          (m, l) => m + l.props.filter((p) => p.times.length > 0).length,
          0
        ),
      0
    );
    expect(animatedPropCount).toBeGreaterThan(0);
  });

  it('round-trips mutate on a real precomp layer and keeps JSON valid', () => {
    const parsed = parseLottieAnimationData(loadFixture('animation-sample-cannons.json'));
    expect(parsed).toBeTruthy();
    const scenes = buildLottieTimelineScenes(parsed, 'cannons', {
      includeEmptyProps: true,
    });
    const pre = scenes.find((s) => s.kind === 'precomp' && s.layers.length > 0);
    expect(pre).toBeTruthy();
    const layer = pre!.layers[0];
    const frame = secToFrame(pre!.durationSec * 0.25, pre!.fr);

    const withKf = upsertTransformKeyframe({
      animationData: parsed!,
      sceneKind: 'precomp',
      assetId: pre!.assetId,
      layerInd: layer.ind,
      propKey: 'o',
      frame,
    });
    expect(withKf).toBeTruthy();

    const trimmed = setLayerTimeRange({
      animationData: withKf!,
      sceneKind: 'precomp',
      assetId: pre!.assetId,
      layerInd: layer.ind,
      inFrame: 0,
      outFrame: Math.max(2, Math.round(pre!.op / 2)),
    });
    expect(trimmed).toBeTruthy();

    const json = serializeLottieAnimationData(trimmed);
    expect(json).toBeTruthy();
    const again = parseLottieAnimationData(json);
    const scenes2 = buildLottieTimelineScenes(again, 'cannons', {
      includeEmptyProps: true,
    });
    const pre2 = scenes2.find((s) => s.assetId === pre!.assetId);
    const layer2 = pre2?.layers.find((l) => l.ind === layer.ind);
    expect(layer2?.props.some((p) => p.key === 'o' && p.times.length > 0)).toBe(
      true
    );
  });

  it('recognizes second real export (Failed) and can edit main opacity', () => {
    const parsed = parseLottieAnimationData(loadFixture('animation-sample-failed.json'));
    expect(parsed).toBeTruthy();
    const scenes = buildLottieTimelineScenes(parsed, 'Failed', {
      includeEmptyProps: true,
    });
    expect(scenes.length).toBeGreaterThanOrEqual(1);
    expect(scenes[0].layers.length).toBeGreaterThanOrEqual(1);

    const layer = scenes[0].layers[0];
    const next = upsertTransformKeyframe({
      animationData: parsed!,
      sceneKind: 'main',
      layerInd: layer.ind,
      propKey: 'o',
      frame: 10,
      value: 42,
    });
    expect(next).toBeTruthy();
    const read = readTransformKeyframe({
      animationData: next!,
      sceneKind: 'main',
      layerInd: layer.ind,
      propKey: 'o',
      frame: 10,
    });
    expect(read?.value === 42 || (Array.isArray(read?.value) && read?.value[0] === 42)).toBe(
      true
    );

    const updated = setTransformKeyframeValue({
      animationData: next!,
      sceneKind: 'main',
      layerInd: layer.ind,
      propKey: 'o',
      frame: 10,
      value: 80,
    });
    const read2 = readTransformKeyframe({
      animationData: updated!,
      sceneKind: 'main',
      layerInd: layer.ind,
      propKey: 'o',
      frame: 10,
    });
    expect(read2?.value === 80 || (Array.isArray(read2?.value) && read2?.value[0] === 80)).toBe(
      true
    );
  });

  it('createLottieNode stores serializable animationData for dock consumption', () => {
    const { id, node } = createLottieNode({
      animationData: SAMPLE_LOTTIE_ANIMATION,
      name: 'factory',
    });
    expect(id).toBeTruthy();
    expect(node.key).toBe('lottie');
    const data = parseLottieAnimationData(node.attrs?.animationData);
    expect(data?.nm).toBe('Sample');
    expect(buildLottieTimelineScenes(data)[0].layers[0].name).toBe('Dot');
  });

  it('store patch after timeline edit keeps panel node resolvable', () => {
    let state = seed();
    state = reduceEditor(state, editorReducers.spawnLottie, {
        animationData: SAMPLE_LOTTIE_ANIMATION,
        name: 'patch-me',
      });
    const freeId = String(state.selectedNodeId || '');
    expect(freeId).toBeTruthy();
    state = reduceEditor(state, editorReducers.openLottieTimelinePanel, { nodeId: freeId });
    // Free plate is promoted to workbench host on open.
    const nodeId = String(state.lottieTimelinePanel?.nodeId || '');
    expect(nodeId).toBeTruthy();

    const data = parseLottieAnimationData(
      state.document!.deltaSetLike[nodeId].attrs?.animationData
    )!;
    const before = buildLottieTimelineScenes(data, 'patch-me', { includeEmptyProps: true });
    const pre = before.find((s) => s.kind === 'precomp' && s.layers.length > 0);
    expect(pre).toBeTruthy();
    const layerInd = pre!.layers[0].ind;
    const mutated = upsertTransformKeyframe({
      animationData: data,
      sceneKind: 'precomp',
      assetId: pre!.assetId,
      layerInd,
      propKey: 'r',
      frame: 30,
      value: 45,
    })!;
    const json = serializeLottieAnimationData(mutated)!;
    state = reduceEditor(state, editorReducers.patchDocumentNode, {
        nodeId,
        patch: { attrs: { animationData: json } },
      });

    expect(state.lottieTimelinePanel?.nodeId).toBe(nodeId);
    const scenes = buildLottieTimelineScenes(
      parseLottieAnimationData(
        state.document!.deltaSetLike[nodeId].attrs?.animationData
      ),
      'patch-me',
      { includeEmptyProps: true }
    );
    const pre2 = scenes.find((s) => s.id === pre!.id);
    expect(pre2).toBeTruthy();
    const rot = pre2!.layers
      .find((l) => l.ind === layerInd)
      ?.props.find((p) => p.key === 'r');
    expect(rot?.times.length).toBeGreaterThan(0);
  });

  it('does not treat image-only assets as timeline scenes', () => {
    const anim = {
      fr: 30,
      ip: 0,
      op: 30,
      w: 100,
      h: 100,
      layers: [{ ind: 1, nm: 'Img', ty: 2, refId: 'img_0', ip: 0, op: 30, ks: {} }],
      assets: [{ id: 'img_0', w: 10, h: 10, u: '', p: 'x.png' }],
    };
    const scenes = buildLottieTimelineScenes(anim, 'img', { includeEmptyProps: true });
    expect(scenes).toHaveLength(1);
    expect(scenes[0].kind).toBe('main');
  });
});
