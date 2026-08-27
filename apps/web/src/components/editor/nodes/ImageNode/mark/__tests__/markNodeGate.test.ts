import { describe, expect, it } from 'vitest';
import {
  canMarkNode,
  markGateTipKey,
  markNodeGate,
} from '@/components/editor/nodes/ImageNode/mark/markGeometry';

describe('markNodeGate', () => {
  it('allows raster images with src when ILP is on', () => {
    const gate = markNodeGate(
      { key: 'image', attrs: { src: 'https://x/a.png' } } as any,
      { ilpEnabled: true }
    );
    expect(gate).toEqual({ status: 'ready' });
    expect(canMarkNode({ key: 'image', attrs: { src: 'https://x/a.png' } } as any, { ilpEnabled: true })).toBe(
      true
    );
    expect(markGateTipKey(gate)).toBe('editor.imageToolbar.mark');
  });

  it('disables vectors / frames / video', () => {
    expect(markNodeGate({ key: 'shape', attrs: {} } as any, { ilpEnabled: true })).toEqual({
      status: 'disabled',
      reason: 'not_image',
    });
    expect(markNodeGate({ key: 'path', attrs: {} } as any, { ilpEnabled: true })).toEqual({
      status: 'disabled',
      reason: 'not_image',
    });
    expect(
      markNodeGate({ key: 'video', attrs: { src: 'v.mp4' } } as any, { ilpEnabled: true })
    ).toEqual({ status: 'disabled', reason: 'not_image' });
  });

  it('disables when ILP is off, processing, or missing src', () => {
    const img = { key: 'image', attrs: { src: 'https://x/a.png' } } as any;
    expect(markNodeGate(img, { ilpEnabled: false })).toEqual({
      status: 'disabled',
      reason: 'no_ilp',
    });
    expect(
      markNodeGate(
        { key: 'image', attrs: { src: 'https://x/a.png', processStatus: 'running' } } as any,
        { ilpEnabled: true }
      )
    ).toEqual({ status: 'disabled', reason: 'processing' });
    expect(
      markNodeGate({ key: 'image', attrs: { imageGenerator: true } } as any, { ilpEnabled: true })
    ).toEqual({ status: 'disabled', reason: 'unavailable' });
  });
});
