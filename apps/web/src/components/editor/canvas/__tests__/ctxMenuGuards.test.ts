import { describe, expect, it } from 'vitest';
import { ctxMenuTargetHasProcessing, canDeleteCtxMenuTargets, selectionMutationBlocked } from '../ctxMenuGuards';

const doc = {
  deltaSetLike: {
    'img-running': {
      key: 'image',
      attrs: { processStatus: 'running', processLabel: 'Uploading', processKind: 'upload' },
    },
    'img-multi': {
      key: 'image',
      attrs: { processStatus: 'running', processKind: 'multiAngle' },
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
    expect(selectionMutationBlocked(doc, ['img-multi'], [])).toBe(true);
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

  it('does not block mutations on frame processStatus alone', () => {
    expect(selectionMutationBlocked(doc, [], ['frame-running'])).toBe(false);
  });

  it('allows deleting any processing target', () => {
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
    ).toBe(true);
    expect(
      canDeleteCtxMenuTargets({
        document: doc,
        ids: ['img-multi'],
        selectedFrameIds: [],
      })
    ).toBe(true);
  });
});
