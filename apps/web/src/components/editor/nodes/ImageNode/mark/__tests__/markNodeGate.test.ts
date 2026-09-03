import { canMarkNode, markNodeGate } from '../markGeometry';

describe('markNodeGate', () => {
  it('allows ready images', () => {
    const gate = markNodeGate({
      key: 'image',
      attrs: { src: 'https://x/a.png' },
    } as any);
    expect(gate).toEqual({ status: 'ready' });
    expect(
      canMarkNode({ key: 'image', attrs: { src: 'https://x/a.png' } } as any)
    ).toBe(true);
  });

  it('blocks non-images and media', () => {
    expect(markNodeGate({ key: 'shape', attrs: {} } as any)).toEqual({
      status: 'disabled',
      reason: 'not_image',
    });
    expect(markNodeGate({ key: 'path', attrs: {} } as any)).toEqual({
      status: 'disabled',
      reason: 'not_image',
    });
    expect(markNodeGate({ key: 'video', attrs: { src: 'v.mp4' } } as any)).toEqual({
      status: 'disabled',
      reason: 'not_image',
    });
  });

  it('blocks processing / empty src', () => {
    const img = { key: 'image', attrs: { src: 'https://x/a.png', processStatus: 'running' } };
    expect(markNodeGate(img as any)).toEqual({
      status: 'disabled',
      reason: 'processing',
    });
    expect(
      markNodeGate({ key: 'image', attrs: { imageGenerator: true } } as any)
    ).toEqual({ status: 'disabled', reason: 'unavailable' });
  });
});
