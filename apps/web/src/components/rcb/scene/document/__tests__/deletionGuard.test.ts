import { describe, expect, it } from 'vitest';
import { selectionHasProcessing } from '../nodeCapabilities';

describe('processing delete vs mutation guards', () => {
  const doc = {
    deltaSetLike: {
      'img-running': {
        id: 'img-running',
        key: 'image',
        attrs: { processStatus: 'running', processLabel: 'Erasing…', processKind: 'upload' },
      },
      'img-generator-running': {
        id: 'img-generator-running',
        key: 'image',
        attrs: {
          processStatus: 'running',
          processKind: 'generate',
          imageGenerator: true,
        },
      },
      'img-multi': {
        id: 'img-multi',
        key: 'image',
        attrs: {
          processStatus: 'running',
          processKind: 'multiAngle',
          processLabel: '多角度生成',
        },
      },
      'img-done': {
        id: 'img-done',
        key: 'image',
        attrs: { processStatus: null },
      },
    },
    frames: [{ id: 'frame-running', processStatus: 'running' }],
  } as any;

  it('flags SoftGlow nodes for mutation blocking', () => {
    expect(selectionHasProcessing(doc, ['img-running'], [])).toBe(true);
    expect(selectionHasProcessing(doc, ['img-multi'], [])).toBe(true);
    expect(selectionHasProcessing(doc, ['img-generator-running'], [])).toBe(true);
    expect(selectionHasProcessing(doc, ['img-done'], [])).toBe(false);
    expect(selectionHasProcessing(doc, [], ['frame-running'])).toBe(true);
  });
});
