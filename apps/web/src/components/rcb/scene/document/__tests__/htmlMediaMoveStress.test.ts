/**
 * Stress: video / lottie / audio FO mounts survive repeated move previews
 * (regression for globally hiding HTML while transforming).
 */
import { describe, expect, it } from 'vitest';
import {
  findHtmlMediaMount,
  nodeToSvgElement,
  previewSvgNodeGeometry,
} from '@/components/rcb/scene/paint/sceneToSvg';

function svgRoot() {
  const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  root.setAttribute('data-rcb-infinite', '1');
  root.setAttribute('data-rcb-shared-scene-surface', '1');
  const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  root.appendChild(layer);
  document.body.appendChild(root);
  return { root, layer };
}

const SAMPLE_LOTTIE = JSON.stringify({
  v: '5.7.4',
  fr: 30,
  ip: 0,
  op: 30,
  w: 100,
  h: 100,
  nm: 'pulse',
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: 'dot',
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [50, 50, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 0, k: [100, 100, 100] },
      },
      ao: 0,
      shapes: [
        { ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [40, 40] } },
        { ty: 'fl', c: { a: 0, k: [1, 0.2, 0.3, 1] } },
      ],
      ip: 0,
      op: 30,
      st: 0,
      bm: 0,
    },
  ],
});

describe('html media move stress (video / lottie / audio)', () => {
  it('keeps FO mounts findable across many interleaved move previews', async () => {
    const { root, layer } = svgRoot();
    const doc = { x: 0, y: 0, deltaSetLike: {} };
    const specs = [
      {
        id: 'vid-stress',
        kind: 'video' as const,
        node: {
          key: 'video',
          x: 0,
          y: 0,
          width: 120,
          height: 80,
          attrs: {
            src: 'https://example.com/a.mp4',
            poster: 'https://example.com/p.jpg',
          },
        },
      },
      {
        id: 'lot-stress',
        kind: 'lottie' as const,
        node: {
          key: 'lottie',
          x: 140,
          y: 0,
          width: 100,
          height: 100,
          attrs: { animationData: SAMPLE_LOTTIE, 'fill-color': 'transparent' },
        },
      },
      {
        id: 'aud-stress',
        kind: 'audio' as const,
        node: {
          key: 'audio',
          x: 260,
          y: 0,
          width: 220,
          height: 96,
          attrs: { src: 'https://example.com/a.mp3' },
        },
      },
    ];

    const nodeEls = new Map<string, SVGElement>();
    for (const s of specs) {
      const el = await nodeToSvgElement(root, layer, doc, s.node, s.id);
      expect(el).toBeTruthy();
      nodeEls.set(s.id, el!);
      expect(el!.querySelector(`foreignObject[data-rcb-html-media-fo="${s.kind}"]`)).toBeTruthy();
      expect(findHtmlMediaMount(s.id)).toBeTruthy();
    }

    // Interleave many moves (image-drag style: only some ids move each tick).
    for (let i = 0; i < 80; i += 1) {
      const s = specs[i % specs.length]!;
      const box = {
        left: 10 + (i % 17) * 3,
        top: 20 + (i % 11) * 2,
        width: Number(s.node.width),
        height: Number(s.node.height),
      };
      expect(previewSvgNodeGeometry(nodeEls, s.id, box)).toBe(true);
      // Mount must remain — HTML ink is not torn down mid-gesture.
      expect(findHtmlMediaMount(s.id)).toBeTruthy();
      for (const other of specs) {
        expect(findHtmlMediaMount(other.id)).toBeTruthy();
      }
    }

    root.remove();
  });
});
