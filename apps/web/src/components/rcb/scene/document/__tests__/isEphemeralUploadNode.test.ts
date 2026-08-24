import { describe, expect, it } from 'vitest';
import { isEphemeralUploadNode } from '../nodeCapabilities';

describe('isEphemeralUploadNode', () => {
  it('returns false for idle nodes', () => {
    expect(isEphemeralUploadNode({ key: 'image', attrs: {} })).toBe(false);
  });

  it('blocks spawned upload placeholders', () => {
    expect(
      isEphemeralUploadNode({
        key: 'image',
        attrs: { processStatus: 'running', processKind: 'upload' },
      })
    ).toBe(true);
  });

  it('allows in-flight image generator plates', () => {
    expect(
      isEphemeralUploadNode({
        key: 'image',
        attrs: {
          imageGenerator: true,
          processStatus: 'running',
          processKind: 'generate',
        },
      })
    ).toBe(false);
  });

  it('allows in-flight quick edit on owned image', () => {
    expect(
      isEphemeralUploadNode({
        key: 'image',
        attrs: {
          src: 'https://cdn/x.png',
          processStatus: 'running',
          processKind: 'quickEdit',
        },
      })
    ).toBe(false);
  });
});
