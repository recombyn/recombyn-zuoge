import { describe, expect, it } from 'vitest';
import editorReducer, {
  clearImageMarkPin,
  enqueueQuickEditMarkContexts,
  removeImageMarkPin,
  setImageMarkPin,
  type ImageMarkPin,
} from '@/store/modules/editor';

const pin: ImageMarkPin = {
  nodeId: 'img-1',
  id: 'pin-1',
  index: 1,
  x: 10,
  y: 20,
  w: 100,
  h: 80,
  kind: 'manual',
  label: '1 区域',
  sink: 'quickEdit',
};

const pin2: ImageMarkPin = {
  ...pin,
  id: 'pin-2',
  index: 2,
  x: 50,
  y: 60,
  label: '2 区域',
};

describe('imageMarkPins reducer', () => {
  it('stores multiple pins per image node', () => {
    const state = editorReducer(undefined, setImageMarkPin(pin));
    expect(state.imageMarkPins['img-1']).toEqual([pin]);

    const withTwo = editorReducer(state, setImageMarkPin(pin2));
    expect(withTwo.imageMarkPins['img-1']).toHaveLength(2);
    expect(withTwo.imageMarkPins['img-1']?.[1]?.id).toBe('pin-2');
  });

  it('removes one pin by id', () => {
    const withTwo = editorReducer(editorReducer(undefined, setImageMarkPin(pin)), setImageMarkPin(pin2));
    const next = editorReducer(withTwo, removeImageMarkPin({ nodeId: 'img-1', pinId: 'pin-1' }));
    expect(next.imageMarkPins['img-1']).toEqual([pin2]);
  });

  it('clears all pins for a node', () => {
    const withPin = editorReducer(undefined, setImageMarkPin(pin));
    const cleared = editorReducer(withPin, clearImageMarkPin('img-1'));
    expect(cleared.imageMarkPins['img-1']).toBeUndefined();
  });
});

describe('pendingQuickEditMarkContexts reducer', () => {
  it('queues mark chips without image thumbs', () => {
    const chip = {
      key: 'mark:img-1:r1:1',
      label: '[1] 区域',
      kind: 'image',
      payload: 'region payload',
      appendText: ' hello',
    };
    const state = editorReducer(undefined, enqueueQuickEditMarkContexts([chip]));
    expect(state.pendingQuickEditMarkContexts).toEqual([chip]);
    expect(state.pendingQuickEditMarkContexts[0]?.dataUrl).toBeUndefined();
    expect(state.pendingQuickEditMarkContexts[0]?.thumbUrl).toBeUndefined();
  });
});
