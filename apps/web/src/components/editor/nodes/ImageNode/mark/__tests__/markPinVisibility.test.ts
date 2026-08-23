import { describe, expect, it } from 'vitest';
import { listVisibleMarkPins } from '../markPinVisibility';
import type { ImageMarkPin } from '@/store/modules/editor';

const pin: ImageMarkPin = {
  nodeId: 'img-1',
  id: 'pin-1',
  index: 1,
  x: 10,
  y: 20,
  w: 100,
  h: 80,
  sink: 'quickEdit',
};

const document = {
  deltaSetLike: {
    'img-1': { key: 'image', width: 400, height: 300, attrs: {} },
    'shape-1': { key: 'shape', width: 100, height: 100, attrs: {} },
  },
} as any;

describe('listVisibleMarkPins', () => {
  it('shows pin for selected image when not in mark session', () => {
    const visible = listVisibleMarkPins(document, { 'img-1': pin }, null, ['img-1']);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.nodeId).toBe('img-1');
  });

  it('shows pin while mark session is active on the same node', () => {
    const visible = listVisibleMarkPins(
      document,
      { 'img-1': pin },
      { nodeId: 'img-1', kind: 'mark' },
      ['img-1']
    );
    expect(visible).toHaveLength(1);
    expect(visible[0]?.nodeId).toBe('img-1');
  });

  it('hides pins while selection is transforming', () => {
    const visible = listVisibleMarkPins(document, { 'img-1': [pin] }, null, ['img-1'], true);
    expect(visible).toHaveLength(0);
  });

  it('shows pins on all nodes during quick-edit mark session', () => {
    const pin2: ImageMarkPin = { ...pin, nodeId: 'img-2', id: 'pin-2' };
    const doc = {
      deltaSetLike: {
        'img-1': { key: 'image', width: 400, height: 300, attrs: { src: 'a.png' } },
        'img-2': { key: 'image', width: 200, height: 200, attrs: { src: 'b.png' } },
      },
    } as any;
    const visible = listVisibleMarkPins(
      doc,
      { 'img-1': pin, 'img-2': pin2 },
      { nodeId: 'img-1', kind: 'mark', markSink: 'quickEdit' },
      []
    );
    expect(visible).toHaveLength(2);
  });
});
