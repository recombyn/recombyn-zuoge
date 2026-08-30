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
import editorReducer, {
  createTemplate,
  enterLottiePrecompEdit,
  exitLottiePrecompEdit,
  placeUploadedLottie,
} from '@/store/modules/editor';
import {
  setAnimationWorkbenchPlayheadSec,
  setAnimationWorkbenchTimelineFocus,
} from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

afterEach(() => {
  setAnimationWorkbenchTimelineFocus(null);
  setAnimationWorkbenchPlayheadSec(0);
});

function seedEditor() {
  setAnimationWorkbenchTimelineFocus(null);
  setAnimationWorkbenchPlayheadSec(0);
  let state = editorReducer(undefined, { type: '@@INIT' } as any);
  state = editorReducer(
    state,
    createTemplate({
      name: 'precomp-session',
      document: createEmptyDocument({ emptyWorld: true }),
      emptyWorld: true,
      source: 'scratch',
    })
  );
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
    expect(begun!.document.deltaSetLike![lotId].attrs?.hidden).toBe(true);

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

  it('reducer enter/exit restores workbench and drops session shapes', () => {
    let state = seedEditor();
    expect(state.document).toBeTruthy();
    const anim = parseLottieAnimationData(
      readFileSync(join(FIXTURES, 'retake-lot-edited.json'), 'utf8')
    );
    expect(anim).toBeTruthy();
    state = editorReducer(
      state,
      placeUploadedLottie({
        animationData: anim,
        name: '资源生成LOT-edited',
      })
    );
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

    state = editorReducer(
      state,
      enterLottiePrecompEdit({ hostNodeId: hostId!, assetId, selectedLayerInd: 1 })
    );
    expect(state.lottiePrecompEdit?.assetId).toBe(assetId);
    expect(state.lottiePrecompEdit?.sessionNodeIds?.length).toBeGreaterThan(0);
    const mid = state.document!.frames!.find((f) => String(f.id) === frameId)!;
    expect(Number(mid.width)).toBe(Number(state.document!.deltaSetLike![lotId].width));
    expect(Number(mid.height)).toBe(Number(state.document!.deltaSetLike![lotId].height));

    state = editorReducer(state, exitLottiePrecompEdit());
    expect(state.lottiePrecompEdit).toBeNull();
    const after = state.document!.frames!.find((f) => String(f.id) === frameId)!;
    expect(Number(after.width)).toBe(beforeW);
    expect(Number(after.height)).toBe(beforeH);
    expect(state.document!.deltaSetLike![lotId].attrs?.hidden).toBeFalsy();
  });
});
