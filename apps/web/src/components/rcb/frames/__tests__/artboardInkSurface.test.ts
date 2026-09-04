import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  addNodeToDocument,
} from '@/components/rcb/scene/document/sceneDocument';
import {
  createSceneRenderBuffer,
  syncSceneRenderBufferFromDocument,
  SOA_FLAG_CANVAS_IDLE,
} from '@/components/rcb/render/sceneRenderBuffer';
import { collectSoaWebglInstances } from '@/components/rcb/render/webglSceneRenderer';
import { soaSlotIsFrameBound } from '@/components/rcb/frames/artboardInkSurface';

describe('artboard small-canvas SoA partition', () => {
  it('skipFrameBound omits plate-bound idle slots from world collect', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc.frames = [
      {
        id: 'board',
        name: 'A',
        backgroundColor: '#fff',
        x: 0,
        y: 0,
        width: 200,
        height: 200,
      },
    ];
    doc = addNodeToDocument(doc, 'world', {
      id: 'world',
      key: 'shape',
      x: 300,
      y: 0,
      width: 20,
      height: 20,
      attrs: { shapeType: 'rect', fill: '#f00', 'stroke-enabled': false },
      children: [],
    });
    doc = addNodeToDocument(doc, 'bound', {
      id: 'bound',
      key: 'shape',
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      attrs: {
        shapeType: 'rect',
        fill: '#0f0',
        'stroke-enabled': false,
        frameId: 'board',
      },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    for (let i = 0; i < buf.count; i += 1) {
      buf.flags[i] = (buf.flags[i] | SOA_FLAG_CANVAS_IDLE) >>> 0;
    }
    const boundIdx = buf.indexById.get('bound')!;
    expect(soaSlotIsFrameBound(buf, boundIdx, doc)).toBe(true);

    const kinds: number[] = [];
    collectSoaWebglInstances(
      buf,
      { x: 0, y: 0, width: 800, height: 600 },
      [],
      [],
      kinds,
      [],
      [],
      { document: doc, skipFrameBound: true }
    );
    // Only the unbound world rect (kind 0, stroke disabled).
    expect(kinds).toEqual([0]);
  });
});
