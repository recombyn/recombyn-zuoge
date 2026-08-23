/**
 * Store-level canvas generators + media promote coverage (no browser).
 */
import { describe, expect, it } from 'vitest';
import reducer, {
  createTemplate,
  finishAudioGenerator,
  finishImageGenerator,
  finishLottieGenerator,
  finishVideoGenerator,
  patchDocumentNode,
  spawnAudioGenerator,
  spawnImageGenerator,
  spawnLottieGenerator,
  spawnVideoGenerator,
} from '@/store/modules/editor';
import { createEmptyDocument } from '@/components/rcb/scene/document/sceneDocument';
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
  let state = reducer(undefined, { type: '@@INIT' } as any);
  state = reducer(
    state,
    createTemplate({
      name: 'canvas-generators-store',
      document: createEmptyDocument({ emptyWorld: true }),
      emptyWorld: true,
      source: 'scratch',
    })
  );
  return state;
}

describe('canvas generators (store)', () => {
  it('spawns image/video/lottie/audio generator plates as selected nodes', () => {
    let state = seed();
    const specs = [
      { action: spawnImageGenerator, flag: 'imageGenerator' },
      { action: spawnVideoGenerator, flag: 'videoGenerator' },
      { action: spawnLottieGenerator, flag: 'lottieGenerator' },
      { action: spawnAudioGenerator, flag: 'audioGenerator' },
    ] as const;

    for (let i = 0; i < specs.length; i += 1) {
      const { action, flag } = specs[i]!;
      state = reducer(state, action({ x: i * 40, y: i * 30, name: flag }));
      const id = String(state.selectedNodeId || '');
      expect(id.length).toBeGreaterThan(2);
      const node = state.document!.deltaSetLike[id];
      expect(node).toBeTruthy();
      expect(Boolean((node.attrs as any)?.[flag])).toBe(true);
    }
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

    state = reducer(state, spawnImageGenerator({ x: 0, y: 0 }));
    let id = String(state.selectedNodeId);
    state = reducer(
      state,
      patchDocumentNode({
        id,
        patch: { attrs: { genPrompt: 'img-prompt', imageGenerator: true } as any },
      })
    );
    state = reducer(
      state,
      finishImageGenerator({
        nodeId: id,
        src: 'https://cdn.example.com/a.png',
        genPrompt: 'img-prompt',
      })
    );
    expect(state.document!.deltaSetLike[id].attrs?.imageGenerator).toBeFalsy();
    expect(state.document!.deltaSetLike[id].attrs?.genPrompt).toBe('img-prompt');

    state = reducer(state, spawnVideoGenerator({ x: 1, y: 1 }));
    id = String(state.selectedNodeId);
    state = reducer(
      state,
      finishVideoGenerator({
        nodeId: id,
        src: 'https://cdn.example.com/a.mp4',
        genPrompt: 'vid-prompt',
      })
    );
    expect(state.document!.deltaSetLike[id].attrs?.videoGenerator).toBeFalsy();
    expect(state.document!.deltaSetLike[id].attrs?.genPrompt).toBe('vid-prompt');

    state = reducer(state, spawnAudioGenerator({ x: 2, y: 2 }));
    id = String(state.selectedNodeId);
    state = reducer(
      state,
      finishAudioGenerator({
        nodeId: id,
        src: 'https://cdn.example.com/a.mp3',
        genPrompt: 'aud-prompt',
      })
    );
    expect(state.document!.deltaSetLike[id].attrs?.audioGenerator).toBeFalsy();
    expect(state.document!.deltaSetLike[id].attrs?.genPrompt).toBe('aud-prompt');

    state = reducer(state, spawnLottieGenerator({ x: 3, y: 3 }));
    id = String(state.selectedNodeId);
    state = reducer(
      state,
      finishLottieGenerator({
        nodeId: id,
        animationData: SAMPLE_LOTTIE,
        genPrompt: 'lot-prompt',
      })
    );
    expect(state.document!.deltaSetLike[id].attrs?.lottieGenerator).toBeFalsy();
    expect(state.document!.deltaSetLike[id].attrs?.genPrompt).toBe('lot-prompt');
  });
});
