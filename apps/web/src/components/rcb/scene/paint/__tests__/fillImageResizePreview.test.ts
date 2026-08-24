import { describe, expect, it } from 'vitest';
import { nodeToSvgElement, previewSvgNodeGeometry } from '../sceneToSvg';

function svgRoot() {
  const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  root.setAttribute('data-rcb-infinite', '1');
  const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  root.appendChild(layer);
  return { root, layer };
}

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('fill image resize preview', () => {
  it('scales the paint group instead of regen path while pattern fill is active', async () => {
    const { root, layer } = svgRoot();
    const doc = {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      deltaSetLike: {},
    };
    const node = {
      key: 'shape',
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      attrs: {
        shapeType: 'rect',
        'fill-type': 'image',
        'fill-image-src': PNG_1PX,
        'fill-image-fit': 'fill',
      },
    };
    const el = await nodeToSvgElement(root, layer, doc as any, node, 'shape-img');
    expect(el).toBeTruthy();
    const body = el!.querySelector('[data-baseline="1"]') as SVGPathElement | null;
    expect(body).toBeTruthy();
    const baseD = body!.getAttribute('d') || '';

    const nodeEls = new Map<string, SVGElement>([['shape-img', el!]]);
    expect(
      previewSvgNodeGeometry(nodeEls, 'shape-img', {
        left: 10,
        top: 20,
        width: 200,
        height: 160,
      })
    ).toBe(true);

    expect(body!.getAttribute('d')).toBe(baseD);
    expect(el!.getAttribute('transform') || '').toMatch(/scale\(/);
    expect((el as any).__sceneDidResize).toBe(true);
  });
});
