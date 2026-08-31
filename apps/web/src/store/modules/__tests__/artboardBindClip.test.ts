import { describe, expect, it } from 'vitest';
import {
  editorReducers,
  reduceEditor,
  addArtboardFrame,
  createTemplate,
} from '@/store/modules/editor';
import { createEmptyDocument, addNodeToDocument } from '@/components/rcb/scene/document/sceneDocument';
import { createShapeNode } from '@/components/rcb/scene/document/nodeFactories';
import { findClippingFrameForNode } from '@/components/rcb/frames/frameContentClip';

describe('addArtboardFrame bind+clip', () => {
  it('binds overlapping unowned nodes and enables clip ownership on draw', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    const { id, node } = createShapeNode({
      x: 40,
      y: 40,
      width: 200,
      height: 80,
      shapeType: 'rect',
      fill: '#fff',
    });
    doc = addNodeToDocument(doc, id, node);

    let state = reduceEditor(undefined, () => {});
    state = reduceEditor(state, editorReducers.createTemplate, {
        name: 'frame-bind-clip',
        document: doc,
        emptyWorld: true,
        source: 'scratch',
      });

    state = reduceEditor(state, editorReducers.addArtboardFrame, { x: 20, y: 20, width: 120, height: 120 });

    const frameId = state.selectedFrameIds[0];
    expect(frameId).toBeTruthy();
    const bound = state.document!.deltaSetLike[id];
    expect(bound.attrs?.frameId).toBe(frameId);
    expect(state.document!.frames.find((f) => f.id === frameId)?.clipContent).toBe(true);

    const clipOwner = findClippingFrameForNode(state.document!, bound);
    expect(clipOwner?.id).toBe(frameId);
  });
});
