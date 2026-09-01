import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addNodeToDocument,
  createEmptyDocument,
  normalizeDocument,
} from '@/components/rcb/scene/document/sceneDocument';
import { createCanvasSession } from '@/components/editor/canvas/canvasSession';
import {
  clearLiveArtboardFrameGeometry,
  previewArtboardFrameGeometry,
  subscribeLiveArtboardFrameGeometry,
} from '@/components/rcb/frames/HtmlArtboardFrame';
import { SceneSpatialRuntime } from '@/components/rcb/core/spatialIndex';
import { frameSelId } from '@/components/rcb/selection/frameSelectionIds';
import type { SceneDocument } from '@/components/rcb/sceneNode';

function workbenchDoc(childCount: number): SceneDocument {
  let doc = createEmptyDocument({ width: 4000, height: 4000, emptyWorld: true });
  doc = {
    ...doc,
    frames: [
      {
        id: 'wb',
        kind: 'animation',
        name: '动画',
        x: 100,
        y: 100,
        width: 800,
        height: 600,
        clipContent: true,
      },
    ],
  } as SceneDocument;
  for (let i = 0; i < childCount; i += 1) {
    const id = `c${i}`;
    doc = addNodeToDocument(doc, id, {
      id,
      key: 'shape',
      x: (i % 20) * 30,
      y: Math.floor(i / 20) * 30,
      width: 24,
      height: 24,
      attrs: {
        shapeType: 'rect',
        frameId: 'wb',
        'fill-color': '#336699',
        'fill-enabled': 'true',
      },
      children: [],
    });
  }
  return normalizeDocument(doc);
}

describe('animation workbench plate drag cost', () => {
  afterEach(() => {
    clearLiveArtboardFrameGeometry();
  });

  it('frameLocal plate preview does not spatial-patch every bound child each move', () => {
    const doc = workbenchDoc(200);
    expect(doc.coordSpace).toBe('frameLocal');
    let localDoc: SceneDocument = doc;
    const spatial = new SceneSpatialRuntime(64);
    spatial.sync({
      document: doc,
      childrenIds: (doc.deltaSetLike?.ROOT?.children as string[]) || [],
    });
    const patchSpy = vi.spyOn(spatial, 'patchNodes');
    const board = {
      root: null as SVGSVGElement | null,
      nodeEls: new Map<string, SVGElement>(),
    };
    const session = createCanvasSession({
      getDocument: () => localDoc,
      getCommittedDocument: () => doc,
      setDocumentLocal: (next) => {
        localDoc = next;
      },
      getBoard: () => board,
      getZoom: () => 1,
      isReadOnly: () => false,
      spatial,
      setEditingTextId: () => undefined,
      measureViewport: () => null,
      getDragWriteCoalescer: () => ({
        getPendingVideoGeom: () => null,
        queueVideoGeom: () => undefined,
        cancel: () => undefined,
      }),
      previewFrameGeometry: (frames) => {
        frames.forEach((f) => previewArtboardFrameGeometry(f));
      },
      clearFrameGeometryPreview: () => clearLiveArtboardFrameGeometry(),
      publishVideoLiveGeom: () => undefined,
      clearVideoLiveGeom: () => undefined,
    });

    const childXBefore = Number(localDoc.deltaSetLike?.c0?.x);
    for (let step = 0; step < 40; step += 1) {
      session.onGeometryPreview([
        {
          nodeId: frameSelId('wb'),
          left: 100 + step * 3,
          top: 100 + step * 2,
          width: 800,
          height: 600,
        },
      ]);
    }
    expect(Number(localDoc.deltaSetLike?.c0?.x)).toBe(childXBefore);
    // Plate-only frameLocal path must not touch spatial for 200 children × 40 moves.
    expect(patchSpy.mock.calls.length).toBe(0);
    patchSpy.mockRestore();
  });

  it('live artboard notify stays O(moves) not O(children×moves)', () => {
    const spy = vi.fn();
    const unsub = subscribeLiveArtboardFrameGeometry(spy);
    for (let step = 0; step < 30; step += 1) {
      previewArtboardFrameGeometry({
        id: 'wb',
        x: 100 + step,
        y: 100,
        width: 800,
        height: 600,
      });
    }
    expect(spy.mock.calls.length).toBe(30);
    unsub();
  });
});
