/**
 * Diagnostic: dump LOT / host / session state across tab enter.
 * Fails if enter hides lot ink while leaving non-materialized layers behind.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setAnimationWorkbenchTimelineFocus } from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';
import { setLottiePrecompEditFocus } from '@/components/editor/nodes/AnimationNode/animationPrecompEditFocus';
import { parseLottieAnimationData } from '@/components/rcb/scene/document/nodeFactories';
import {
  editorReducers,
  reduceEditor,
  createTemplate,
} from '@/store/modules/editor';
import { createEmptyDocument } from '@/components/rcb/scene/document/sceneDocument';
import { extractPrecompAssetJson } from '@/components/editor/nodes/AnimationNode/animationPrecompEditModel';
import { isMainSceneLotPreviewReady } from '@/components/editor/nodes/AnimationNode/mainSceneLotPreview';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

afterEach(() => {
  setAnimationWorkbenchTimelineFocus(null);
  setLottiePrecompEditFocus({ active: false });
});

function seedEditor() {
  let state = reduceEditor(undefined, () => {});
  state = reduceEditor(state, editorReducers.createTemplate, {
    name: 'tab-compare',
    document: createEmptyDocument({ emptyWorld: true }),
    emptyWorld: true,
    source: 'scratch',
  });
  return state;
}

function findNestedLot(state: any, hostId: string, frameId: string) {
  return Object.keys(state.document!.deltaSetLike || {}).find((id: string) => {
    const n = state.document!.deltaSetLike[id];
    return (
      id !== hostId &&
      n?.key === 'lottie' &&
      String(n.attrs?.frameId || '') === frameId &&
      !n.attrs?.animationFrameHost
    );
  });
}

function layerStats(anim: Record<string, unknown> | null | undefined) {
  const layers = Array.isArray(anim?.layers) ? (anim!.layers as any[]) : [];
  let shape = 0;
  let rectLike = 0;
  let other = 0;
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    const ty = Number(layer.ty);
    if (ty === 4) {
      shape += 1;
      const shapes = Array.isArray(layer.shapes) ? layer.shapes : [];
      const hasRect = shapes.some(
        (s: any) =>
          s &&
          (s.ty === 'rc' ||
            s.ty === 'el' ||
            (Array.isArray(s.it) &&
              s.it.some((it: any) => it && (it.ty === 'rc' || it.ty === 'el'))))
      );
      if (hasRect) rectLike += 1;
      else other += 1;
    } else {
      other += 1;
    }
  }
  return { total: layers.length, shape, rectLike, other };
}

function snap(state: any, lotId: string, hostId: string, assetId: string) {
  const doc = state.document!;
  const frameId = String(state.selectedFrameIds?.[0] || doc.activeFrameId || '');
  const frame = (doc.frames || []).find((f: any) => String(f?.id) === frameId);
  const lot = doc.deltaSetLike[lotId];
  const host = doc.deltaSetLike[hostId];
  const lotAnim = parseLottieAnimationData(lot?.attrs?.animationData);
  const hostAsset = extractPrecompAssetJson(host?.attrs?.animationData, assetId);
  const hostAssetAnim = hostAsset ? parseLottieAnimationData(hostAsset) : null;
  const sessionIds = (state.lottiePrecompEdit?.sessionNodeIds || []) as string[];
  const sessionNodes = sessionIds.map((id) => {
    const n = doc.deltaSetLike[id];
    return {
      id,
      key: n?.key,
      x: n?.x,
      y: n?.y,
      w: n?.width,
      h: n?.height,
      fill: n?.attrs?.['fill-color'],
      shapeType: n?.attrs?.shapeType,
      hidden: n?.attrs?.hidden,
    };
  });
  return {
    frame: frame
      ? { x: frame.x, y: frame.y, w: frame.width, h: frame.height }
      : null,
    host: host
      ? { x: host.x, y: host.y, w: host.width, h: host.height }
      : null,
    lot: lot
      ? {
          x: lot.x,
          y: lot.y,
          w: lot.width,
          h: lot.height,
          hasJson: Boolean(String(lot.attrs?.animationData || '').trim()),
          jsonLen: String(lot.attrs?.animationData || '').length,
          layers: layerStats(lotAnim),
        }
      : null,
    hostAssetLayers: layerStats(hostAssetAnim),
    sessionCount: sessionIds.length,
    sessionNodes,
    previewReady: isMainSceneLotPreviewReady(doc, lotId),
    precompActive: Boolean(state.lottiePrecompEdit),
  };
}

describe('precomp tab data compare', () => {
  const fixtureFiles = readdirSync(FIXTURES).filter((f) => f.endsWith('.json'));

  it.each(fixtureFiles)('fixture %s: enter must not hide ink with partial materialize', (file) => {
    const anim = parseLottieAnimationData(readFileSync(join(FIXTURES, file), 'utf8'));
    expect(anim).toBeTruthy();
    const statsBeforePlace = layerStats(anim!);
    // Skip tiny fixtures with no layers.
    if (statsBeforePlace.total === 0) return;

    let state = seedEditor();
    state = reduceEditor(state, editorReducers.placeUploadedLottie, {
      animationData: anim,
      name: file,
      x: 480,
      y: 320,
      width: 418,
      height: 418,
    });
    const frameId = String(state.selectedFrameIds?.[0] || '');
    const hostId = String(state.lottieTimelinePanel!.nodeId);
    const lotId = findNestedLot(state, hostId, frameId)!;
    expect(lotId).toBeTruthy();
    const assetId = `lot_${lotId}`;

    const before = snap(state, lotId, hostId, assetId);
    expect(before.lot?.hasJson).toBe(true);
    expect(before.previewReady).toBe(true);

    state = reduceEditor(state, editorReducers.enterLottiePrecompEdit, {
      hostNodeId: hostId,
      assetId,
      selectedLayerInd: 1,
    });
    const during = snap(state, lotId, hostId, assetId);

    // Core invariant: if LOT has non-rect layers, we must not claim a full
    // session materialize that hides lottie-web ink (blank LOT tab).
    const nonRect = before.lot!.layers.other;
    if (nonRect > 0) {
      expect(state.lottiePrecompEdit?.sessionHidesLotInk ?? false).toBe(false);
    }

    // Lot JSON must survive enter.
    expect(during.lot?.hasJson).toBe(true);
    expect(during.lot!.jsonLen).toBeGreaterThan(10);
    expect(during.lot!.layers.total).toBe(before.lot!.layers.total);

    state = reduceEditor(state, editorReducers.exitLottiePrecompEdit);
    const after = snap(state, lotId, hostId, assetId);
    expect(after.previewReady).toBe(true);
    expect(after.lot?.hasJson).toBe(true);
    expect(after.lot!.layers.total).toBe(before.lot!.layers.total);
    expect(after.frame).toEqual(before.frame);
  });

  it('simple rect LOT: exit preserves animated position keys', () => {
    const anim = parseLottieAnimationData(
      readFileSync(join(FIXTURES, 'retake-lot-edited.json'), 'utf8')
    );
    let state = seedEditor();
    state = reduceEditor(state, editorReducers.placeUploadedLottie, {
      animationData: anim,
      name: 'rect',
      x: 100,
      y: 100,
      width: 285,
      height: 285,
    });
    const frameId = String(state.selectedFrameIds?.[0] || '');
    const hostId = String(state.lottieTimelinePanel!.nodeId);
    const lotId = findNestedLot(state, hostId, frameId)!;
    const assetId = `lot_${lotId}`;
    const before = parseLottieAnimationData(
      state.document!.deltaSetLike[lotId].attrs!.animationData as string
    )!;
    const beforeKeys = (before.layers as any[])[0].ks.p.k.length;

    state = reduceEditor(state, editorReducers.enterLottiePrecompEdit, {
      hostNodeId: hostId,
      assetId,
      selectedLayerInd: 1,
    });
    expect(state.lottiePrecompEdit?.sessionHidesLotInk).toBe(true);

    state = reduceEditor(state, editorReducers.exitLottiePrecompEdit);
    const after = parseLottieAnimationData(
      state.document!.deltaSetLike[lotId].attrs!.animationData as string
    )!;
    expect((after.layers as any[])[0].ks.p.a).toBe(1);
    expect((after.layers as any[])[0].ks.p.k.length).toBe(beforeKeys);
  });
});
