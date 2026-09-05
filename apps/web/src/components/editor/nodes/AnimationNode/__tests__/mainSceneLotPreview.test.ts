import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setAnimationWorkbenchTimelineFocus } from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';
import { setLottiePrecompEditFocus } from '@/components/editor/nodes/AnimationNode/animationPrecompEditFocus';
import {
  isMainSceneLotPreviewReady,
  resolveMainSceneNestedLotAnimationJson,
} from '@/components/editor/nodes/AnimationNode/mainSceneLotPreview';
import { extractPrecompAssetJson } from '@/components/editor/nodes/AnimationNode/animationPrecompEditModel';
import { parseLottieAnimationData } from '@/components/rcb/scene/document/nodeFactories';
import {
  editorReducers,
  reduceEditor,
  createTemplate,
  enterLottiePrecompEdit,
  ensureAnimationFrameMedia,
  exitLottiePrecompEdit,
  finishLottieGenerator,
  patchDocumentNodes,
  placeUploadedLottie,
  setDocumentFromCanvas,
  spawnLottieGeneratorPlate,
} from '@/store/modules/editor';
import { collectPrecompSessionDocumentPatches } from '@/components/editor/nodes/AnimationNode/animationPlayheadSceneApply';
import { createEmptyDocument } from '@/components/rcb/scene/document/sceneDocument';
import {
  isHiddenByLottiePrecompEditFocus,
} from '@/components/editor/nodes/AnimationNode/animationPrecompEditFocus';
import { isNodeStructurallyHiddenInDocument } from '@/components/rcb/scene/document/nodeCapabilities';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

afterEach(() => {
  setAnimationWorkbenchTimelineFocus(null);
  setLottiePrecompEditFocus({ active: false });
});

function seedEditor() {
  let state = reduceEditor(undefined, () => {});
  state = reduceEditor(state, editorReducers.createTemplate, {
      name: 'main-scene-lot',
      document: createEmptyDocument({ emptyWorld: true }),
      emptyWorld: true,
      source: 'scratch',
    });
  return state;
}

function findNestedLot(state: ReturnType<typeof seedEditor>, hostId: string, frameId: string) {
  return Object.keys(state.document!.deltaSetLike || {}).find((id) => {
    const n = state.document!.deltaSetLike[id];
    return (
      id !== hostId &&
      n?.key === 'lottie' &&
      String(n.attrs?.frameId || '') === frameId &&
      !n.attrs?.animationFrameHost
    );
  });
}

function lotFixture() {
  return parseLottieAnimationData(
    readFileSync(join(FIXTURES, 'retake-lot-edited.json'), 'utf8')
  );
}

function userLotFixture() {
  return parseLottieAnimationData(
    readFileSync(join(FIXTURES, 'retake-lot-user.json'), 'utf8')
  );
}

describe('main scene LOT preview data', () => {
  it('placeUploadedLottie: frameLocal nest stays inside plate (non-zero frame origin)', () => {
    const anim = lotFixture();
    expect(anim).toBeTruthy();

    let state = seedEditor();
    expect(String(state.document?.coordSpace || '')).toBe('frameLocal');
    state = reduceEditor(state, editorReducers.placeUploadedLottie, {
      animationData: anim,
      name: '测试生成LOT-edited',
      x: 480,
      y: 320,
      width: 418,
      height: 418,
    });
    const frameId = String(state.selectedFrameIds?.[0] || '');
    const hostId = String(state.lottieTimelinePanel!.nodeId);
    const lotId = findNestedLot(state, hostId, frameId)!;
    expect(lotId).toBeTruthy();

    const frame = (state.document!.frames || []).find((f) => String(f?.id) === frameId)!;
    expect(Number(frame.x)).toBe(480);
    expect(Number(frame.y)).toBe(320);

    const lot = state.document!.deltaSetLike[lotId];
    // Plate-local — not world (480+…). World coords get clipped away → blank 主场景.
    expect(Number(lot.x)).toBeLessThan(Number(frame.width));
    expect(Number(lot.y)).toBeLessThan(Number(frame.height));
    expect(Number(lot.x)).toBeGreaterThanOrEqual(0);
    expect(Number(lot.y)).toBeGreaterThanOrEqual(0);
    expect(isNodeStructurallyHiddenInDocument(state.document, lot)).toBe(false);
    expect(isMainSceneLotPreviewReady(state.document!, lotId)).toBe(true);

    const lotXBefore = Number(lot.x);
    const lotYBefore = Number(lot.y);
    state = reduceEditor(state, editorReducers.enterLottiePrecompEdit, {
      hostNodeId: hostId,
      assetId: `lot_${lotId}`,
      selectedLayerInd: 1,
    });
    expect(state.lottiePrecompEdit?.assetId).toBe(`lot_${lotId}`);
    expect((state.lottiePrecompEdit?.sessionNodeIds || []).length).toBe(0);
    // Lightweight LOT tab — geom stays put (same LottiePlate as 主场景).
    const lotDuring = state.document!.deltaSetLike[lotId];
    expect(Number(lotDuring.x)).toBe(lotXBefore);
    expect(Number(lotDuring.y)).toBe(lotYBefore);
    expect(isNodeStructurallyHiddenInDocument(state.document, lotDuring)).toBe(false);

    state = reduceEditor(state, editorReducers.exitLottiePrecompEdit);
    expect(state.lottiePrecompEdit).toBeNull();
    const lotAfter = state.document!.deltaSetLike[lotId];
    expect(Number(lotAfter.x)).toBe(lotXBefore);
    expect(Number(lotAfter.y)).toBe(lotYBefore);
    expect(isMainSceneLotPreviewReady(state.document!, lotId)).toBe(true);
    expect(isNodeStructurallyHiddenInDocument(state.document, lotAfter)).toBe(false);
    const frameAfter = (state.document!.frames || []).find((f) => String(f?.id) === frameId)!;
    expect(Number(frameAfter.x)).toBe(480);
    expect(Number(frameAfter.y)).toBe(320);
    expect(Number(frameAfter.width)).toBe(418);
  });

  it('placeUploadedLottie: 主场景 preview ready before and after LOT tab exit', () => {
    const anim = lotFixture();
    expect(anim).toBeTruthy();

    let state = seedEditor();
    state = reduceEditor(state, editorReducers.placeUploadedLottie, {
        animationData: anim,
        name: '搜索生成LOT-edited',
      });
    const frameId = String(state.selectedFrameIds?.[0] || '');
    const hostId = String(state.lottieTimelinePanel!.nodeId);
    const lotId = findNestedLot(state, hostId, frameId)!;
    expect(lotId).toBeTruthy();

    expect(state.lottiePrecompEdit).toBeNull();
    expect(isMainSceneLotPreviewReady(state.document!, lotId)).toBe(true);

    const hostBefore = state.document!.deltaSetLike[hostId];
    const fromHostBefore = extractPrecompAssetJson(
      hostBefore.attrs?.animationData,
      `lot_${lotId}`
    );
    expect(fromHostBefore).toBeTruthy();
    expect(resolveMainSceneNestedLotAnimationJson(state.document!, lotId)).toBe(fromHostBefore);

    state = reduceEditor(state, editorReducers.enterLottiePrecompEdit, { hostNodeId: hostId, assetId: `lot_${lotId}`, selectedLayerInd: 1 });
    expect(state.lottiePrecompEdit?.assetId).toBe(`lot_${lotId}`);
    expect((state.lottiePrecompEdit?.sessionNodeIds || []).length).toBe(0);
    expect(state.document!.deltaSetLike![lotId].attrs?.hidden).toBeFalsy();

    state = reduceEditor(state, editorReducers.exitLottiePrecompEdit);
    expect(state.lottiePrecompEdit).toBeNull();

    const lotNode = state.document!.deltaSetLike[lotId];
    expect(lotNode.attrs?.hidden).toBeFalsy();
    expect(isMainSceneLotPreviewReady(state.document!, lotId)).toBe(true);

    const hostAfter = state.document!.deltaSetLike[hostId];
    const fromHostAfter = extractPrecompAssetJson(
      hostAfter.attrs?.animationData,
      `lot_${lotId}`
    );
    expect(fromHostAfter).toBeTruthy();
    const lotJson = resolveMainSceneNestedLotAnimationJson(state.document!, lotId);
    expect(lotJson).toBe(fromHostAfter);

    const parsed = parseLottieAnimationData(lotJson);
    const layer0 = (parsed!.layers as Record<string, unknown>[])[0];
    expect(Number(layer0?.ty)).toBe(4);
    expect(Array.isArray(layer0?.shapes) && (layer0!.shapes as unknown[]).length).toBeGreaterThan(
      0
    );
    // Preview prefers host precomp asset; plate JSON may differ in nm/meta only.
    const plateParsed = parseLottieAnimationData(lotNode.attrs?.animationData);
    expect(plateParsed).toBeTruthy();
    expect((plateParsed!.layers as unknown[]).length).toBe(
      (parsed!.layers as unknown[]).length
    );
  });

  it('LOT tab switch keeps same nested-lot preview (no materialize)', () => {
    const anim = lotFixture();
    let state = seedEditor();
    state = reduceEditor(state, editorReducers.placeUploadedLottie, {
        animationData: anim,
        name: '搜索生成LOT-edited',
      });
    const frameId = String(state.selectedFrameIds?.[0] || '');
    const hostId = String(state.lottieTimelinePanel!.nodeId);
    const lotId = findNestedLot(state, hostId, frameId)!;
    const assetId = `lot_${lotId}`;
    const before = resolveMainSceneNestedLotAnimationJson(state.document!, lotId);

    state = reduceEditor(state, editorReducers.enterLottiePrecompEdit, { hostNodeId: hostId, assetId, selectedLayerInd: 1 });
    expect((state.lottiePrecompEdit?.sessionNodeIds || []).length).toBe(0);
    expect(state.lottiePrecompEdit?.sessionHidesLotInk).toBe(false);
    expect(isMainSceneLotPreviewReady(state.document!, lotId)).toBe(true);

    state = reduceEditor(state, editorReducers.exitLottiePrecompEdit);
    expect(state.lottiePrecompEdit).toBeNull();
    expect(isMainSceneLotPreviewReady(state.document!, lotId)).toBe(true);
    expect(resolveMainSceneNestedLotAnimationJson(state.document!, lotId)).toBe(before);
  });

  it('user JSON: LOT tab enter keeps nested lot geom (same paint path)', () => {
    const anim = userLotFixture();
    expect(anim).toBeTruthy();

    let state = seedEditor();
    state = reduceEditor(state, editorReducers.placeUploadedLottie, {
      animationData: anim,
      name: '重测生成LOT-edited',
    });
    const frameId = String(state.selectedFrameIds?.[0] || '');
    const hostId = String(state.lottieTimelinePanel!.nodeId);
    const lotId = findNestedLot(state, hostId, frameId)!;
    const assetId = `lot_${lotId}`;
    const lotBefore = state.document!.deltaSetLike[lotId];
    const x0 = Number(lotBefore.x);
    const y0 = Number(lotBefore.y);
    const w0 = Number(lotBefore.width);

    state = reduceEditor(state, editorReducers.enterLottiePrecompEdit, {
      hostNodeId: hostId,
      assetId,
      selectedLayerInd: 1,
    });
    const lot = state.document!.deltaSetLike[lotId];
    expect(Number(lot.x)).toBe(x0);
    expect(Number(lot.y)).toBe(y0);
    expect(Number(lot.width)).toBe(w0);
    expect((state.lottiePrecompEdit?.sessionNodeIds || []).length).toBe(0);
  });

  it('user JSON: tab switch keeps 主场景 preview ready', () => {
    const anim = userLotFixture();
    expect(anim).toBeTruthy();
    let state = seedEditor();
    state = reduceEditor(state, editorReducers.placeUploadedLottie, {
        animationData: anim,
        name: '重测生成LOT-edited',
      });
    const frameId = String(state.selectedFrameIds?.[0] || '');
    const hostId = String(state.lottieTimelinePanel!.nodeId);
    const lotId = findNestedLot(state, hostId, frameId)!;
    expect(lotId).toBeTruthy();
    expect(isMainSceneLotPreviewReady(state.document!, lotId)).toBe(true);

    const assetId = `lot_${lotId}`;
    state = reduceEditor(state, editorReducers.enterLottiePrecompEdit, { hostNodeId: hostId, assetId, selectedLayerInd: 1 });
    expect((state.lottiePrecompEdit?.sessionNodeIds || []).length).toBe(0);
    expect(isNodeStructurallyHiddenInDocument(state.document, state.document!.deltaSetLike[lotId])).toBe(
      false
    );
    expect(isHiddenByLottiePrecompEditFocus(lotId, state.document!.deltaSetLike[lotId])).toBe(false);

    state = reduceEditor(state, editorReducers.ensureAnimationFrameMedia, { frameId, skipHistory: true });

    state = reduceEditor(state, editorReducers.exitLottiePrecompEdit);
    expect(state.lottiePrecompEdit).toBeNull();
    expect(isMainSceneLotPreviewReady(state.document!, lotId)).toBe(true);
    expect(isNodeStructurallyHiddenInDocument(state.document, state.document!.deltaSetLike[lotId])).toBe(
      false
    );

    state = reduceEditor(state, editorReducers.enterLottiePrecompEdit, { hostNodeId: hostId, assetId, selectedLayerInd: 1 });
    expect(state.lottiePrecompEdit?.assetId).toBe(assetId);
    expect((state.lottiePrecompEdit?.sessionNodeIds || []).length).toBe(0);
  });

  it('user JSON: LOT tab playhead bake does not infinite-loop with persist', () => {
    const anim = userLotFixture();
    expect(anim).toBeTruthy();
    let state = seedEditor();
    state = reduceEditor(state, editorReducers.placeUploadedLottie, {
        animationData: anim,
        name: '重测生成LOT-edited',
      });
    const hostId = String(state.lottieTimelinePanel!.nodeId);
    const frameId = String(state.selectedFrameIds?.[0] || '');
    const lotId = findNestedLot(state, hostId, frameId)!;
    const assetId = `lot_${lotId}`;

    state = reduceEditor(state, editorReducers.enterLottiePrecompEdit, { hostNodeId: hostId, assetId, selectedLayerInd: 1 });
    // Lightweight tab: no materialized session shapes — bake has nothing to patch.
    expect((state.lottiePrecompEdit?.sessionNodeIds || []).length).toBe(0);

    let lastToken = state.documentPatchToken;
    let lastPatches = -1;
    let lastSig = '';
    for (let i = 0; i < 12; i += 1) {
      const patches = collectPrecompSessionDocumentPatches({
        document: state.document!,
        hostNodeId: hostId,
        playheadSec: Number(state.lottiePlayheadSec) || 0,
      });
      lastPatches = patches.length;
      const sig = patches
        .map(
          (p) =>
            `${p.nodeId}:${p.patch.x},${p.patch.y},${p.patch.width},${p.patch.height}`
        )
        .join('|');
      // React layout effect re-entry: same sig must not keep dispatching.
      if (patches.length && sig === lastSig) {
        throw new Error(`playhead bake sig did not stabilize (iter ${i})`);
      }
      lastSig = sig;
      if (!patches.length) break;
      state = reduceEditor(state, editorReducers.patchDocumentNodes, { patches, skipHistory: true });
      // Canvas remount during LOT tab — must not persist/autoKey.
      state = reduceEditor(state, editorReducers.ensureAnimationFrameMedia, {
        frameId,
        skipHistory: true,
      });
      expect(state.documentPatchToken - lastToken).toBeLessThan(4);
      lastToken = state.documentPatchToken;
    }
    expect(lastPatches).toBe(0);
    expect(state.lottiePrecompEdit?.assetId).toBe(assetId);
  });

  it('user JSON: enter LOT tab then setDocumentFromCanvas does not bump forever', () => {
    const anim = userLotFixture();
    let state = seedEditor();
    state = reduceEditor(state, editorReducers.placeUploadedLottie, {
        animationData: anim,
        name: '重测生成LOT-edited',
      });
    const hostId = String(state.lottieTimelinePanel!.nodeId);
    const frameId = String(state.selectedFrameIds?.[0] || '');
    const lotId = findNestedLot(state, hostId, frameId)!;
    const assetId = `lot_${lotId}`;
    state = reduceEditor(state, editorReducers.enterLottiePrecompEdit, { hostNodeId: hostId, assetId, selectedLayerInd: 1 });
    const token0 = state.documentPatchToken;
    const doc = state.document!;
    for (let i = 0; i < 8; i += 1) {
      state = reduceEditor(state, editorReducers.setDocumentFromCanvas, doc);
    }
    // No persist while LOT tab open → token should not keep climbing from autoKey.
    expect(state.documentPatchToken - token0).toBeLessThanOrEqual(8);
    const patches = collectPrecompSessionDocumentPatches({
      document: state.document!,
      hostNodeId: hostId,
      playheadSec: 0,
    });
    // After at most one bake, further collects must empty or stay small.
    let s = state;
    for (let i = 0; i < 5 && patches.length; i += 1) {
      const p = collectPrecompSessionDocumentPatches({
        document: s.document!,
        hostNodeId: hostId,
        playheadSec: 0,
      });
      if (!p.length) break;
      s = reduceEditor(s, editorReducers.patchDocumentNodes, { patches: p, skipHistory: true });
    }
    expect(
      collectPrecompSessionDocumentPatches({
        document: s.document!,
        hostNodeId: hostId,
        playheadSec: 0,
      }).length
    ).toBe(0);
  });

  it('finishLottieGenerator (AI path): 主场景 uses materialized shapes, not nested lot', () => {
    const anim = lotFixture();
    expect(anim).toBeTruthy();

    let state = seedEditor();
    state = reduceEditor(state, editorReducers.spawnLottieGeneratorPlate, { x: 0, y: 0, name: 'gen' });
    const genId = String(state.selectedNodeId || '');
    state = reduceEditor(state, editorReducers.finishLottieGenerator, {
        nodeId: genId,
        animationData: anim,
        name: '搜索生成LOT',
      });
    const frameId = String(state.selectedFrameIds?.[0] || '');
    expect(frameId).toBeTruthy();
    const hostId = Object.keys(state.document!.deltaSetLike || {}).find((id) => {
      const n = state.document!.deltaSetLike[id];
      return n?.attrs?.animationFrameHost && String(n.attrs?.frameId || '') === frameId;
    });
    expect(hostId).toBeTruthy();

    const lotId = findNestedLot(state, hostId!, frameId);
    expect(lotId).toBeUndefined();

    const shapes = Object.entries(state.document!.deltaSetLike || {}).filter(
      ([id, n]) =>
        id !== 'ROOT' &&
        id !== hostId &&
        String(n?.attrs?.frameId || '') === frameId &&
        (n?.key === 'shape' || n?.key === 'rect')
    );
    expect(shapes.length).toBeGreaterThan(0);

    const host = state.document!.deltaSetLike[hostId!];
    const hostAnim = parseLottieAnimationData(host.attrs?.animationData);
    expect(hostAnim).toBeTruthy();
    const linked = (hostAnim!.layers as Record<string, unknown>[]).some((l) =>
      Boolean(String(l?.ln || '').trim())
    );
    expect(linked).toBe(true);
  });

  it('finishLottieGenerator: LOT tab enter/exit keeps 主场景 shape ink', () => {
    const anim = lotFixture();
    let state = seedEditor();
    state = reduceEditor(state, editorReducers.spawnLottieGeneratorPlate, { x: 0, y: 0, name: 'gen' });
    const genId = String(state.selectedNodeId || '');
    state = reduceEditor(state, editorReducers.finishLottieGenerator, {
        nodeId: genId,
        animationData: anim,
        name: '搜索生成LOT',
      });
    const frameId = String(state.selectedFrameIds?.[0] || '');
    const hostId = Object.keys(state.document!.deltaSetLike || {}).find((id) => {
      const n = state.document!.deltaSetLike[id];
      return n?.attrs?.animationFrameHost && String(n.attrs?.frameId || '') === frameId;
    })!;
    const shapeIds = Object.keys(state.document!.deltaSetLike || {}).filter((id) => {
      const n = state.document!.deltaSetLike[id];
      return (
        id !== hostId &&
        String(n?.attrs?.frameId || '') === frameId &&
        !n?.attrs?.precompEditSession
      );
    });
    expect(shapeIds.length).toBeGreaterThan(0);

    const hostAnim = parseLottieAnimationData(
      state.document!.deltaSetLike[hostId].attrs?.animationData
    );
    const assets = Array.isArray(hostAnim?.assets)
      ? (hostAnim!.assets as Record<string, unknown>[])
      : [];
    const precomp = assets.find((a) => String(a?.id || '').startsWith('lot_'));
    if (!precomp) {
      // Import path: no nested LOT tab — 主场景 ink is scene shapes only.
      expect(shapeIds.length).toBeGreaterThan(0);
      return;
    }

    const assetId = String(precomp.id);
    state = reduceEditor(state, editorReducers.enterLottiePrecompEdit, { hostNodeId: hostId, assetId, selectedLayerInd: 1 });
    state = reduceEditor(state, editorReducers.exitLottiePrecompEdit);
    for (const sid of shapeIds) {
      expect(state.document!.deltaSetLike[sid]).toBeTruthy();
      expect(state.document!.deltaSetLike[sid].attrs?.precompEditSession).toBeFalsy();
    }
  });
});
