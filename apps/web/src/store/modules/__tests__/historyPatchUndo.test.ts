import { describe, expect, it } from 'vitest';
import {
  editorReducers,
  reduceEditor,
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
  let state = reduceEditor(undefined, () => {});
  state = reduceEditor(state, editorReducers.createTemplate, { name: 't', document: doc, emptyWorld: true, source: 'scratch' });
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
  let state = reduceEditor(undefined, () => {});
  state = reduceEditor(state, editorReducers.createTemplate, { name: 'image', document: doc, emptyWorld: true, source: 'scratch' });
  return { state, id };
}

describe('patch undo history', () => {
  it('stores node patches (not full snaps) and restores attrs', () => {
    const { state: s0, id, heavyPath } = seedWithPathNode();
    const pathRef = s0.document.deltaSetLike[id].attrs.path;
    expect(pathRef).toBe(heavyPath);

    const s1 = reduceEditor(s0, editorReducers.patchDocumentNode, {
        nodeId: id,
        patch: { attrs: { 'fill-color': '#00ff00' } },
      });
    expect(s1.document.deltaSetLike[id].attrs['fill-color']).toBe('#00ff00');
    expect(s1.historyPast).toHaveLength(1);
    const past0 = s1.historyPast[0];
    expect(past0.kind).toBe('nodes');
    if (past0.kind !== 'nodes') throw new Error('expected nodes history');
    expect(past0.before[id].attrs.path).toBe(pathRef);

    const s2 = reduceEditor(s1, editorReducers.undo);
    expect(s2.document.deltaSetLike[id].attrs['fill-color']).toBe('#ff0000');
    expect(s2.lastPatchedNodeIds).toEqual([id]);
    // Node-patch undo must not force a full scene remount.
    expect(s2.sceneReloadToken).toBe(s1.sceneReloadToken);

    const s3 = reduceEditor(s2, editorReducers.redo);
    expect(s3.document.deltaSetLike[id].attrs['fill-color']).toBe('#00ff00');
  });

  it('paste history stores add entry (not full snap) and undoes by remove', () => {
    let doc = createEmptyDocument({ emptyWorld: true, width: 800, height: 600 });
    // Seed a large-ish base so a full snap would be expensive.
    for (let i = 0; i < 40; i += 1) {
      const { id, node } = createShapeNode({
        x: (i % 8) * 30,
        y: Math.floor(i / 8) * 30,
        width: 20,
        height: 20,
        shapeType: 'rect',
        fill: '#cccccc',
      });
      doc = addNodeToDocument(doc, id, node);
    }
    let state = reduceEditor(undefined, () => {});
    state = reduceEditor(state, editorReducers.createTemplate, {
      name: 'paste-add',
      document: doc,
      emptyWorld: true,
      source: 'user',
    });
    const baseCount = Object.keys(state.document!.deltaSetLike || {}).length;

    const pasted: Array<{ id: string; node: ReturnType<typeof createShapeNode>['node'] }> = [];
    let next = state.document!;
    for (let i = 0; i < 5; i += 1) {
      const { id, node } = createShapeNode({
        x: 400 + i * 10,
        y: 400,
        width: 24,
        height: 24,
        shapeType: 'rect',
        fill: '#ff0000',
      });
      next = addNodeToDocument(next, id, node);
      pasted.push({ id, node });
    }
    const patchedIds = pasted.map((p) => p.id);
    state = reduceEditor(state, editorReducers.commitPastedDocument, {
      document: next,
      patchedNodeIds: patchedIds,
      selectedNodeIds: patchedIds,
    });

    expect(state.historyPast).toHaveLength(1);
    const past0 = state.historyPast[0];
    expect(past0.kind).toBe('add');
    if (past0.kind !== 'add') throw new Error('expected add history');
    expect(Object.keys(past0.nodes).sort()).toEqual([...patchedIds].sort());
    // Must not stash a full-doc clone of the 40+ node base.
    expect(Object.keys(past0.nodes).length).toBe(5);

    const afterPasteCount = Object.keys(state.document!.deltaSetLike || {}).length;
    expect(afterPasteCount).toBe(baseCount + 5);

    const reloadBefore = state.sceneReloadToken;
    state = reduceEditor(state, editorReducers.undo);
    expect(Object.keys(state.document!.deltaSetLike || {}).length).toBe(baseCount);
    for (const id of patchedIds) {
      expect(state.document!.deltaSetLike![id]).toBeUndefined();
    }
    expect(state.sceneReloadToken).toBe(reloadBefore);
    expect(state.lastPatchedNodeIds).toEqual(expect.arrayContaining(patchedIds));

    state = reduceEditor(state, editorReducers.redo);
    expect(Object.keys(state.document!.deltaSetLike || {}).length).toBe(baseCount + 5);
    for (const id of patchedIds) {
      expect(state.document!.deltaSetLike![id]).toBeTruthy();
    }
  });

  it('cut/delete history stores remove entry (not full snap) and undoes by restore', () => {
    let doc = createEmptyDocument({ emptyWorld: true, width: 800, height: 600 });
    const cutIds: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      const { id, node } = createShapeNode({
        x: (i % 8) * 30,
        y: Math.floor(i / 8) * 30,
        width: 20,
        height: 20,
        shapeType: 'rect',
        fill: '#cccccc',
      });
      doc = addNodeToDocument(doc, id, node);
      if (i < 8) cutIds.push(id);
    }
    let state = reduceEditor(undefined, () => {});
    state = reduceEditor(state, editorReducers.createTemplate, {
      name: 'cut-remove',
      document: doc,
      emptyWorld: true,
      source: 'user',
    });
    const baseCount = Object.keys(state.document!.deltaSetLike || {}).length;
    const reloadBefore = state.sceneReloadToken;

    state = reduceEditor(state, editorReducers.removeDocumentNodes, { nodeIds: cutIds });
    expect(state.historyPast).toHaveLength(1);
    const past0 = state.historyPast[0];
    expect(past0.kind).toBe('remove');
    if (past0.kind !== 'remove') throw new Error('expected remove history');
    expect(Object.keys(past0.nodes).sort()).toEqual([...cutIds].sort());
    expect(Object.keys(state.document!.deltaSetLike || {}).length).toBe(baseCount - 8);
    expect(state.sceneReloadToken).toBe(reloadBefore);

    state = reduceEditor(state, editorReducers.undo);
    expect(Object.keys(state.document!.deltaSetLike || {}).length).toBe(baseCount);
    for (const id of cutIds) {
      expect(state.document!.deltaSetLike![id]).toBeTruthy();
    }

    state = reduceEditor(state, editorReducers.redo);
    expect(Object.keys(state.document!.deltaSetLike || {}).length).toBe(baseCount - 8);
    for (const id of cutIds) {
      expect(state.document!.deltaSetLike![id]).toBeUndefined();
    }
  });

  it('does not add an upload placeholder to undo history', () => {
    const { state: s0 } = seedWithPathNode();
    const s1 = reduceEditor(s0, editorReducers.startImageUploadPlaceholder, {
        src: 'blob:upload-preview',
        width: 120,
        height: 80,
        x: 30,
        y: 40,
      });

    expect(s1.historyPast).toHaveLength(0);
    expect(s1.pendingImageProcessId).toBeTruthy();
  });

  it('does not resurrect a cancelled import placeholder through undo', () => {
    const { state: s0 } = seedWithPathNode();
    const started = reduceEditor(s0, editorReducers.startImportPlaceholder, {
      label: '导入中',
      width: 120,
      height: 80,
      x: 30,
      y: 40,
    });
    const placeholderId = started.pendingImportPlaceholderId;
    expect(placeholderId).toBeTruthy();

    const cancelled = reduceEditor(started, editorReducers.cancelImportPlaceholder);
    const undone = reduceEditor(cancelled, editorReducers.undo);

    expect(undone.document.deltaSetLike[placeholderId]).toBeUndefined();
    expect(undone.historyPast).toHaveLength(0);
  });

  it('allows deleting an in-flight upload placeholder', () => {
    const { state: s0 } = seedWithPathNode();
    const started = reduceEditor(s0, editorReducers.startImageUploadPlaceholder, {
        src: 'blob:upload-preview',
        width: 120,
        height: 80,
        x: 30,
        y: 40,
      });
    const placeholderId = started.pendingImageProcessId as string;
    const deleted = reduceEditor(started, editorReducers.removeDocumentNodes, { nodeIds: [placeholderId] });

    expect(deleted.document.deltaSetLike[placeholderId]).toBeUndefined();
    expect(deleted.pendingImageProcessId).toBeNull();
  });

  it('records one undo step for a completed upload, excluding the placeholder', () => {
    const { state: s0 } = seedWithPathNode();
    const started = reduceEditor(s0, editorReducers.startImageUploadPlaceholder, {
        src: 'blob:upload-preview',
        width: 120,
        height: 80,
        x: 30,
        y: 40,
      });
    const nodeId = started.pendingImageProcessId as string;
    const finished = reduceEditor(started, editorReducers.finishImageProcess, {
        nodeId,
        src: 'https://cdn.example/image.png',
      });

    expect(finished.historyPast).toHaveLength(1);
    expect(finished.document.deltaSetLike[nodeId].attrs.src).toBe(
      'https://cdn.example/image.png'
    );

    const undone = reduceEditor(finished, editorReducers.undo);
    expect(undone.document.deltaSetLike[nodeId]).toBeUndefined();
  });

  it('does not record process placeholder creation, but completion is undoable once', () => {
    const { state: s0, id: sourceId } = seedWithImageNode();
    const started = reduceEditor(s0, editorReducers.startImageProcess, { sourceId, kind: 'upscale', label: '处理中' });
    const processId = started.pendingImageProcessId as string;
    expect(started.historyPast).toHaveLength(0);

    const finished = reduceEditor(started, editorReducers.finishImageProcess, { nodeId: processId, src: 'https://cdn.example/upscaled.png' });
    expect(finished.historyPast).toHaveLength(1);
    expect(reduceEditor(finished, editorReducers.undo).document.deltaSetLike[processId]).toBeUndefined();
  });

  it('does not record pure loading-state patches', () => {
    const { state: s0, id } = seedWithImageNode();
    const started = reduceEditor(s0, editorReducers.patchDocumentNode, {
        nodeId: id,
        patch: {
          attrs: {
            processStatus: 'running',
            processKind: 'quickEdit',
            processLabel: '处理中',
          },
        },
      });

    expect(started.historyPast).toHaveLength(0);
    expect(started.document.deltaSetLike[id].attrs.processStatus).toBe('running');
  });
});
