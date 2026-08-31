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
import editorReducer, {
  createTemplate,
  enterLottiePrecompEdit,
  ensureAnimationFrameMedia,
  exitLottiePrecompEdit,
  finishLottieGenerator,
  patchDocumentNodes,
  placeUploadedLottie,
  spawnLottieGeneratorPlate,
} from '@/store/modules/editor';
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
  let state = editorReducer(undefined, { type: '@@INIT' } as any);
  state = editorReducer(
    state,
    createTemplate({
      name: 'main-scene-lot',
      document: createEmptyDocument({ emptyWorld: true }),
      emptyWorld: true,
      source: 'scratch',
    })
  );
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
  it('placeUploadedLottie: 主场景 preview ready before and after LOT tab exit', () => {
    const anim = lotFixture();
    expect(anim).toBeTruthy();

    let state = seedEditor();
    state = editorReducer(
      state,
      placeUploadedLottie({
        animationData: anim,
        name: '搜索生成LOT-edited',
      })
    );
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

    state = editorReducer(
      state,
      enterLottiePrecompEdit({ hostNodeId: hostId, assetId: `lot_${lotId}`, selectedLayerInd: 1 })
    );
    expect(state.lottiePrecompEdit?.sessionNodeIds?.length).toBeGreaterThan(0);
    // Structurally still in document; overlay hides lot ink during LOT tab.
    expect(state.document!.deltaSetLike![lotId].attrs?.hidden).toBeFalsy();

    state = editorReducer(state, exitLottiePrecompEdit());
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
    expect(String(lotNode.attrs?.animationData || '')).toBe(lotJson);
  });

  it('LOT tab round-trip preserves session shape edits in host JSON', () => {
    const anim = lotFixture();
    let state = seedEditor();
    state = editorReducer(
      state,
      placeUploadedLottie({
        animationData: anim,
        name: '搜索生成LOT-edited',
      })
    );
    const frameId = String(state.selectedFrameIds?.[0] || '');
    const hostId = String(state.lottieTimelinePanel!.nodeId);
    const lotId = findNestedLot(state, hostId, frameId)!;
    const assetId = `lot_${lotId}`;

    state = editorReducer(
      state,
      enterLottiePrecompEdit({ hostNodeId: hostId, assetId, selectedLayerInd: 1 })
    );
    const sessionId = state.lottiePrecompEdit?.sessionNodeIds?.[0];
    expect(sessionId).toBeTruthy();
    const widthBefore = Number(state.document!.deltaSetLike[sessionId!].width);
    expect(widthBefore).toBeGreaterThan(0);

    state = editorReducer(
      state,
      patchDocumentNodes({
        patches: [
          {
            nodeId: sessionId!,
            patch: { width: 180, height: 180, x: 140, y: 140 },
          },
        ],
      })
    );

    state = editorReducer(state, exitLottiePrecompEdit());
    expect(state.lottiePrecompEdit).toBeNull();
    expect(isMainSceneLotPreviewReady(state.document!, lotId)).toBe(true);

    const hostJsonAfterExit = extractPrecompAssetJson(
      state.document!.deltaSetLike[hostId].attrs?.animationData,
      assetId
    );
    expect(hostJsonAfterExit).toBeTruthy();
    const hostLayer = (
      parseLottieAnimationData(hostJsonAfterExit)!.layers as Record<string, unknown>[]
    )[0];
    const hostShape = (
      (hostLayer.shapes as Record<string, unknown>[]) || []
    ).find((s) => s?.ty === 'rc' || s?.ty === 'el');
    const hostSize = (hostShape?.s as { k?: number[] })?.k || [];
    expect(Number(hostSize[0])).toBeGreaterThan(0);

    state = editorReducer(
      state,
      enterLottiePrecompEdit({ hostNodeId: hostId, assetId, selectedLayerInd: 1 })
    );
    const sessionAgain = state.lottiePrecompEdit?.sessionNodeIds?.[0];
    expect(sessionAgain).toBeTruthy();
    const widthAgain = Number(state.document!.deltaSetLike[sessionAgain!].width);
    expect(widthAgain).toBeGreaterThan(widthBefore);
    expect(widthAgain).not.toBe(widthBefore);
  });

  it('user JSON: tab switch keeps 主场景 preview + persists edits through ensureAnimationFrameMedia', () => {
    const anim = userLotFixture();
    expect(anim).toBeTruthy();
    let state = seedEditor();
    state = editorReducer(
      state,
      placeUploadedLottie({
        animationData: anim,
        name: '重测生成LOT-edited',
      })
    );
    const frameId = String(state.selectedFrameIds?.[0] || '');
    const hostId = String(state.lottieTimelinePanel!.nodeId);
    const lotId = findNestedLot(state, hostId, frameId)!;
    expect(lotId).toBeTruthy();
    expect(isMainSceneLotPreviewReady(state.document!, lotId)).toBe(true);

    const assetId = `lot_${lotId}`;
    state = editorReducer(
      state,
      enterLottiePrecompEdit({ hostNodeId: hostId, assetId, selectedLayerInd: 1 })
    );
    expect(state.lottiePrecompEdit?.sessionNodeIds?.length).toBeGreaterThan(0);
    expect(isNodeStructurallyHiddenInDocument(state.document, state.document!.deltaSetLike[lotId])).toBe(
      false
    );
    expect(isHiddenByLottiePrecompEditFocus(lotId, state.document!.deltaSetLike[lotId])).toBe(false);

    const sessionId = state.lottiePrecompEdit!.sessionNodeIds![0];
    const widthBefore = Number(state.document!.deltaSetLike[sessionId].width);
    state = editorReducer(
      state,
      patchDocumentNodes({
        patches: [{ nodeId: sessionId, patch: { width: widthBefore + 40, height: widthBefore + 40 } }],
      })
    );
    // Dock effect re-glues host while LOT tab is open — must not wipe edits.
    state = editorReducer(state, ensureAnimationFrameMedia({ frameId, skipHistory: true }));

    state = editorReducer(state, exitLottiePrecompEdit());
    expect(state.lottiePrecompEdit).toBeNull();
    expect(isMainSceneLotPreviewReady(state.document!, lotId)).toBe(true);
    expect(isNodeStructurallyHiddenInDocument(state.document, state.document!.deltaSetLike[lotId])).toBe(
      false
    );

    state = editorReducer(
      state,
      enterLottiePrecompEdit({ hostNodeId: hostId, assetId, selectedLayerInd: 1 })
    );
    const again = state.lottiePrecompEdit?.sessionNodeIds?.[0];
    expect(again).toBeTruthy();
    expect(Number(state.document!.deltaSetLike[again!].width)).toBeGreaterThan(widthBefore);
  });

  it('finishLottieGenerator (AI path): 主场景 uses materialized shapes, not nested lot', () => {
    const anim = lotFixture();
    expect(anim).toBeTruthy();

    let state = seedEditor();
    state = editorReducer(state, spawnLottieGeneratorPlate({ x: 0, y: 0, name: 'gen' }));
    const genId = String(state.selectedNodeId || '');
    state = editorReducer(
      state,
      finishLottieGenerator({
        nodeId: genId,
        animationData: anim,
        name: '搜索生成LOT',
      })
    );
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
    state = editorReducer(state, spawnLottieGeneratorPlate({ x: 0, y: 0, name: 'gen' }));
    const genId = String(state.selectedNodeId || '');
    state = editorReducer(
      state,
      finishLottieGenerator({
        nodeId: genId,
        animationData: anim,
        name: '搜索生成LOT',
      })
    );
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
    state = editorReducer(
      state,
      enterLottiePrecompEdit({ hostNodeId: hostId, assetId, selectedLayerInd: 1 })
    );
    state = editorReducer(state, exitLottiePrecompEdit());
    for (const sid of shapeIds) {
      expect(state.document!.deltaSetLike[sid]).toBeTruthy();
      expect(state.document!.deltaSetLike[sid].attrs?.precompEditSession).toBeFalsy();
    }
  });
});
