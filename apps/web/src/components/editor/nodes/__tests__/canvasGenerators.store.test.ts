/**
 * Store-level canvas generators + media promote coverage (no browser).
 */
import { describe, expect, it } from 'vitest';
import {
  editorReducers,
  reduceEditor,
  clearImageProcess,
  createTemplate,
  finishAudioGenerator,
  finishImageGenerator,
  finishLottieGenerator,
  finishVideoGenerator,
  patchDocumentNode,
  removeDocumentNodes,
  spawnAudioGenerator,
  spawnImageGenerator,
  spawnAnimationBoard,
  spawnLottieGeneratorPlate,
  spawnVideoGenerator,
} from '@/store/modules/editor';
import { createEmptyDocument, addNodeToDocument } from '@/components/rcb/scene/document/sceneDocument';
import { clearImageProcessAttrs } from '@/components/rcb/scene/document/mediaLifecycle';
import {
  createImageGeneratorNode,
  createVideoGeneratorNode,
  createLottieGeneratorNode,
  createAudioGeneratorNode,
} from '@/components/rcb/scene/document/nodeFactories';

const SAMPLE_LOTTIE = {
  v: '5.7.4',
  fr: 30,
  ip: 0,
  op: 30,
  w: 64,
  h: 64,
  nm: 'dot',
  ddd: 0,
  assets: [],
  layers: [],
};

function seed() {
  let state = reduceEditor(undefined, () => {});
  state = reduceEditor(state, editorReducers.createTemplate, {
      name: 'canvas-generators-store',
      document: createEmptyDocument({ emptyWorld: true }),
      emptyWorld: true,
      source: 'scratch',
    });
  return state;
}

describe('canvas generators (store)', () => {
  it('spawns image/video/lottie/audio generator plates as selected nodes', () => {
    let state = seed();
    const specs = [
      { reducer: editorReducers.spawnImageGenerator, flag: 'imageGenerator' },
      { reducer: editorReducers.spawnVideoGenerator, flag: 'videoGenerator' },
      { reducer: editorReducers.spawnLottieGeneratorPlate, flag: 'lottieGenerator' },
      { reducer: editorReducers.spawnAudioGenerator, flag: 'audioGenerator' },
    ] as const;

    for (let i = 0; i < specs.length; i += 1) {
      const { reducer, flag } = specs[i]!;
      state = reduceEditor(state, reducer, { x: i * 40, y: i * 30, name: flag });
      const id = String(state.selectedNodeId || '');
      expect(id.length).toBeGreaterThan(2);
      const node = state.document!.deltaSetLike[id];
      expect(node).toBeTruthy();
      expect(Boolean((node.attrs as any)?.[flag])).toBe(true);
    }
  });

  it('spawnImageGenerator clears frame selection so generator chrome can mount', () => {
    let state = seed();
    state = reduceEditor(state, editorReducers.spawnAnimationBoard, {
      x: 10,
      y: 20,
      width: 300,
      height: 300,
    });
    expect(state.selectedFrameIds.length).toBe(1);
    state = reduceEditor(state, editorReducers.spawnImageGenerator, { x: 40, y: 40 });
    expect(state.selectedFrameIds).toEqual([]);
    expect(state.document?.activeFrameId).toBeNull();
    expect(String(state.selectedNodeId || '').length).toBeGreaterThan(2);
    const node = state.document!.deltaSetLike[String(state.selectedNodeId)];
    expect(Boolean((node.attrs as any)?.imageGenerator)).toBe(true);
  });

  it('spawnAnimationBoard creates a 动画工作台 artboard', () => {
    let state = seed();
    state = reduceEditor(state, editorReducers.spawnAnimationBoard, { x: 10, y: 20, width: 300, height: 300 });
    expect(state.selectedNodeId).toBeNull();
    expect(state.selectedFrameIds.length).toBe(1);
    const frame = state.document!.frames?.find((f) => f.id === state.selectedFrameIds[0]);
    expect(frame?.kind).toBe('animation');
    expect(frame?.name).toMatch(/动画工作台|Animation/);
  });

  it('spawnAnimationBoard appends the frame at the top of stackOrder', () => {
    let state = seed();
    const nodeId = 'n-top-check';
    state = {
      ...state,
      document: addNodeToDocument(state.document!, nodeId, {
        id: nodeId,
        key: 'shape',
        x: 10,
        y: 10,
        width: 40,
        height: 40,
        attrs: { type: 'rect' },
        children: [],
      }),
    };
    state = reduceEditor(state, editorReducers.spawnAnimationBoard, { x: 0, y: 0, width: 200, height: 200 });
    const frameId = String(state.selectedFrameIds[0] || '');
    const order = (state.document!.stackOrder || []).map(String);
    expect(order[order.length - 1]).toBe(`frame:${frameId}`);
    expect(order.indexOf(`node:${nodeId}`)).toBeLessThan(order.length - 1);
  });

  it('second spawnAnimationBoard is max layer + 1 over the first', () => {
    let state = seed();
    state = reduceEditor(state, editorReducers.spawnAnimationBoard, {
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    });
    const firstId = String(state.selectedFrameIds[0] || '');
    state = reduceEditor(state, editorReducers.spawnAnimationBoard, {
      x: 40,
      y: 40,
      width: 200,
      height: 200,
    });
    const secondId = String(state.selectedFrameIds[0] || '');
    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe(firstId);
    const order = (state.document!.stackOrder || []).map(String);
    expect(order.indexOf(`frame:${firstId}`)).toBeLessThan(order.indexOf(`frame:${secondId}`));
    expect(order[order.length - 1]).toBe(`frame:${secondId}`);
  });

  it('factory helpers produce distinct generator kinds', () => {
    const kinds = [
      createImageGeneratorNode({ x: 0, y: 0 }),
      createVideoGeneratorNode({ x: 10, y: 10 }),
      createLottieGeneratorNode({ x: 20, y: 20 }),
      createAudioGeneratorNode({ x: 30, y: 30 }),
    ];
    const ids = new Set(kinds.map((k) => k.id));
    expect(ids.size).toBe(4);
    expect(kinds[0]!.node.attrs?.imageGenerator).toBeTruthy();
    expect(kinds[1]!.node.attrs?.videoGenerator).toBeTruthy();
    expect(kinds[2]!.node.attrs?.lottieGenerator).toBeTruthy();
    expect(kinds[3]!.node.attrs?.audioGenerator).toBeTruthy();
  });

  it('finish* promote clears generator flags and keeps genPrompt', () => {
    let state = seed();

    state = reduceEditor(state, editorReducers.spawnImageGenerator, { x: 0, y: 0 });
    let id = String(state.selectedNodeId);
    state = reduceEditor(state, editorReducers.patchDocumentNode, {
        id,
        patch: { attrs: { genPrompt: 'img-prompt', imageGenerator: true } as any },
      });
    state = reduceEditor(state, editorReducers.finishImageGenerator, {
        nodeId: id,
        src: 'https://cdn.example.com/a.png',
        genPrompt: 'img-prompt',
      });
    expect(state.document!.deltaSetLike[id].attrs?.imageGenerator).toBeFalsy();
    expect(state.document!.deltaSetLike[id].attrs?.genPrompt).toBe('img-prompt');

    state = reduceEditor(state, editorReducers.spawnVideoGenerator, { x: 1, y: 1 });
    id = String(state.selectedNodeId);
    state = reduceEditor(state, editorReducers.finishVideoGenerator, {
        nodeId: id,
        src: 'https://cdn.example.com/a.mp4',
        genPrompt: 'vid-prompt',
      });
    expect(state.document!.deltaSetLike[id].attrs?.videoGenerator).toBeFalsy();
    expect(state.document!.deltaSetLike[id].attrs?.genPrompt).toBe('vid-prompt');

    state = reduceEditor(state, editorReducers.spawnAudioGenerator, { x: 2, y: 2 });
    id = String(state.selectedNodeId);
    state = reduceEditor(state, editorReducers.finishAudioGenerator, {
        nodeId: id,
        src: 'https://cdn.example.com/a.mp3',
        genPrompt: 'aud-prompt',
      });
    expect(state.document!.deltaSetLike[id].attrs?.audioGenerator).toBeFalsy();
    expect(state.document!.deltaSetLike[id].attrs?.genPrompt).toBe('aud-prompt');

    state = reduceEditor(state, editorReducers.spawnLottieGeneratorPlate, { x: 3, y: 3 });
    id = String(state.selectedNodeId);
    state = reduceEditor(state, editorReducers.finishLottieGenerator, {
        nodeId: id,
        animationData: SAMPLE_LOTTIE,
        genPrompt: 'lot-prompt',
      });
    // Generator plate is replaced by an animation workbench + host.
    expect(state.document!.deltaSetLike[id]).toBeUndefined();
    const frameId = String(state.selectedFrameIds?.[0] || '');
    expect(frameId).toBeTruthy();
    const frame = state.document!.frames?.find((f) => String(f.id) === frameId);
    expect(frame?.kind).toBe('animation');
    const host = Object.values(state.document!.deltaSetLike || {}).find(
      (n) => n?.attrs?.animationFrameHost && String(n?.attrs?.frameId) === frameId
    );
    expect(host?.attrs?.genPrompt).toBe('lot-prompt');
    expect(host?.attrs?.lottieGenerator).toBeFalsy();
  });

  it('allows deleting image generator while processStatus is running', () => {
    let state = seed();
    state = reduceEditor(state, editorReducers.spawnImageGenerator, { x: 0, y: 0 });
    const id = String(state.selectedNodeId);
    state = reduceEditor(state, editorReducers.patchDocumentNode, {
        nodeId: id,
        patch: {
          attrs: {
            processStatus: 'running',
            processKind: 'generate',
            processLabel: 'Generating',
          },
        },
      });
    expect(state.document!.deltaSetLike[id].attrs?.processStatus).toBe('running');

    const deleted = reduceEditor(state, editorReducers.removeDocumentNodes, { nodeIds: [id] });
    expect(deleted.document!.deltaSetLike[id]).toBeUndefined();
  });

  it('clearImageProcessAttrs removes process and job attrs from generator plate', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    const { id, node } = createImageGeneratorNode({ x: 0, y: 0 });
    node.attrs = {
      ...(node.attrs || {}),
      processStatus: 'running',
      processKind: 'generate',
      processJobIds: '["job-1"]',
      processStartedAt: String(Date.now()),
    };
    doc = addNodeToDocument(doc, id, node);

    const cleared = clearImageProcessAttrs(doc, id);
    const attrs = cleared.deltaSetLike[id].attrs || {};
    expect(attrs.processStatus).toBeUndefined();
    expect(attrs.processKind).toBeUndefined();
    expect(attrs.processJobIds).toBeUndefined();
    expect(attrs.processStartedAt).toBeUndefined();
    expect(attrs.imageGenerator).toBeTruthy();
  });

  it('clearImageProcess reducer clears SoftGlow and bumps sceneReloadToken', () => {
    let state = seed();
    state = reduceEditor(state, editorReducers.spawnImageGenerator, { x: 0, y: 0 });
    const id = String(state.selectedNodeId);
    state = reduceEditor(state, editorReducers.patchDocumentNode, {
        nodeId: id,
        patch: {
          attrs: {
            processStatus: 'running',
            processKind: 'generate',
            processJobIds: '["job-1"]',
          },
        },
      });
    const token = state.sceneReloadToken;
    const next = reduceEditor(state, editorReducers.clearImageProcess, { nodeId: id });
    expect(next.document!.deltaSetLike[id].attrs?.processStatus).toBeUndefined();
    expect(next.sceneReloadToken).toBe(token + 1);
  });

  it('finishImageGenerator stores multi-gen stack on attrs.imageVariants', () => {
    let state = seed();
    state = reduceEditor(state, editorReducers.spawnImageGenerator, { x: 0, y: 0 });
    const id = String(state.selectedNodeId);
    state = reduceEditor(state, editorReducers.finishImageGenerator, {
        nodeId: id,
        src: 'https://cdn.example.com/a.png',
        variants: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'],
        name: 'Image Generator',
        genPrompt: 'puppy in grass',
      });
    const attrs = state.document!.deltaSetLike[id].attrs || {};
    expect(attrs.imageGenerator).toBeFalsy();
    expect(attrs.src).toBe('https://cdn.example.com/a.png');
    expect(attrs.genPrompt).toBe('puppy in grass');
    const raw = attrs.imageVariants;
    const parsed =
      typeof raw === 'string'
        ? JSON.parse(raw)
        : Array.isArray(raw)
          ? raw
          : [];
    expect(parsed).toEqual([
      'https://cdn.example.com/a.png',
      'https://cdn.example.com/b.png',
    ]);
    const prompts = JSON.parse(String(attrs.imageVariantPrompts || '{}'));
    expect(prompts['https://cdn.example.com/a.png']).toBe('puppy in grass');
    expect(prompts['https://cdn.example.com/b.png']).toBe('puppy in grass');
  });

  it('finishImageGenerator does not resurrect a deleted plate', () => {
    let state = seed();
    state = reduceEditor(state, editorReducers.spawnImageGenerator, { x: 0, y: 0 });
    const id = String(state.selectedNodeId);
    state = reduceEditor(state, editorReducers.removeDocumentNodes, { nodeIds: [id] });
    const after = reduceEditor(state, editorReducers.finishImageGenerator, {
        nodeId: id,
        src: 'https://cdn/ghost.png',
      });
    expect(after.document!.deltaSetLike[id]).toBeUndefined();
  });
});
