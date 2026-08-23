import { describe, expect, it } from 'vitest';
import { applyFrameContentClip } from '../frameContentClip';

describe('frame content clipping', () => {
  it('clips the untransformed paint layer and clears when the node leaves the frame', () => {
    const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    layer.setAttribute('data-rcb-shape-id', 'n1');
    layer.setAttribute('data-rcb-shape-layer', '1');
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    root.append(layer);
    layer.append(node);

    const frame = {
      id: 'frame-1',
      name: 'Frame',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      clipContent: true,
      hidden: false,
      backgroundColor: '#fff',
    };

    applyFrameContentClip(
      root,
      node,
      { frames: [frame] },
      {
        x: 120,
        y: 120,
        width: 40,
        height: 40,
        attrs: { frameId: 'frame-1' },
      }
    );
    expect(node.parentElement).toBe(layer);
    expect(root.querySelector('[data-frame-clip-wrap="1"]')).toBeNull();
    expect(layer.getAttribute('clip-path') || '').toContain('url(');
    expect(node.hasAttribute('clip-path')).toBe(false);

    applyFrameContentClip(
      root,
      node,
      { frames: [frame] },
      {
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        attrs: { frameId: 'frame-1' },
      }
    );

    expect(node.parentElement).toBe(layer);
    expect(layer.hasAttribute('clip-path')).toBe(false);
    expect(node.hasAttribute('clip-path')).toBe(false);
    expect(root.querySelector('[data-frame-clip-wrap="1"]')).toBeNull();
  });

  it('unwraps a legacy clip wrap so mix-blend-mode can composite again', () => {
    const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    layer.setAttribute('data-rcb-shape-id', 'n1');
    const wrap = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    wrap.setAttribute('data-frame-clip-wrap', '1');
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    root.append(layer);
    layer.append(wrap);
    wrap.append(node);

    const frame = {
      id: 'frame-1',
      name: 'Frame',
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      clipContent: true,
      hidden: false,
      backgroundColor: '#fff',
    };

    applyFrameContentClip(
      root,
      node,
      { frames: [frame] },
      {
        x: 10,
        y: 10,
        width: 40,
        height: 40,
        attrs: { frameId: 'frame-1' },
      }
    );

    expect(node.parentElement).toBe(layer);
    expect(root.querySelector('[data-frame-clip-wrap="1"]')).toBeNull();
    expect(layer.getAttribute('clip-path') || '').toContain('url(');
  });
});
