import { describe, expect, it } from 'vitest';
import {
  frameIdFromEventTarget,
  isCanvasGestureTarget,
  isNodeTitleTarget,
  resolveContextMenuHit,
} from '../useCanvasContextMenu';

function el(tag: string, attrs: Record<string, string> = {}) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

describe('canvas context menu — node titles', () => {
  it('treats frame / image titles as canvas gesture targets', () => {
    const stage = el('div');
    const overlay = el('div', { 'data-rcb-overlay': '1' });
    const title = el('div', { 'data-frame-label': 'true', 'data-frame-id': 'f1' });
    overlay.appendChild(title);
    document.body.append(stage, overlay);

    expect(isNodeTitleTarget(title)).toBe(true);
    expect(isCanvasGestureTarget(stage, title)).toBe(true);
    expect(frameIdFromEventTarget(title)).toBe('f1');

    overlay.remove();
    stage.remove();
  });

  it('still blocks real overlay dialogs', () => {
    const stage = el('div');
    const dialog = el('div', { role: 'dialog' });
    const btn = el('button');
    dialog.appendChild(btn);
    document.body.append(stage, dialog);

    expect(isCanvasGestureTarget(stage, btn)).toBe(false);

    dialog.remove();
    stage.remove();
  });

  it('resolves image title node id via data-scene-node-id', () => {
    const title = el('div', {
      'data-image-label': 'true',
      'data-scene-node-id': 'img_1',
    });
    expect(isNodeTitleTarget(title)).toBe(true);
    expect(frameIdFromEventTarget(title)).toBeNull();
  });

  it('does not attach soft activeFrameId when the menu opens on a node', () => {
    const hit = resolveContextMenuHit({
      sceneX: 100,
      sceneY: 100,
      target: null,
      hitTest: () => 'circle_1',
      clientX: 0,
      clientY: 0,
      frames: [{ id: 'f1', x: 0, y: 0, width: 400, height: 400 }],
      selectedIds: ['circle_1'],
      activeFrameId: 'f1',
    });
    expect(hit).toEqual({ nodeId: 'circle_1', frameId: null });
  });

  it('treats __frame__: hit ids as artboard plates (not fake node ids)', () => {
    const hit = resolveContextMenuHit({
      sceneX: 100,
      sceneY: 100,
      target: null,
      hitTest: () => '__frame__:board_1',
      clientX: 0,
      clientY: 0,
      frames: [{ id: 'board_1', x: 0, y: 0, width: 400, height: 400 }],
      selectedIds: [],
      activeFrameId: null,
    });
    expect(hit).toEqual({ nodeId: null, frameId: 'board_1' });
  });
});
