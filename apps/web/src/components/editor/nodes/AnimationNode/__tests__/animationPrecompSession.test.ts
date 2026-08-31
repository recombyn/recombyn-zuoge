import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyDocument, addNodeToDocument } from '@/components/rcb/scene/document/sceneDocument';
import {
  createLottieNode,
  parseLottieAnimationData,
  serializeLottieAnimationData,
} from '@/components/rcb/scene/document/nodeFactories';
import {
  beginPrecompEditSession,
  endPrecompEditSession,
  PRECOMP_EDIT_SESSION_ATTR,
} from '../animationPrecompSession';
import {
  editorReducers,
  reduceEditor,
  createTemplate,
  enterLottiePrecompEdit,
  exitLottiePrecompEdit,
  placeUploadedLottie,
} from '@/store/modules/editor';
import {
  setAnimationWorkbenchPlayheadSec,
  setAnimationWorkbenchTimelineFocus,
} from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';
import {
  getLottiePrecompEditFocus,
  isHiddenByLottiePrecompEditFocus,
  setLottiePrecompEditFocus,
} from '@/components/editor/nodes/AnimationNode/animationPrecompEditFocus';
import {
  isNodeOverlayHidden,
  isNodeStructurallyHiddenInDocument,
} from '@/components/rcb/scene/document/nodeCapabilities';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

afterEach(() => {
  setAnimationWorkbenchTimelineFocus(null);
  setAnimationWorkbenchPlayheadSec(0);
  setLottiePrecompEditFocus({ active: false });
});

function seedEditor() {
  setAnimationWorkbenchTimelineFocus(null);
  setAnimationWorkbenchPlayheadSec(0);
  let state = reduceEditor(undefined, () => {});
  state = reduceEditor(state, editorReducers.createTemplate, {
      name: 'precomp-session',
      document: createEmptyDocument({ emptyWorld: true }),
      emptyWorld: true,
      source: 'scratch',
    });
  return state;
}
function seedDocWithNestedLot() {
  const raw = readFileSync(join(FIXTURES, 'retake-lot-edited.json'), 'utf8');
  const anim = parseLottieAnimationData(raw);
  expect(anim).toBeTruthy();

  let doc = createEmptyDocument({ emptyWorld: true });
  (doc as any).frames = [
    {
      id: 'af1',
      kind: 'animation',
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      backgroundColor: '#fff',
      clipContent: true,
    },
  ];

  const { id: hostId, node: hostNode } = createLottieNode({
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    name: 'host',
    animationData: {
      v: '5.7.4',
      fr: 30,
      ip: 0,
      op: 150,
      w: 800,
      h: 600,
      layers: [
        {
          ind: 1,
          ty: 0,
          nm: '直接生成LOT-edited',
          refId: 'lot_plate1',
          ln: 'plate1',
          ip: 0,
          op: 150,
          ks: {},
        },
      ],
      assets: [
        {
          id: 'lot_plate1',
          nm: '直接生成LOT-edited',
          w: Number(anim!.w) || 240,
          h: Number(anim!.h) || 240,
          layers: (anim as any).layers,
        },
      ],
    },
  });
  hostNode.attrs = {
    ...(hostNode.attrs || {}),
    frameId: 'af1',
    animationFrameHost: true,
  };
  doc = addNodeToDocument(doc, hostId, hostNode);

  const { id: lotId, node: lotNode } = createLottieNode({
    x: 100,
    y: 80,
    width: 240,
    height: 240,
    name: '直接生成LOT-edited',
    animationData: anim,
  });
  lotNode.attrs = { ...(lotNode.attrs || {}), frameId: 'af1' };
  doc = addNodeToDocument(doc, lotId, lotNode);

  const hostAnim = parseLottieAnimationData(doc.deltaSetLike![hostId].attrs?.animationData)!;
  (hostAnim.assets as any[])[0].id = `lot_${lotId}`;
  (hostAnim.layers as any[])[0].refId = `lot_${lotId}`;
  (hostAnim.layers as any[])[0].ln = lotId;
  doc.deltaSetLike![hostId] = {
    ...doc.deltaSetLike![hostId],
    attrs: {
      ...doc.deltaSetLike![hostId].attrs,
      animationData: serializeLottieAnimationData(hostAnim),
    },
  };
  return { doc, hostId, lotId, assetId: `lot_${lotId}` };
}

describe('animationPrecompSession', () => {
  it('resizes workbench to lot plate and materializes editable shapes on enter', () => {
    const { doc, hostId, lotId, assetId } = seedDocWithNestedLot();

    const begun = beginPrecompEditSession({
      document: doc,
      hostNodeId: hostId,
      assetId,
    });
    expect(begun).toBeTruthy();
    expect(begun!.frameSnapshot).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    const frame = begun!.document.frames!.find((f) => f.id === 'af1')!;
    expect(frame.x).toBe(100);
    expect(frame.y).toBe(80);
    expect(frame.width).toBe(240);
    expect(frame.height).toBe(240);
    expect(begun!.sessionNodeIds.length).toBeGreaterThan(0);
    const shape = begun!.document.deltaSetLike![begun!.sessionNodeIds[0]];
    expect(shape.attrs?.[PRECOMP_EDIT_SESSION_ATTR]).toBe(assetId);
    expect(begun!.document.deltaSetLike![lotId].attrs?.hidden).toBeFalsy();

    const ended = endPrecompEditSession({
      document: begun!.document,
      hostNodeId: hostId,
      assetId,
      frameId: begun!.frameId,
      frameSnapshot: begun!.frameSnapshot,
      lotNodeId: lotId,
      sessionNodeIds: begun!.sessionNodeIds,
    });
    const restored = ended.frames!.find((f) => f.id === 'af1')!;
    expect(restored.width).toBe(800);
    expect(restored.height).toBe(600);
    expect(ended.deltaSetLike![begun!.sessionNodeIds[0]]).toBeUndefined();
    expect(ended.deltaSetLike![lotId].attrs?.hidden).toBe(false);
  });

  it('writes session shape edits back to lot animationData on exit', () => {
    const { doc, hostId, lotId, assetId } = seedDocWithNestedLot();
    const origLotAnim = parseLottieAnimationData(doc.deltaSetLike![lotId].attrs?.animationData);
    const origLayer = (origLotAnim!.layers as Record<string, unknown>[])[0];
    const origK0 = (
      (origLayer!.ks as { p?: { k?: { t?: number; s?: number[] }[] } })?.p?.k || []
    ).find((kf) => Number(kf?.t) === 0);

    const begun = beginPrecompEditSession({
      document: doc,
      hostNodeId: hostId,
      assetId,
    });
    expect(begun?.sessionNodeIds.length).toBeGreaterThan(0);
    const shapeId = begun!.sessionNodeIds[0];
    const before = begun!.document.deltaSetLike![shapeId];
    const moved = {
      ...begun!.document,
      deltaSetLike: {
        ...begun!.document.deltaSetLike,
        [shapeId]: {
          ...before,
          x: Number(before.x) + 42,
          y: Number(before.y) + 18,
        },
      },
    };

    const ended = endPrecompEditSession({
      document: moved,
      hostNodeId: hostId,
      assetId,
      frameId: begun!.frameId,
      frameSnapshot: begun!.frameSnapshot,
      lotNodeId: lotId,
      sessionNodeIds: begun!.sessionNodeIds,
      playheadSec: 0,
    });

    const lotAnim = parseLottieAnimationData(ended.deltaSetLike![lotId].attrs?.animationData);
    const lotLayer = (lotAnim!.layers as Record<string, unknown>[])[0];
    const pProp = (lotLayer!.ks as { p?: { k?: unknown[] } })?.p;
    expect(pProp?.k).toBeTruthy();
    const k0 = (pProp!.k as { t?: number; s?: number[] }[]).find((kf) => Number(kf?.t) === 0);
    expect(k0?.s?.[0]).toBeDefined();
    expect(Math.abs(Number(k0!.s![0]) - Number(origK0!.s![0]))).toBeGreaterThan(5);
  });

  it('materializes at the current playhead so LOT tab matches main-scene preview', () => {
    const { doc, hostId, assetId } = seedDocWithNestedLot();
    const atZero = beginPrecompEditSession({
      document: doc,
      hostNodeId: hostId,
      assetId,
      playheadSec: 0,
    });
    const atMid = beginPrecompEditSession({
      document: doc,
      hostNodeId: hostId,
      assetId,
      playheadSec: 0.4,
    });
    expect(atZero?.sessionNodeIds.length).toBeGreaterThan(0);
    expect(atMid?.sessionNodeIds.length).toBeGreaterThan(0);
    const y0 = Number(atZero!.document.deltaSetLike![atZero!.sessionNodeIds[0]].y);
    const yMid = Number(atMid!.document.deltaSetLike![atMid!.sessionNodeIds[0]].y);
    expect(Number.isFinite(y0)).toBe(true);
    expect(Number.isFinite(yMid)).toBe(true);
    expect(Math.abs(yMid - y0)).toBeGreaterThan(1);
  });

  it('materializes even when lot JSON still has stale ln from a prior session', () => {
    const { doc, hostId, lotId, assetId } = seedDocWithNestedLot();
    const lotAnim = parseLottieAnimationData(doc.deltaSetLike![lotId].attrs?.animationData)!;
    (lotAnim.layers as Record<string, unknown>[])[0].ln = 'deleted_session_shape';
    doc.deltaSetLike![lotId] = {
      ...doc.deltaSetLike![lotId],
      attrs: {
        ...doc.deltaSetLike![lotId].attrs,
        animationData: serializeLottieAnimationData(lotAnim),
      },
    };

    const begun = beginPrecompEditSession({
      document: doc,
      hostNodeId: hostId,
      assetId,
    });
    expect(begun?.sessionNodeIds.length).toBeGreaterThan(0);
    expect(begun!.document.deltaSetLike![lotId].attrs?.hidden).toBeFalsy();
  });

  it('preserves host precomp keyframes written back to lot on exit', () => {
    const { doc, hostId, lotId, assetId } = seedDocWithNestedLot();
    const begun = beginPrecompEditSession({
      document: doc,
      hostNodeId: hostId,
      assetId,
    });
    expect(begun?.sessionNodeIds.length).toBeGreaterThan(0);

    const hostAnim = parseLottieAnimationData(
      begun!.document.deltaSetLike![hostId].attrs?.animationData
    )!;
    const assets = hostAnim.assets as Record<string, unknown>[];
    const assetIdx = assets.findIndex((a) => String(a?.id || '') === assetId);
    const asset = { ...(assets[assetIdx] as Record<string, unknown>) };
    const layers = [...((asset.layers as Record<string, unknown>[]) || [])];
    const layer = { ...(layers[0] as Record<string, unknown>) };
    const ks = { ...((layer.ks as Record<string, unknown>) || {}) };
    ks.p = {
      a: 1,
      k: [
        { t: 0, s: [120, 120, 0] },
        { t: 30, s: [120, 60, 0] },
      ],
    };
    layer.ks = ks;
    layers[0] = layer;
    asset.layers = layers;
    assets[assetIdx] = asset;
    const editedHost = { ...hostAnim, assets };
    const editedDoc = {
      ...begun!.document,
      deltaSetLike: {
        ...begun!.document.deltaSetLike,
        [hostId]: {
          ...begun!.document.deltaSetLike![hostId],
          attrs: {
            ...begun!.document.deltaSetLike![hostId].attrs,
            animationData: serializeLottieAnimationData(editedHost),
          },
        },
      },
    };

    const ended = endPrecompEditSession({
      document: editedDoc,
      hostNodeId: hostId,
      assetId,
      frameId: begun!.frameId,
      frameSnapshot: begun!.frameSnapshot,
      lotNodeId: lotId,
      sessionNodeIds: begun!.sessionNodeIds,
      playheadSec: 0,
    });

    expect(ended.deltaSetLike![lotId].attrs?.hidden).toBe(false);
    const lotAnim = parseLottieAnimationData(ended.deltaSetLike![lotId].attrs?.animationData);
    const lotLayer = (lotAnim!.layers as Record<string, unknown>[])[0];
    const pProp = (lotLayer!.ks as { p?: { a?: number; k?: unknown[] } })?.p;
    expect(pProp?.a).toBe(1);
    expect(Array.isArray(pProp?.k) && pProp!.k!.length).toBeGreaterThan(1);
  });

  it('reducer enter/exit restores workbench and drops session shapes', () => {
    let state = seedEditor();
    expect(state.document).toBeTruthy();
    const anim = parseLottieAnimationData(
      readFileSync(join(FIXTURES, 'retake-lot-edited.json'), 'utf8')
    );
    expect(anim).toBeTruthy();
    state = reduceEditor(state, editorReducers.placeUploadedLottie, {
        animationData: anim,
        name: '资源生成LOT-edited',
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
    const before = state.document!.frames!.find((f) => String(f.id) === frameId)!;
    const beforeW = Number(before.width);
    const beforeH = Number(before.height);

    const nested = Object.entries(state.document!.deltaSetLike || {}).find(
      ([id, n]) =>
        id !== hostId &&
        n?.key === 'lottie' &&
        String(n.attrs?.frameId || '') === frameId &&
        !n.attrs?.animationFrameHost
    );
    expect(nested).toBeTruthy();
    const [lotId] = nested!;
    const assetId = `lot_${lotId}`;

    setLottiePrecompEditFocus({ active: true, lotNodeId: lotId, sessionMaterialized: true });
    state = reduceEditor(state, editorReducers.enterLottiePrecompEdit, { hostNodeId: hostId!, assetId, selectedLayerInd: 1 });
    expect(state.lottiePrecompEdit?.assetId).toBe(assetId);
    expect(getLottiePrecompEditFocus().active).toBe(true);
    expect(state.lottiePrecompEdit?.sessionNodeIds?.length).toBeGreaterThan(0);
    expect(state.document!.deltaSetLike![lotId].attrs?.hidden).toBeFalsy();
    expect(state.selectedNodeId).toBeNull();
    expect(state.selectedNodeIds).toEqual([]);
    const mid = state.document!.frames!.find((f) => String(f.id) === frameId)!;
    expect(Number(mid.width)).toBe(Number(state.document!.deltaSetLike![lotId].width));
    expect(Number(mid.height)).toBe(Number(state.document!.deltaSetLike![lotId].height));

    state = reduceEditor(state, editorReducers.exitLottiePrecompEdit);
    expect(state.lottiePrecompEdit).toBeNull();
    expect(getLottiePrecompEditFocus().active).toBe(false);
    expect(getLottiePrecompEditFocus().lotNodeId).toBeNull();
    const after = state.document!.frames!.find((f) => String(f.id) === frameId)!;
    expect(Number(after.width)).toBe(beforeW);
    expect(Number(after.height)).toBe(beforeH);
    expect(state.document!.deltaSetLike![lotId].attrs?.hidden).toBeFalsy();
    const lotAnim = parseLottieAnimationData(
      state.document!.deltaSetLike![lotId].attrs?.animationData
    );
    expect(lotAnim).toBeTruthy();
    expect(Array.isArray(lotAnim!.layers) && lotAnim!.layers.length).toBeGreaterThan(0);
  });

  it('after LOT tab exit nested lot is visible for overlay paint (not structurally hidden)', () => {
    let state = seedEditor();
    const anim = parseLottieAnimationData(
      readFileSync(join(FIXTURES, 'retake-lot-edited.json'), 'utf8')
    );
    state = reduceEditor(state, editorReducers.placeUploadedLottie, {
        animationData: anim,
        name: '资源生成LOT-edited',
      });
    const frameId = String(state.selectedFrameIds?.[0] || '');
    const hostId = String(state.lottieTimelinePanel!.nodeId);
    const lotId = Object.keys(state.document!.deltaSetLike || {}).find((id) => {
      const n = state.document!.deltaSetLike[id];
      return (
        id !== hostId &&
        n?.key === 'lottie' &&
        String(n.attrs?.frameId || '') === frameId &&
        !n.attrs?.animationFrameHost
      );
    })!;
    const assetId = `lot_${lotId}`;
    const beforeJson = String(state.document!.deltaSetLike[lotId].attrs?.animationData || '');

    state = reduceEditor(state, editorReducers.enterLottiePrecompEdit, { hostNodeId: hostId, assetId, selectedLayerInd: 1 });
    expect(state.document!.deltaSetLike[lotId].attrs?.hidden).toBeFalsy();
    // Nested lot stays in SVG (mount must survive tab switch); overlay hides ink.
    expect(isHiddenByLottiePrecompEditFocus(lotId, state.document!.deltaSetLike[lotId])).toBe(
      false
    );

    state = reduceEditor(state, editorReducers.exitLottiePrecompEdit);
    const lotNode = state.document!.deltaSetLike[lotId];
    expect(state.lottiePrecompEdit).toBeNull();
    expect(getLottiePrecompEditFocus().active).toBe(false);
    expect(lotNode.attrs?.hidden).toBeFalsy();
    expect(isHiddenByLottiePrecompEditFocus(lotId, lotNode)).toBe(false);
    expect(isNodeStructurallyHiddenInDocument(state.document, lotNode)).toBe(false);
    expect(isNodeOverlayHidden(state.document, lotNode)).toBe(false);
    expect(Number(lotNode.attrs?.lottieInkRevision)).toBeGreaterThan(0);

    const lotAnim = parseLottieAnimationData(lotNode.attrs?.animationData);
    expect(lotAnim).toBeTruthy();
    const layer0 = (lotAnim!.layers as Record<string, unknown>[])[0];
    expect(Number(layer0?.ty)).toBe(4);
    expect(Array.isArray(layer0?.shapes) && (layer0!.shapes as unknown[]).length).toBeGreaterThan(
      0
    );
    expect(String(lotNode.attrs?.animationData || '')).not.toBe(beforeJson);
  });
});
