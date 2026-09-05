/**
 * Repro: Desktop「重测生成LOT-edited.json」— 主场景 OK → LOT → 主场景 blank.
 * Tab switch must keep the same nested-lot Lottie preview (no materialize).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setAnimationWorkbenchTimelineFocus } from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';
import { setLottiePrecompEditFocus } from '@/components/editor/nodes/AnimationNode/animationPrecompEditFocus';
import {
  getMainSceneLotPreviewState,
  isMainSceneLotPreviewReady,
  resolveLottieInkJson,
} from '@/components/editor/nodes/AnimationNode/mainSceneLotPreview';
import { extractPrecompAssetJson } from '@/components/editor/nodes/AnimationNode/animationPrecompEditModel';
import { parseLottieAnimationData } from '@/components/rcb/scene/document/nodeFactories';
import { editorReducers, reduceEditor } from '@/store/modules/editor';
import { createEmptyDocument } from '@/components/rcb/scene/document/sceneDocument';
import { isHiddenByAnimationWorkbenchFocus } from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';
import { isNodeHidden } from '@/components/rcb/scene/document/nodeCapabilities';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

afterEach(() => {
  setAnimationWorkbenchTimelineFocus(null);
  setLottiePrecompEditFocus({ active: false });
});

function seedEditor() {
  let state = reduceEditor(undefined, () => {});
  state = reduceEditor(state, editorReducers.createTemplate, {
    name: 'desktop-lot-blank',
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

describe('desktop LOT main-scene blank after tab switch', () => {
  it('enter→exit keeps same preview JSON + geom (no materialize)', () => {
    const anim = parseLottieAnimationData(
      readFileSync(join(FIXTURES, 'retake-lot-desktop.json'), 'utf8')
    );
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
    setAnimationWorkbenchTimelineFocus(frameId);

    const beforeLot = state.document!.deltaSetLike[lotId];
    const beforeResolved = resolveLottieInkJson(state.document!, lotId, beforeLot, {
      hostFallback: true,
    });
    expect(isMainSceneLotPreviewReady(state.document!, lotId)).toBe(true);
    expect(beforeResolved).toBeTruthy();

    const assetId = `lot_${lotId}`;
    state = reduceEditor(state, editorReducers.enterLottiePrecompEdit, {
      hostNodeId: hostId,
      assetId,
      selectedLayerInd: 1,
    });
    expect(state.lottiePrecompEdit?.assetId).toBe(assetId);
    expect(state.lottiePrecompEdit?.sessionHidesLotInk).toBe(false);
    expect(state.lottiePrecompEdit?.frameSnapshot).toBeUndefined();
    expect((state.lottiePrecompEdit?.sessionNodeIds || []).length).toBe(0);
    // Geom unchanged — same paint path as 主场景.
    expect(Number(state.document!.deltaSetLike[lotId].x)).toBe(Number(beforeLot.x));
    expect(Number(state.document!.deltaSetLike[lotId].y)).toBe(Number(beforeLot.y));

    state = reduceEditor(state, editorReducers.exitLottiePrecompEdit);
    setAnimationWorkbenchTimelineFocus(frameId);

    const afterLot = state.document!.deltaSetLike[lotId];
    const afterResolved = resolveLottieInkJson(state.document!, lotId, afterLot, {
      hostFallback: true,
    });
    expect(state.lottiePrecompEdit).toBeNull();
    expect(isMainSceneLotPreviewReady(state.document!, lotId)).toBe(true);
    expect(afterResolved).toBe(beforeResolved);
    expect(Number(afterLot.x)).toBe(Number(beforeLot.x));
    expect(Number(afterLot.y)).toBe(Number(beforeLot.y));
    expect(isNodeHidden(afterLot)).toBe(false);
    expect(isHiddenByAnimationWorkbenchFocus(afterLot)).toBe(false);
    expect(getMainSceneLotPreviewState(state.document!, lotId)?.hasShapeInk).toBe(true);
    expect(
      extractPrecompAssetJson(state.document!.deltaSetLike[hostId].attrs?.animationData, assetId)
    ).toBeTruthy();
  });
});
