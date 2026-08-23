import type { SceneDocument } from '@/components/rcb/sceneNode';
/**
 * E2E stress: generate (with attachment refs) → promote → quick-edit echoes genPrompt.
 * Mirrors Image/Video/Audio/Lottie generator + placeMediaAsset → QuickEdit read path.
 */
import { describe, expect, it } from 'vitest';
import reducer, {
  createTemplate,
  finishAudioGenerator,
  finishImageGenerator,
  finishImageProcess,
  finishLottieGenerator,
  finishVideoGenerator,
  patchDocumentNode,
  placeMediaAsset,
  spawnAudioGenerator,
  spawnImageGenerator,
  spawnLottieGenerator,
  spawnVideoGenerator,
} from '@/store/modules/editor';
import {
  createEmptyDocument
} from '@/components/rcb/scene/document/sceneDocument';

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

/** Same read QuickEdit composers use: node.attrs.genPrompt. */
function readQuickEditEcho(state: { document: SceneDocument }, nodeId: string): string {
  const node = state.document?.deltaSetLike?.[nodeId];
  return String(node?.attrs?.genPrompt || '').trim();
}

function seedEditor() {
  let state = reducer(undefined, { type: '@@INIT' } as any);
  state = reducer(
    state,
    createTemplate({
      name: 'quick-edit-echo-stress',
      document: createEmptyDocument({ emptyWorld: true }),
      emptyWorld: true,
      source: 'scratch',
    })
  );
  return state;
}

/** Simulate generator plate: durable genPrompt + attachment metadata before promote. */
function patchGeneratorWithPromptAndAttachment(
  state: any,
  nodeId: string,
  prompt: string,
  attachmentUrl: string
) {
  return reducer(
    state,
    patchDocumentNode({
      nodeId,
      skipHistory: true,
      patch: {
        attrs: {
          genPrompt: prompt,
          processStatus: 'running',
          processKind: 'generate',
          // Composer attachments are not node children; keep a durable hint for stress.
          genAttachmentSrc: attachmentUrl,
        },
      },
    })
  );
}

describe('quick-edit genPrompt echo stress (e2e store path)', () => {
  it('image: generate with attachment → promote → quick-edit echoes prompt (×40)', () => {
    let state = seedEditor();
    const echoes: string[] = [];

    for (let i = 0; i < 40; i++) {
      const prompt = `一个中年人拿着大哥大 #${i} 附件参考`;
      const attach = `https://cdn.example.com/ref-${i}.png`;
      const src = `https://cdn.example.com/gen-${i}.png`;

      state = reducer(state, spawnImageGenerator({ x: i * 10, y: i * 8 }));
      const nodeId = String(state.selectedNodeId || '');
      expect(nodeId).toBeTruthy();

      state = patchGeneratorWithPromptAndAttachment(state, nodeId, prompt, attach);
      expect(readQuickEditEcho(state, nodeId)).toBe(prompt);
      expect(String(state.document.deltaSetLike[nodeId].attrs.genAttachmentSrc)).toBe(attach);

      state = reducer(
        state,
        finishImageGenerator({
          nodeId,
          src,
          name: 'Image',
          variants: [src],
          genPrompt: prompt,
        })
      );

      const echo = readQuickEditEcho(state, nodeId);
      expect(echo).toBe(prompt);
      expect(state.document.deltaSetLike[nodeId].attrs.imageGenerator).toBeFalsy();
      expect(String(state.document.deltaSetLike[nodeId].attrs.src)).toBe(src);
      echoes.push(echo);

      // Quick-edit regenerate updates genPrompt again (second pass).
      const edited = `${prompt} · 再改一版`;
      state = reducer(
        state,
        finishImageProcess({
          nodeId,
          src: `https://cdn.example.com/qe-${i}.png`,
          attrs: { genPrompt: edited },
        })
      );
      expect(readQuickEditEcho(state, nodeId)).toBe(edited);
    }

    expect(new Set(echoes).size).toBe(40);
  });

  it('video / audio / lottie: generate with attachment hint → quick-edit echoes', () => {
    let state = seedEditor();

    // Video
    {
      const prompt = '夜景公路延时 · 参考附件帧';
      const attach = 'https://cdn.example.com/frame.jpg';
      state = reducer(state, spawnVideoGenerator({ x: 0, y: 0 }));
      const nodeId = String(state.selectedNodeId);
      state = patchGeneratorWithPromptAndAttachment(state, nodeId, prompt, attach);
      state = reducer(
        state,
        finishVideoGenerator({
          nodeId,
          src: 'https://cdn.example.com/out.mp4',
          genPrompt: prompt,
        })
      );
      expect(readQuickEditEcho(state, nodeId)).toBe(prompt);
    }

    // Audio
    {
      const prompt = '女声旁白：欢迎来到九十年代';
      const attach = 'https://cdn.example.com/voice-ref.mp3';
      state = reducer(state, spawnAudioGenerator({ x: 40, y: 40 }));
      const nodeId = String(state.selectedNodeId);
      state = patchGeneratorWithPromptAndAttachment(state, nodeId, prompt, attach);
      state = reducer(
        state,
        finishAudioGenerator({
          nodeId,
          src: 'https://cdn.example.com/tts.mp3',
          genPrompt: prompt,
          uploadKey: 'uploads/tts.mp3',
        })
      );
      expect(readQuickEditEcho(state, nodeId)).toBe(prompt);
    }

    // Lottie
    {
      const prompt = '加载中旋转圆环';
      const attach = 'https://cdn.example.com/style-ref.png';
      state = reducer(state, spawnLottieGenerator({ x: 80, y: 80 }));
      const nodeId = String(state.selectedNodeId);
      state = patchGeneratorWithPromptAndAttachment(state, nodeId, prompt, attach);
      state = reducer(
        state,
        finishLottieGenerator({
          nodeId,
          animationData: SAMPLE_LOTTIE,
          genPrompt: prompt,
        })
      );
      expect(readQuickEditEcho(state, nodeId)).toBe(prompt);
    }
  });

  it('assets dock placeMediaAsset with prompt (library attachment) echoes on quick-edit', () => {
    let state = seedEditor();
    const cases: Array<{ kind: 'image' | 'video' | 'audio'; prompt: string; src: string }> = [
      {
        kind: 'image',
        prompt: '资产库拖入：金毛特写',
        src: 'https://cdn.example.com/asset-dog.png',
      },
      {
        kind: 'video',
        prompt: '资产库拖入：产品开箱',
        src: 'https://cdn.example.com/asset-unbox.mp4',
      },
      {
        kind: 'audio',
        prompt: '资产库拖入：BGM 轻快',
        src: 'https://cdn.example.com/asset-bgm.mp3',
      },
    ];

    for (let round = 0; round < 20; round++) {
      for (const c of cases) {
        const prompt = `${c.prompt} · r${round}`;
        state = reducer(
          state,
          placeMediaAsset({
            kind: c.kind,
            src: c.src,
            prompt,
            uploadKey: `obj/${c.kind}-${round}`,
            x: round * 5,
            y: round * 5,
            width: 200,
            height: 160,
            name: prompt.slice(0, 40),
          })
        );
        const nodeId = String(state.selectedNodeId);
        expect(readQuickEditEcho(state, nodeId)).toBe(prompt);
      }
    }
  });

  it(
    'stress: interleaved generate+attach and placeMediaAsset never drop genPrompt',
    { timeout: 30_000 },
    () => {
    let state = seedEditor();
    const seen: string[] = [];

    for (let i = 0; i < 80; i++) {
      const prompt = `压测提示词-${i}-with-attach`;
      const attach = `data:image/png;base64,AAA${i}`;

      if (i % 2 === 0) {
        state = reducer(state, spawnImageGenerator({ x: i, y: i }));
        const nodeId = String(state.selectedNodeId);
        state = patchGeneratorWithPromptAndAttachment(state, nodeId, prompt, attach);
        state = reducer(
          state,
          finishImageGenerator({
            nodeId,
            src: `https://cdn.example.com/s${i}.png`,
            genPrompt: prompt,
          })
        );
        expect(readQuickEditEcho(state, nodeId)).toBe(prompt);
        seen.push(nodeId);
      } else {
        state = reducer(
          state,
          placeMediaAsset({
            kind: 'image',
            src: `https://cdn.example.com/p${i}.png`,
            prompt,
            uploadKey: `uk-${i}`,
            x: i,
            y: i,
          })
        );
        const nodeId = String(state.selectedNodeId);
        expect(readQuickEditEcho(state, nodeId)).toBe(prompt);
        seen.push(nodeId);
      }
    }

    // All previously placed nodes still carry their prompts after later ops.
    for (let i = 0; i < seen.length; i++) {
      const nodeId = seen[i]!;
      const want = `压测提示词-${i}-with-attach`;
      expect(readQuickEditEcho(state, nodeId)).toBe(want);
    }
  });
});
