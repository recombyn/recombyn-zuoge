/**
 * ADR 0027 pointer pipeline: overlay geometry → geometry chrome → (DOM fallback).
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  clearChromeKnobHits,
  pickSelectionInkAtClient,
  setChromeKnobHits,
} from '../SelectionChrome';

describe('selection pointer hit order', () => {
  let stack: Element[];

  beforeEach(() => {
    stack = [];
    document.elementsFromPoint = () => stack;
    clearChromeKnobHits('test-radius');
  });

  afterEach(() => {
    stack = [];
    clearChromeKnobHits('test-radius');
  });

  it('prefers overlay seat over geometry chrome at the same client point', () => {
    const radius = document.createElement('div');
    radius.setAttribute('data-radius-handle', 'tl');
    stack = [radius];
    const ink = pickSelectionInkAtClient(0, 0, radius, {
      showHandles: true,
      showRotate: true,
      box: { left: 0, top: 0, width: 100, height: 100 },
      zoom: 1,
      scene: { x: 0, y: 0 },
    });
    expect(ink).toEqual(
      expect.objectContaining({
        layer: 'overlay',
        pick: expect.objectContaining({ kind: 'radius' }),
      })
    );
  });

  it('hits radius overlay via scene knob registry without DOM stack', () => {
    stack = [];
    setChromeKnobHits('test-radius', [
      {
        ownerId: 'test-radius',
        kind: 'radius',
        key: 'radius-tr',
        x: 100,
        y: 0,
        half: 12,
      },
    ]);
    const ink = pickSelectionInkAtClient(100, 0, null, {
      showHandles: true,
      showRotate: true,
      box: { left: 0, top: 0, width: 100, height: 80 },
      zoom: 2,
      scene: { x: 100, y: 0 },
    });
    expect(ink).toEqual(
      expect.objectContaining({
        layer: 'overlay',
        pick: expect.objectContaining({ kind: 'radius', key: 'radius-tr' }),
      })
    );
  });

  it('uses geometry chrome when overlay stack is empty', () => {
    stack = [];
    const ink = pickSelectionInkAtClient(100, 0, null, {
      showHandles: true,
      showRotate: true,
      box: { left: 0, top: 0, width: 100, height: 80 },
      zoom: 2,
      scene: { x: 100, y: 0 },
    });
    expect(ink).toEqual(
      expect.objectContaining({
        layer: 'chrome',
        pick: expect.objectContaining({ kind: 'resize', handle: 'ne' }),
      })
    );
  });
});
