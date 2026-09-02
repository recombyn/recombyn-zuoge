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

  it('interleaves plates and hosts on one mount by data-z', () => {
    const mount = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const plateB = layer(200000, 'frame');
    const hostA = layer(100001, 'shape');
    const plateA = layer(100000, 'frame');
    const hostB = layer(200001, 'shape');
    mount.append(plateB, hostA, plateA, hostB);
    syncSharedMountPaintOrder(mount as SVGGElement);
    expect(
      [...mount.children].map((el) => el.getAttribute('data-id'))
    ).toEqual(['frame-100000', 'shape-100001', 'frame-200000', 'shape-200001']);
  });
});
