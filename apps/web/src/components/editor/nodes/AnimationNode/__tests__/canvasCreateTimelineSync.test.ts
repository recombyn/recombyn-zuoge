/**
 * Drawing on an open 动画工作台 must bake the new child into timeline layers
 * via setDocumentFromCanvas (shape create path does not use patchDocumentNode).
 */
import { afterEach, describe, expect, it } from 'vitest';
import reducer, {
  createTemplate,
  ensureAnimationFrameMedia,
  openLottieTimelinePanel,
  setDocumentFromCanvas,
  spawnAnimationBoard,
} from '@/store/modules/editor';
import { createEmptyDocument, addNodeToDocument } from '@/components/rcb/scene/document/sceneDocument';
import {
  createShapeNode,
  parseLottieAnimationData,
} from '@/components/rcb/scene/document/nodeFactories';
import {
  getAnimationWorkbenchTimelineFocus,
  setAnimationWorkbenchTimelineFocus,
} from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';
import { findFrameAnimationMediaId } from '@/components/editor/nodes/AnimationNode/resolveAnimationFrameId';
import { RCB_ENSURE_ANIMATION_FRAME } from '@/components/editor/sceneEvents';

afterEach(() => {
  setAnimationWorkbenchTimelineFocus(null);
});

function seed() {
  let state = reducer(undefined, { type: '@@INIT' } as any);
  state = reducer(
    state,
    createTemplate({
      name: 'canvas-create-timeline',
      document: createEmptyDocument({ emptyWorld: true }),
      emptyWorld: true,
      source: 'scratch',
    })
  );
  return state;
}

function flushEnsureMicrotask(): Promise<void> {
  return Promise.resolve();
}

describe('canvas create → animation timeline layers', () => {
  it('setDocumentFromCanvas while timeline focused queues ensure and bakes the shape', async () => {
    let state = seed();
    state = reducer(state, spawnAnimationBoard({ x: 0, y: 0, width: 400, height: 400 }));
    const frameId = String(state.selectedFrameIds[0] || '');
    expect(frameId).toBeTruthy();

    state = reducer(state, ensureAnimationFrameMedia({ frameId, skipHistory: true }));
    const hostId = findFrameAnimationMediaId(state.document, frameId);
    expect(hostId).toBeTruthy();

    state = reducer(state, openLottieTimelinePanel({ nodeId: hostId! }));
    expect(getAnimationWorkbenchTimelineFocus()).toBe(frameId);

    const before = parseLottieAnimationData(
      state.document!.deltaSetLike![hostId!].attrs?.animationData
    );
    const beforeCount = Array.isArray(before?.layers) ? before!.layers.length : 0;

    const queued: string[] = [];
    const onEnsure = (e: Event) => {
      queued.push(
        String((e as CustomEvent<{ frameId?: string }>).detail?.frameId || '')
      );
    };
    window.addEventListener(RCB_ENSURE_ANIMATION_FRAME, onEnsure);

    const { id, node } = createShapeNode({
      x: 40,
      y: 40,
      width: 80,
      height: 60,
      shapeType: 'rect',
      fill: '#FFFFFF',
    });
    node.attrs = {
      ...(node.attrs || {}),
      frameId,
      frameOrder: 1,
      name: 'new-on-workbench',
    };
    const nextDoc = addNodeToDocument(state.document!, id, node);
    state = reducer(state, setDocumentFromCanvas(nextDoc));

    await flushEnsureMicrotask();
    window.removeEventListener(RCB_ENSURE_ANIMATION_FRAME, onEnsure);
    expect(queued).toContain(frameId);

    // Same as AnimationFrameWorkbenchHost listener.
    state = reducer(state, ensureAnimationFrameMedia({ frameId, skipHistory: true }));

    const after = parseLottieAnimationData(
      state.document!.deltaSetLike![hostId!].attrs?.animationData
    );
    const layers = (after?.layers as any[]) || [];
    expect(layers.length).toBeGreaterThan(beforeCount);
    expect(layers.some((l) => String(l.ln) === id || String(l.nm) === 'new-on-workbench')).toBe(
      true
    );
    expect(Number(state.document!.deltaSetLike![id].attrs?.lottieLayerInd)).toBeGreaterThan(0);
  });
});
