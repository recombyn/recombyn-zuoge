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

  it('hides pin while mark session is active on the same node', () => {
    const visible = listVisibleMarkPins(
      document,
      { 'img-1': pin },
      { nodeId: 'img-1', kind: 'mark' },
      ['img-1']
    );
    expect(visible).toHaveLength(0);
  });

  it('ignores non-image selections', () => {
    const visible = listVisibleMarkPins(document, { 'shape-1': pin }, null, ['shape-1']);
    expect(visible).toHaveLength(0);
  });
});
