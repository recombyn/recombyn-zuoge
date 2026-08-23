import { describe, expect, it } from 'vitest';
import editorReducer, {
  clearImageMarkPin,
  enqueueQuickEditMarkContexts,
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

describe('imageMarkPins reducer', () => {
  it('stores one pin per image node', () => {
    const state = editorReducer(undefined, setImageMarkPin(pin));
    expect(state.imageMarkPins['img-1']).toEqual(pin);

    const replaced = editorReducer(
      state,
      setImageMarkPin({ ...pin, id: 'pin-2', x: 50 })
    );
    expect(replaced.imageMarkPins['img-1']?.id).toBe('pin-2');
    expect(Object.keys(replaced.imageMarkPins)).toHaveLength(1);
  });

  it('clears pin for a node', () => {
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
