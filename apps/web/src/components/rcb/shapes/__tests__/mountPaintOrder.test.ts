import { describe, expect, it } from 'vitest';
import { syncSharedMountPaintOrder } from '../shapeHostRegistry';

function layer(z: number, kind: 'shape' | 'frame' = 'shape') {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute(kind === 'frame' ? 'data-rcb-frame-layer' : 'data-rcb-shape-layer', '1');
  g.setAttribute('data-z', String(z));
  g.setAttribute('data-id', `${kind}-${z}`);
  return g;
}

describe('syncSharedMountPaintOrder', () => {
  it('no-ops when already sorted by data-z', () => {
    const mount = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const a = layer(1);
    const b = layer(2);
    const c = layer(3);
    mount.append(a, b, c);
    const before = [...mount.children];
    syncSharedMountPaintOrder(mount as SVGGElement);
    expect([...mount.children]).toEqual(before);
  });

  it('reorders when z is inverted', () => {
    const mount = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const a = layer(3);
    const b = layer(1);
    const c = layer(2);
    mount.append(a, b, c);
    syncSharedMountPaintOrder(mount as SVGGElement);
    expect(
      [...mount.children].map((el) => el.getAttribute('data-z'))
    ).toEqual(['1', '2', '3']);
  });
});
