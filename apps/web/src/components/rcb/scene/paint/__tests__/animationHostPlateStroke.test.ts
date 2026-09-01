import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { nodeToSvgElement } from '@/components/rcb/scene/paint/sceneToSvg';
import { createEmptyDocument, normalizeDocument } from '@/components/rcb/scene/document/sceneDocument';
import { addNodeToDocument } from '@/components/rcb/scene/document/sceneDocument';
import type { SceneDocument } from '@/components/rcb/sceneNode';

function svgRoot() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const doc = dom.window.document;
  const root = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const layer = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
  root.appendChild(layer);
  doc.body.appendChild(root);
  return { root, layer };
}

function animHostDoc(): { doc: SceneDocument; hostId: string } {
  let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
  doc = {
    ...doc,
    frames: [
      {
        id: 'wb',
        kind: 'animation',
        name: '动画',
        x: 40,
        y: 40,
        width: 364,
        height: 364,
        backgroundColor: '#FFFFFF',
        clipContent: true,
      },
    ],
  } as SceneDocument;
  const hostId = 'host1';
  doc = addNodeToDocument(doc, hostId, {
    id: hostId,
    key: 'lottie',
    x: 0,
    y: 0,
    width: 364,
    height: 364,
    attrs: {
      animationFrameHost: true,
      frameId: 'wb',
      animationData: '',
      name: 'Host',
    },
    children: [],
  });
  return { doc: normalizeDocument(doc), hostId };
}

describe('animation workbench host plate stroke', () => {
  it('empty frame host does not paint a second hairline on top of the artboard', async () => {
    const { root, layer } = svgRoot();
    const { doc, hostId } = animHostDoc();
    const node = doc.deltaSetLike?.[hostId];
    expect(node).toBeTruthy();
    const el = await nodeToSvgElement(root, layer, doc, node!, hostId);
    const plate = el.querySelector('[data-baseline="1"]');
    expect(plate).toBeTruthy();
    const stroke = plate?.getAttribute('stroke') || '';
    expect(stroke === 'none' || stroke === '').toBe(true);
  });
});
