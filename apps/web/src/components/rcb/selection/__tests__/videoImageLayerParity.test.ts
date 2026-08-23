import { describe, expect, it } from 'vitest';
import {
  nodeToSvgElement,
  previewSvgNodeGeometry,
  readScenePaintLocalSize,
  videoSvgOwnsPixels,
} from '../../scene/paint/sceneToSvg';

function svgRoot(attrs: Record<string, string>) {
  const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v);
  const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  root.appendChild(layer);
  return { root, layer };
}

function imageNode(box: { x: number; y: number; width: number; height: number }) {
  return {
    key: 'image',
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    attrs: { src: 'https://example.com/a.png' },
  };
}

function videoNode(box: { x: number; y: number; width: number; height: number }) {
  return {
    key: 'video',
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    attrs: {
      src: 'https://example.com/a.mp4',
      poster: 'https://example.com/poster.jpg',
    },
  };
}

function lottieGenNode(box: { x: number; y: number; width: number; height: number }) {
  return {
    key: 'lottie',
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    attrs: {
      animationData: '',
      lottieGenerator: true,
      assetKind: 'lottie',
    },
  };
}

const box = { x: 10, y: 20, width: 28, height: 38 };
const doc = { x: 0, y: 0, deltaSetLike: {} };

/**
 * Images are single-layer SVG. Videos also mount HTML <video> on the infinite
 * canvas — SVG must not paint a second visible bitmap or move leaves a ghost.
 */
describe('image vs video paint layers', () => {
  it('videoSvgOwnsPixels: world surface → HTML owns pixels', () => {
    const { root } = svgRoot({
      'data-rcb-infinite': '1',
      'data-rcb-shared-scene-surface': '1',
    });
    expect(videoSvgOwnsPixels(root)).toBe(false);
  });

  it('videoSvgOwnsPixels: export surface → SVG owns pixels', () => {
    const { root } = svgRoot({
      'data-rcb-infinite': '1',
      'data-rcb-export-surface': '1',
    });
    expect(videoSvgOwnsPixels(root)).toBe(true);
  });

  it('videoSvgOwnsPixels: private infinite host (no world flag) → HTML still mounts, SVG must not paint', () => {
    const { root } = svgRoot({ 'data-rcb-infinite': '1' });
    expect(videoSvgOwnsPixels(root)).toBe(false);
  });

  it('image on world surface paints one <image> (single layer, like today)', async () => {
    const { root, layer } = svgRoot({
      'data-rcb-infinite': '1',
      'data-rcb-shared-scene-surface': '1',
    });
    const el = await nodeToSvgElement(root, layer, doc, imageNode(box), 'img1');
    expect(el).toBeTruthy();
    expect(el!.querySelectorAll('image').length).toBe(1);
    // eslint-disable-next-line no-console
    console.log('[test:image-layer]', {
      images: el!.querySelectorAll('image').length,
      key: el!.getAttribute('data-scene-node-key'),
    });
  });

  it('video on world surface paints poster underlay (image-parity drag path)', async () => {
    const { root, layer } = svgRoot({
      'data-rcb-infinite': '1',
      'data-rcb-shared-scene-surface': '1',
    });
    const el = await nodeToSvgElement(root, layer, doc, videoNode(box), 'vid1');
    expect(el).toBeTruthy();
    expect(el!.getAttribute('data-scene-node-key')).toBe('video');
    // Poster underlay moves via previewSvgNodeGeometry; HTML covers while idle.
    expect(el!.querySelectorAll('image').length).toBe(1);
    expect(el!.querySelector('[data-rcb-video-svg-underlay="1"]')).toBeTruthy();
    expect(el!.querySelector('[data-baseline="1"],[data-rcb-video-html-hit="1"]')).toBeTruthy();
    // eslint-disable-next-line no-console
    console.log('[test:video-world-layer]', {
      images: el!.querySelectorAll('image').length,
      hit: Boolean(el!.querySelector('[data-baseline="1"],[data-rcb-video-html-hit="1"]')),
    });
  });

  it('video on private infinite host also paints poster underlay', async () => {
    const { root, layer } = svgRoot({ 'data-rcb-infinite': '1' });
    const el = await nodeToSvgElement(root, layer, doc, videoNode(box), 'vid2');
    expect(el).toBeTruthy();
    expect(el!.querySelectorAll('image').length).toBe(1);
    // eslint-disable-next-line no-console
    console.log('[test:video-private-host-layer]', {
      images: el!.querySelectorAll('image').length,
    });
  });

  it('video on export surface still paints poster <image>', async () => {
    const { root, layer } = svgRoot({
      'data-rcb-infinite': '1',
      'data-rcb-export-surface': '1',
    });
    const el = await nodeToSvgElement(root, layer, doc, videoNode(box), 'vid3');
    expect(el).toBeTruthy();
    expect(el!.querySelectorAll('image').length).toBe(1);
    // eslint-disable-next-line no-console
    console.log('[test:video-export-layer]', {
      images: el!.querySelectorAll('image').length,
    });
  });
});

describe('video move preview geom == HTML plate override', () => {
  it('previewSvgNodeGeometry updates __scene* to the same box VideoNodeOverlay must use', async () => {
    const { root, layer } = svgRoot({
      'data-rcb-infinite': '1',
      'data-rcb-shared-scene-surface': '1',
    });
    const node = videoNode(box);
    const el = await nodeToSvgElement(root, layer, doc, node, 'vid-move');
    expect(el).toBeTruthy();
    const nodeEls = new Map<string, SVGElement>([['vid-move', el!]]);
    const moved = { left: 50, top: 60, width: 28, height: 38 };
    expect(previewSvgNodeGeometry(nodeEls, 'vid-move', moved)).toBe(true);
    const anyEl = el as any;
    const svgGeom = {
      left: Number(anyEl.__sceneLeft),
      top: Number(anyEl.__sceneTop),
      width: Number(anyEl.sceneWidth),
      height: Number(anyEl.sceneHeight),
    };
    // Same numbers the HTML plate reads from geometryOverrides / publishVideoLiveGeom.
    const htmlOverride = { ...moved, angle: 0 };
    // eslint-disable-next-line no-console
    console.log('[test:video-move-geom]', { svgGeom, htmlOverride });
    expect(svgGeom).toEqual({
      left: htmlOverride.left,
      top: htmlOverride.top,
      width: htmlOverride.width,
      height: htmlOverride.height,
    });
  });

  it('lottie generator move keeps SVG geom on the same lattice as image/video', async () => {
    const { root, layer } = svgRoot({
      'data-rcb-infinite': '1',
      'data-rcb-shared-scene-surface': '1',
    });
    const node = lottieGenNode(box);
    const el = await nodeToSvgElement(root, layer, doc, node, 'lottie-gen-move');
    expect(el).toBeTruthy();
    const nodeEls = new Map<string, SVGElement>([['lottie-gen-move', el!]]);
    const moved = { left: 50, top: 60, width: 28, height: 38 };
    expect(previewSvgNodeGeometry(nodeEls, 'lottie-gen-move', moved)).toBe(true);
    const anyEl = el as any;
    expect({
      left: Number(anyEl.__sceneLeft),
      top: Number(anyEl.__sceneTop),
      width: Number(anyEl.sceneWidth),
      height: Number(anyEl.sceneHeight),
    }).toEqual(moved);
  });
});

describe('process glow local size during resize preview', () => {
  it('readScenePaintLocalSize keeps drag-base dims while preview scales the group', async () => {
    const { root, layer } = svgRoot({
      'data-rcb-infinite': '1',
      'data-rcb-shared-scene-surface': '1',
    });
    const node = {
      key: 'image',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      attrs: {
        processStatus: 'running',
        processKind: 'upload',
        processLabel: 'Uploading',
      },
    };
    const el = await nodeToSvgElement(root, layer, doc, node, 'img-upload');
    expect(el).toBeTruthy();
    const nodeEls = new Map<string, SVGElement>([['img-upload', el!]]);
    expect(previewSvgNodeGeometry(nodeEls, 'img-upload', { left: 0, top: 0, width: 160, height: 160 })).toBe(
      true
    );
    const local = readScenePaintLocalSize(el, { width: 160, height: 160 });
    expect(local).toEqual({ width: 160, height: 160 });
    const anyEl = el as any;
    expect(anyEl.__sceneDidResize).toBeFalsy();
    expect(el!.querySelector('image')).toBeNull();
  });
});
