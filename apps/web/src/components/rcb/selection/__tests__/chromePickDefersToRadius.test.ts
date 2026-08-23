/**
 * Chrome pick must not steal radius / shape overlay ink.
 * Pipeline (ADR 0027): overlay DOM → chrome **geometry** → DOM chrome.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  pickChromeHandleAtClient,
  pickOverlayHandleAtClient,
  pickSelectionInkAtClient,
} from '../SelectionChrome';

describe('pickChromeHandleAtClient vs radius ink', () => {
  let root: HTMLDivElement;
  let stack: Element[];

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    stack = [];
    document.elementsFromPoint = () => stack;
  });

  afterEach(() => {
    root.remove();
  });

  it('returns null when a radius handle is under the cursor', () => {
    const radius = document.createElement('div');
    radius.setAttribute('data-radius-handle', 'tr');
    Object.defineProperty(radius, 'getBoundingClientRect', {
      value: () => ({
        left: 100,
        top: 100,
        right: 120,
        bottom: 120,
        width: 20,
        height: 20,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      }),
    });
    root.appendChild(radius);

    const knob = document.createElement('div');
    knob.setAttribute('data-rcb-sel-knob', 'ne');
    Object.defineProperty(knob, 'getBoundingClientRect', {
      value: () => ({
        left: 90,
        top: 90,
        right: 110,
        bottom: 110,
        width: 20,
        height: 20,
        x: 90,
        y: 90,
        toJSON: () => ({}),
      }),
    });
    root.appendChild(knob);
    stack = [radius, knob];

    expect(pickOverlayHandleAtClient(110, 110, radius)?.kind).toBe('radius');
    expect(
      pickChromeHandleAtClient(110, 110, radius, {
        showHandles: true,
        showRotate: true,
        box: { left: 0, top: 0, width: 200, height: 200 },
        zoom: 2,
        clientToScene: (x, y) => ({ x, y }),
      })
    ).toBeNull();
    expect(
      pickSelectionInkAtClient(110, 110, knob, {
        showHandles: true,
        showRotate: true,
        box: { left: 0, top: 0, width: 200, height: 200 },
        zoom: 2,
        clientToScene: (x, y) => ({ x, y }),
      })
    ).toEqual(expect.objectContaining({ layer: 'overlay' }));
  });

  it('hits chrome via scene geometry even without DOM knob ink', () => {
    stack = [];
    const pick = pickChromeHandleAtClient(200, 0, null, {
      showHandles: true,
      showRotate: true,
      box: { left: 0, top: 0, width: 200, height: 200 },
      zoom: 1,
      clientToScene: (x, y) => ({ x, y }),
    });
    expect(pick).toEqual(
      expect.objectContaining({ kind: 'resize', handle: 'ne' })
    );
  });

  it('does not claim chrome in the empty interior of the box', () => {
    stack = [];
    const pick = pickChromeHandleAtClient(100, 100, null, {
      showHandles: true,
      showRotate: true,
      box: { left: 0, top: 0, width: 200, height: 200 },
      zoom: 1,
      clientToScene: (x, y) => ({ x, y }),
    });
    expect(pick).toBeNull();
  });
});
