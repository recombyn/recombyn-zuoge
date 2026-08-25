import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  listRecoverableGeneratorNodes,
  recoverGeneratorNode,
  findResumableUploadNodeId,
} from '../generatorJobRecovery';
import {
  registerGeneratorSession,
  unregisterGeneratorSession,
} from '../generatorSessionRegistry';
import { PROCESS_JOB_STALE_MS } from '@/components/rcb/scene/document/processJobAttrs';

vi.mock('@/service/generateImageBatch', () => ({
  waitForImageBatchJobs: vi.fn(),
}));

vi.mock('@/service/chat', () => ({
  waitForVideoJob: vi.fn(),
  waitForAudioJob: vi.fn(),
  waitForLottieJob: vi.fn(),
}));

vi.mock('@/components/rcb/scene/document/nodeFactories', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/components/rcb/scene/document/nodeFactories')
  >();
  return {
    ...actual,
    captureVideoPosterFrame: vi.fn(async () => 'https://cdn/poster.jpg'),
  };
});

import { waitForImageBatchJobs } from '@/service/generateImageBatch';
import { waitForAudioJob, waitForLottieJob, waitForVideoJob } from '@/service/chat';
import { isLottieGeneratorNode } from '@/components/rcb/scene/document/nodeCapabilities';
import { parseLottieAnimationData } from '@/components/rcb/scene/document/nodeFactories';

const doc = {
  deltaSetLike: {
    'gen-img': {
      id: 'gen-img',
      key: 'image',
      attrs: {
        imageGenerator: true,
        processStatus: 'running',
        processKind: 'generate',
        processJobIds: '["job-img"]',
        processStartedAt: String(Date.now()),
        genPrompt: 'a cat',
      },
    },
    'quick-edit': {
      id: 'quick-edit',
      key: 'image',
      attrs: {
        src: 'https://cdn/source.png',
        processStatus: 'running',
        processKind: 'quickEdit',
        processJobIds: '["job-qe"]',
        processStartedAt: String(Date.now()),
      },
    },
    'upload-ph': {
      id: 'upload-ph',
      key: 'image',
      attrs: {
        processStatus: 'running',
        processKind: 'upload',
      },
    },
    'stale-gen': {
      id: 'stale-gen',
      key: 'image',
      attrs: {
        imageGenerator: true,
        processStatus: 'running',
        processKind: 'generate',
        processStartedAt: String(Date.now() - PROCESS_JOB_STALE_MS - 1000),
      },
    },
    'stale-gen-jobs': {
      id: 'stale-gen-jobs',
      key: 'image',
      attrs: {
        imageGenerator: true,
        processStatus: 'running',
        processKind: 'generate',
        processJobIds: '["job-stale"]',
        processStartedAt: String(Date.now() - PROCESS_JOB_STALE_MS - 1000),
      },
    },
    'lottie-gen': {
      id: 'lottie-gen',
      key: 'lottie',
      x: 10,
      y: 20,
      width: 200,
      height: 200,
      attrs: {
        lottieGenerator: true,
        processStatus: 'running',
        processKind: 'generate',
        processJobIds: '["job-lottie"]',
        processStartedAt: String(Date.now()),
        genPrompt: 'spinner',
      },
    },
  },
  frames: [],
} as any;

describe('generatorJobRecovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    unregisterGeneratorSession('gen-img');
    unregisterGeneratorSession('quick-edit');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists only generate/quickEdit running nodes', () => {
    const ids = listRecoverableGeneratorNodes(doc).map((x) => x.nodeId);
    expect(ids).toContain('gen-img');
    expect(ids).toContain('quick-edit');
    expect(ids).toContain('stale-gen');
    expect(ids).toContain('lottie-gen');
    expect(ids).not.toContain('upload-ph');
  });

  it('finds upload placeholder for refresh recovery', () => {
    expect(findResumableUploadNodeId(doc)).toBe('upload-ph');
    expect(findResumableUploadNodeId({ deltaSetLike: {} } as any)).toBeNull();
  });

  it('skips nodes with an active in-memory session', async () => {
    registerGeneratorSession('gen-img');
    const dispatch = vi.fn();
    const result = await recoverGeneratorNode(
      dispatch,
      doc,
      'gen-img',
      doc.deltaSetLike['gen-img']
    );
    expect(result).toBe('skipped');
    expect(waitForImageBatchJobs).not.toHaveBeenCalled();
  });

  it('clears SoftGlow when generator has no job ids', async () => {
    const dispatch = vi.fn();
    const result = await recoverGeneratorNode(
      dispatch,
      doc,
      'stale-gen',
      doc.deltaSetLike['stale-gen']
    );
    expect(result).toBe('cleared');
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.stringContaining('clearImageProcess'),
        payload: expect.objectContaining({ nodeId: 'stale-gen' }),
      })
    );
    expect(waitForImageBatchJobs).not.toHaveBeenCalled();
  });

  it('clears SoftGlow when job ids are stale (skip long poll)', async () => {
    const dispatch = vi.fn();
    const result = await recoverGeneratorNode(
      dispatch,
      doc,
      'stale-gen-jobs',
      doc.deltaSetLike['stale-gen-jobs']
    );
    expect(result).toBe('cleared');
    expect(waitForImageBatchJobs).not.toHaveBeenCalled();
  });

  it('finishes lottie generator when SSE job resolves', async () => {
    const lottieNode = doc.deltaSetLike['lottie-gen'];
    expect(isLottieGeneratorNode(lottieNode)).toBe(true);
    const payload = {
      animationData: {
        v: '5.7.0',
        fr: 30,
        w: 100,
        h: 100,
        layers: [{ ty: 4, nm: 's', shapes: [] }],
      },
      w: 100,
      h: 100,
    };
    expect(parseLottieAnimationData(payload.animationData)).not.toBeNull();
    vi.mocked(waitForLottieJob).mockResolvedValue(payload);
    const dispatch = vi.fn();
    const result = await recoverGeneratorNode(
      dispatch,
      doc,
      'lottie-gen',
      doc.deltaSetLike['lottie-gen']
    );
    expect(result).toBe('done');
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.stringContaining('finishLottieGenerator'),
        payload: expect.objectContaining({ nodeId: 'lottie-gen' }),
      })
    );
  });

  it('clears SoftGlow for lottie without job ids', async () => {
    const dispatch = vi.fn();
    const node = {
      ...doc.deltaSetLike['lottie-gen'],
      attrs: {
        ...doc.deltaSetLike['lottie-gen'].attrs,
        processJobIds: undefined,
      },
    };
    const result = await recoverGeneratorNode(dispatch, doc, 'lottie-gen', node);
    expect(result).toBe('cleared');
    expect(waitForLottieJob).not.toHaveBeenCalled();
  });

  it('finishes image generator when jobs resolve', async () => {
    vi.mocked(waitForImageBatchJobs).mockResolvedValueOnce([
      'https://cdn/a.png',
      'https://cdn/b.png',
    ]);
    const dispatch = vi.fn();
    const result = await recoverGeneratorNode(
      dispatch,
      doc,
      'gen-img',
      doc.deltaSetLike['gen-img']
    );
    expect(result).toBe('done');
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.stringContaining('finishImageGenerator'),
        payload: expect.objectContaining({
          nodeId: 'gen-img',
          src: 'https://cdn/a.png',
          variants: ['https://cdn/a.png', 'https://cdn/b.png'],
        }),
      })
    );
  });

  it('finishes quick edit when jobs resolve', async () => {
    vi.mocked(waitForImageBatchJobs).mockResolvedValueOnce(['https://cdn/new.png']);
    const dispatch = vi.fn();
    const result = await recoverGeneratorNode(
      dispatch,
      doc,
      'quick-edit',
      doc.deltaSetLike['quick-edit']
    );
    expect(result).toBe('done');
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.stringContaining('finishImageProcess'),
        payload: expect.objectContaining({
          nodeId: 'quick-edit',
          src: 'https://cdn/new.png',
        }),
      })
    );
  });

  it('clears process attrs when job polling fails', async () => {
    vi.mocked(waitForImageBatchJobs).mockRejectedValueOnce(new Error('failed'));
    const dispatch = vi.fn();
    const result = await recoverGeneratorNode(
      dispatch,
      doc,
      'gen-img',
      doc.deltaSetLike['gen-img']
    );
    expect(result).toBe('failed');
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.stringContaining('clearImageProcess'),
        payload: expect.objectContaining({ nodeId: 'gen-img' }),
      })
    );
  });

  it('recovers video generator jobs', async () => {
    const videoDoc = {
      ...doc,
      deltaSetLike: {
        'gen-vid': {
          id: 'gen-vid',
          key: 'video',
          attrs: {
            videoGenerator: true,
            processStatus: 'running',
            processKind: 'generate',
            processJobIds: '["job-vid"]',
            processStartedAt: String(Date.now()),
          },
        },
      },
    } as any;
    vi.mocked(waitForVideoJob).mockResolvedValueOnce({
      videos: ['https://cdn/v.mp4'],
      model: 'm',
    });
    const dispatch = vi.fn();
    const result = await recoverGeneratorNode(
      dispatch,
      videoDoc,
      'gen-vid',
      videoDoc.deltaSetLike['gen-vid']
    );
    expect(result).toBe('done');
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.stringContaining('finishVideoGenerator'),
      })
    );
  });

  it('recovers audio generator jobs', async () => {
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      if (tagName === 'audio') {
        const el = origCreateElement('div') as HTMLAudioElement & {
          onloadedmetadata: (() => void) | null;
          onerror: (() => void) | null;
        };
        Object.defineProperty(el, 'duration', { value: 2.5 });
        let srcValue = '';
        Object.defineProperty(el, 'src', {
          get: () => srcValue,
          set: (v: string) => {
            srcValue = v;
            queueMicrotask(() => el.onloadedmetadata?.());
          },
        });
        el.removeAttribute = vi.fn();
        el.load = vi.fn();
        return el;
      }
      return origCreateElement(tagName, options);
    });

    const audioDoc = {
      ...doc,
      deltaSetLike: {
        'gen-aud': {
          id: 'gen-aud',
          key: 'audio',
          attrs: {
            audioGenerator: true,
            processStatus: 'running',
            processKind: 'generate',
            processJobIds: '["job-aud"]',
            processStartedAt: String(Date.now()),
          },
        },
      },
    } as any;
    vi.mocked(waitForAudioJob).mockResolvedValueOnce({
      audios: ['https://cdn/a.mp3'],
      model: 'm',
    });
    const dispatch = vi.fn();
    const result = await recoverGeneratorNode(
      dispatch,
      audioDoc,
      'gen-aud',
      audioDoc.deltaSetLike['gen-aud']
    );
    expect(result).toBe('done');
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.stringContaining('finishAudioGenerator'),
      })
    );
  });
});
