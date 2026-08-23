import { describe, expect, it } from 'vitest';
import { deletionTargetHasProcessing } from '../nodeCapabilities';

describe('deletionTargetHasProcessing', () => {
  const doc = {
    deltaSetLike: {
      'img-running': {
        id: 'img-running',
        key: 'image',
        attrs: { processStatus: 'running', processLabel: 'Erasing…' },
      },
      'img-done': {
        id: 'img-done',
        key: 'image',
        attrs: { processStatus: null },
      },
    },
    frames: [{ id: 'frame-running', processStatus: 'running' }],
  } as any;

  it('blocks deleting a processing node', () => {
    expect(deletionTargetHasProcessing(doc, ['img-running'], [])).toBe(true);
  });

  it('allows deleting idle nodes', () => {
    expect(deletionTargetHasProcessing(doc, ['img-done'], [])).toBe(false);
  });

  it('blocks deleting a processing artboard', () => {
    expect(deletionTargetHasProcessing(doc, [], ['frame-running'])).toBe(true);
  });
});
