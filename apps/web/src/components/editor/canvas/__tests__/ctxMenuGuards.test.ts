import { describe, expect, it } from 'vitest';
import { ctxMenuTargetHasProcessing, canDeleteCtxMenuTargets, selectionMutationBlocked } from '../ctxMenuGuards';

const doc = {
  deltaSetLike: {
    'img-running': {
      key: 'image',
      attrs: { processStatus: 'running', processLabel: 'Uploading' },
    },
    'img-done': {
      key: 'image',
      attrs: { src: 'https://example.com/a.png' },
    },
  },
  frames: [{ id: 'frame-running', processStatus: 'running' }],
} as any;

describe('ctxMenuGuards', () => {
  it('blocks mutations while a node is processing', () => {
    expect(selectionMutationBlocked(doc, ['img-running'], [])).toBe(true);
    expect(
      ctxMenuTargetHasProcessing({
        document: doc,
        ids: ['img-running'],
        selectedFrameIds: [],
      })
    ).toBe(true);
  });

  it('allows mutations after processing completes', () => {
    expect(selectionMutationBlocked(doc, ['img-done'], [])).toBe(false);
    expect(
      ctxMenuTargetHasProcessing({
        document: doc,
        ids: ['img-done'],
        selectedFrameIds: [],
      })
    ).toBe(false);
  });

  it('blocks mutations while a frame is processing', () => {
    expect(selectionMutationBlocked(doc, [], ['frame-running'])).toBe(true);
  });

  it('still allows deleting artboards while processing', () => {
    expect(
      canDeleteCtxMenuTargets({
        document: doc,
        ids: [],
        selectedFrameIds: ['frame-running'],
      })
    ).toBe(true);
    expect(
      canDeleteCtxMenuTargets({
        document: doc,
        ids: ['img-running'],
        selectedFrameIds: [],
      })
    ).toBe(false);
  });
});
