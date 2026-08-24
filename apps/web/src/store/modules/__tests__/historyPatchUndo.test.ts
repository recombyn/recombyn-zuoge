import { describe, expect, it } from 'vitest';
import reducer, {
  createTemplate,
  patchDocumentNode,
  undo,
  redo,
  startImageUploadPlaceholder,
  cancelImportPlaceholder,
  startImageProcess,
  finishImageProcess,
  removeDocumentNodes,
} from '@/store/modules/editor';
import {
  createEmptyDocument,
  addNodeToDocument
} from '@/components/rcb/scene/document/sceneDocument';
import {
  createShapeNode,
  createImageNode,
} from '@/components/rcb/scene/document/nodeFactories';

function seedWithPathNode() {
  let doc = createEmptyDocument({ emptyWorld: true });
  const heavyPath = `M 0 0 ${'L 1 1 '.repeat(2000)}Z`;
  const { id, node } = createShapeNode({
    x: 10,
    y: 20,
    width: 80,
    height: 60,
    shapeType: 'path',
    path: heavyPath,
    fill: '#ff0000',
  });
  doc = addNodeToDocument(doc, id, node);
  let state = reducer(undefined, { type: '@@INIT' } as any);
  state = reducer(
    state,
    createTemplate({ name: 't', document: doc, emptyWorld: true, source: 'scratch' })
  );
  return { state, id, heavyPath };
}

function seedWithImageNode() {
  let doc = createEmptyDocument({ emptyWorld: true });
  const { id, node } = createImageNode({
    x: 10,
    y: 20,
    width: 80,
    height: 60,
    src: 'https://cdn.example/source.png',
  });
  doc = addNodeToDocument(doc, id, node);
  let state = reducer(undefined, { type: '@@INIT' } as any);
  state = reducer(
    state,
    createTemplate({ name: 'image', document: doc, emptyWorld: true, source: 'scratch' })
  );
  return { state, id };
}

describe('patch undo history', () => {
  it('stores node patches (not full snaps) and restores attrs', () => {
    const { state: s0, id, heavyPath } = seedWithPathNode();
    const pathRef = s0.document.deltaSetLike[id].attrs.path;
    expect(pathRef).toBe(heavyPath);

    const s1 = reducer(
      s0,
      patchDocumentNode({
        nodeId: id,
        patch: { attrs: { 'fill-color': '#00ff00' } },
      })
    );
    expect(s1.document.deltaSetLike[id].attrs['fill-color']).toBe('#00ff00');
    expect(s1.historyPast).toHaveLength(1);
    const past0 = s1.historyPast[0];
    expect(past0.kind).toBe('nodes');
    if (past0.kind !== 'nodes') throw new Error('expected nodes history');
    expect(past0.before[id].attrs.path).toBe(pathRef);

    const s2 = reducer(s1, undo());
    expect(s2.document.deltaSetLike[id].attrs['fill-color']).toBe('#ff0000');
    expect(s2.lastPatchedNodeIds).toEqual([id]);
    // Node-patch undo must not force a full scene remount.
    expect(s2.sceneReloadToken).toBe(s1.sceneReloadToken);

    const s3 = reducer(s2, redo());
    expect(s3.document.deltaSetLike[id].attrs['fill-color']).toBe('#00ff00');
  });

  it('does not add an upload placeholder to undo history', () => {
    const { state: s0 } = seedWithPathNode();
    const s1 = reducer(
      s0,
      startImageUploadPlaceholder({
        src: 'blob:upload-preview',
        width: 120,
        height: 80,
        x: 30,
        y: 40,
      })
    );

    expect(s1.historyPast).toHaveLength(0);
    expect(s1.pendingImageProcessId).toBeTruthy();
  });

  it('does not resurrect a cancelled import placeholder through undo', () => {
    const { state: s0 } = seedWithPathNode();
    const started = reducer(
      s0,
      {
        type: 'editor/startImportPlaceholder',
        payload: { label: '导入中', width: 120, height: 80, x: 30, y: 40 },
      } as any
    );
    const placeholderId = started.pendingImportPlaceholderId;
    expect(placeholderId).toBeTruthy();

    const cancelled = reducer(started, cancelImportPlaceholder());
    const undone = reducer(cancelled, undo());

    expect(undone.document.deltaSetLike[placeholderId]).toBeUndefined();
    expect(undone.historyPast).toHaveLength(0);
  });

  it('allows deleting an in-flight upload placeholder', () => {
    const { state: s0 } = seedWithPathNode();
    const started = reducer(
      s0,
      startImageUploadPlaceholder({
        src: 'blob:upload-preview',
        width: 120,
        height: 80,
        x: 30,
        y: 40,
      })
    );
    const placeholderId = started.pendingImageProcessId as string;
    const deleted = reducer(started, removeDocumentNodes({ nodeIds: [placeholderId] }));

    expect(deleted.document.deltaSetLike[placeholderId]).toBeUndefined();
    expect(deleted.pendingImageProcessId).toBeNull();
  });

  it('records one undo step for a completed upload, excluding the placeholder', () => {
    const { state: s0 } = seedWithPathNode();
    const started = reducer(
      s0,
      startImageUploadPlaceholder({
        src: 'blob:upload-preview',
        width: 120,
        height: 80,
        x: 30,
        y: 40,
      })
    );
    const nodeId = started.pendingImageProcessId as string;
    const finished = reducer(
      started,
      finishImageProcess({
        nodeId,
        src: 'https://cdn.example/image.png',
      })
    );

    expect(finished.historyPast).toHaveLength(1);
    expect(finished.document.deltaSetLike[nodeId].attrs.src).toBe(
      'https://cdn.example/image.png'
    );

    const undone = reducer(finished, undo());
    expect(undone.document.deltaSetLike[nodeId]).toBeUndefined();
  });

  it('does not record process placeholder creation, but completion is undoable once', () => {
    const { state: s0, id: sourceId } = seedWithImageNode();
    const started = reducer(
      s0,
      startImageProcess({ sourceId, kind: 'upscale', label: '处理中' })
    );
    const processId = started.pendingImageProcessId as string;
    expect(started.historyPast).toHaveLength(0);

    const finished = reducer(
      started,
      finishImageProcess({ nodeId: processId, src: 'https://cdn.example/upscaled.png' })
    );
    expect(finished.historyPast).toHaveLength(1);
    expect(reducer(finished, undo()).document.deltaSetLike[processId]).toBeUndefined();
  });

  it('does not record pure loading-state patches', () => {
    const { state: s0, id } = seedWithImageNode();
    const started = reducer(
      s0,
      patchDocumentNode({
        nodeId: id,
        patch: {
          attrs: {
            processStatus: 'running',
            processKind: 'quickEdit',
            processLabel: '处理中',
          },
        },
      })
    );

    expect(started.historyPast).toHaveLength(0);
    expect(started.document.deltaSetLike[id].attrs.processStatus).toBe('running');
  });
});
