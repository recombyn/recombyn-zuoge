import { describe, expect, it } from 'vitest';
import { nodeToSvgElement } from '../sceneToSvg';

function svgRoot() {
  const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  root.appendChild(layer);
  document.body.appendChild(root);
  return { root, layer };
}

describe('node SVG effects', () => {
  it.each(['line', 'arrow', 'pen', 'path', 'pencil'])(
    'applies effects to %s paint',
    async (shapeType) => {
      const { root, layer } = svgRoot();
      const node = {
        key: 'shape',
        x: 0,
        y: 0,
        width: 80,
        height: 32,
        attrs: {
          shapeType,
          path: 'M0 16 L80 16',
          'border-color': '#222222',
          'border-width': 2,
          'shadow-enabled': true,
          'shadow-visible': true,
          'inner-shadow-enabled': true,
          'inner-shadow-visible': true,
          'backdrop-blur-enabled': true,
          'backdrop-blur-amount': 12,
          'backdrop-blur-brightness': 125,
        },
      };

      const el = await nodeToSvgElement(root, layer, { x: 0, y: 0, deltaSetLike: {} } as any, node as any, shapeType);

      expect(el).toBeTruthy();
      expect(el!.style.filter).toContain('url(');
      expect(el!.style.getPropertyValue('backdrop-filter')).toBe('blur(12px) brightness(125%)');
      expect(root.querySelector('filter feDropShadow')).toBeTruthy();
      expect(root.querySelector('filter [result="innerShadow"]')).toBeTruthy();
      root.remove();
    }
  );

  it('does not paint zero-geometry shadows', async () => {
    const { root, layer } = svgRoot();
    const node = {
      key: 'shape',
      x: 0,
      y: 0,
      width: 80,
      height: 32,
      attrs: {
        shapeType: 'rect',
        'fill-color': '#fff',
        'shadow-enabled': true,
        'shadow-visible': true,
        'shadow-x': 0,
        'shadow-y': 0,
        'shadow-blur': 0,
        'inner-shadow-enabled': true,
        'inner-shadow-visible': true,
        'inner-shadow-x': 0,
        'inner-shadow-y': 0,
        'inner-shadow-blur': 0,
        'backdrop-blur-enabled': true,
        'backdrop-blur-amount': 0,
        'backdrop-blur-brightness': 0,
      },
    };

    const el = await nodeToSvgElement(root, layer, { x: 0, y: 0, deltaSetLike: {} } as any, node as any, 'rect');

    expect(el).toBeTruthy();
    expect(el!.style.filter).toBe('');
    expect(root.querySelector('filter')).toBeNull();
    root.remove();
  });
});
