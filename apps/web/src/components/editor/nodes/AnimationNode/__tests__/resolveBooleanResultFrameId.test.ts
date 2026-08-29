import { describe, expect, it } from 'vitest';
import { resolveBooleanResultFrameId } from '../resolveAnimationFrameId';

describe('resolveBooleanResultFrameId', () => {
  const document = {
    frames: [
      {
        id: 'anim1',
        kind: 'animation',
        x: 0,
        y: 0,
        width: 200,
        height: 200,
      },
      {
        id: 'board1',
        kind: 'artboard',
        x: 300,
        y: 0,
        width: 200,
        height: 200,
      },
    ],
  };

  it('does not bind outside shapes to the open animation workbench', () => {
    // Previously fell back to timeline focus and forced frameId.
    expect(resolveBooleanResultFrameId(document, [], 400, 100)).toBe('');
  });

  it('binds when the result center is inside the animation plate', () => {
    expect(resolveBooleanResultFrameId(document, [], 100, 100)).toBe('anim1');
  });

  it('drops animation frameId when operands were inside but result center left the plate', () => {
    expect(resolveBooleanResultFrameId(document, ['anim1'], 400, 100)).toBe('');
  });

  it('keeps animation frameId when result stays inside', () => {
    expect(resolveBooleanResultFrameId(document, ['anim1'], 50, 50)).toBe('anim1');
  });

  it('keeps regular artboard ownership from operands', () => {
    expect(resolveBooleanResultFrameId(document, ['board1'], 400, 100)).toBe('board1');
  });
});
