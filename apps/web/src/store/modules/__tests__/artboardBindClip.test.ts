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

  it('appends a new 画板 as the highest world stack layer', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    const { id, node } = createShapeNode({
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      shapeType: 'rect',
      fill: '#fff',
    });
    doc = addNodeToDocument(doc, id, node);

    let state = reduceEditor(undefined, () => {});
    state = reduceEditor(state, editorReducers.createTemplate, {
      name: 'frame-stack-top',
      document: doc,
      emptyWorld: true,
      source: 'scratch',
    });
    const before = (state.document!.stackOrder || []).slice();
    expect(before[before.length - 1]).toBe(`node:${id}`);

    state = reduceEditor(state, editorReducers.addArtboardFrame, {
      x: 80,
      y: 80,
      width: 120,
      height: 120,
    });
    const frameId = state.selectedFrameIds[0];
    const order = state.document!.stackOrder || [];
    expect(order[order.length - 1]).toBe(`frame:${frameId}`);
  });

  it('appends 动画工作台 as the highest world stack layer', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    const { id, node } = createShapeNode({
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      shapeType: 'rect',
      fill: '#fff',
    });
    doc = addNodeToDocument(doc, id, node);

    let state = reduceEditor(undefined, () => {});
    state = reduceEditor(state, editorReducers.createTemplate, {
      name: 'anim-stack-top',
      document: doc,
      emptyWorld: true,
      source: 'scratch',
    });

    state = reduceEditor(state, editorReducers.spawnAnimationBoard, {
      x: 10,
      y: 10,
      width: 364,
      height: 364,
      skipHistory: true,
    });
    const frameId = state.selectedFrameIds[0];
    const order = state.document!.stackOrder || [];
    expect(order[order.length - 1]).toBe(`frame:${frameId}`);
  });
});
