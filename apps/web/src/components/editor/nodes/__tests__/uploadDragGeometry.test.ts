/**
 * Upload-in-flight + geometry drag must not snap nodes/hosts back to stale Redux coords.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  editorReducers,
  reduceEditor,
  createTemplate,
  ensureAnimationFrameMedia,
  patchDocumentNode,
  spawnAnimationBoard,
  startImageUploadPlaceholder,
} from '@/store/modules/editor';
import { createEmptyDocument } from '@/components/rcb/scene/document/sceneDocument';
import { setAnimationWorkbenchGeometryPreview } from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';

type EditorState = ReturnType<typeof seed>;

function seed() {
  let state = reduceEditor(undefined, () => {});
  state = reduceEditor(state, editorReducers.createTemplate, {
      name: 'upload-drag',
      document: createEmptyDocument({ emptyWorld: true }),
      emptyWorld: true,
      source: 'scratch',
    });
  return state;
}

function hostIdForFrame(state: EditorState, frameId: string) {
  return Object.keys(state.document!.deltaSetLike || {}).find((id) => {
    const n = state.document!.deltaSetLike?.[id];
    return (
      n?.key === 'lottie' &&
      (n.attrs?.animationFrameHost === true || n.attrs?.animationFrameHost === 'true') &&
      String(n.attrs?.frameId || '') === frameId
    );
  });
}

function nodePos(state: EditorState, nodeId: string) {
  const node = state.document!.deltaSetLike![nodeId];
  return { x: Number(node.x), y: Number(node.y) };
}

function patchProgress(state: EditorState, nodeId: string, label: string) {
  return reduceEditor(state, editorReducers.patchDocumentNode, {
      nodeId,
      skipHistory: true,
      skipHostReload: true,
      patch: { attrs: { processLabel: label } },
    });
}

afterEach(() => {
  setAnimationWorkbenchGeometryPreview(false);
});

describe('upload drag geometry', () => {
  it('upload progress patches skip host reload (lastPatchedNodeIds empty)', () => {
    let state = seed();
    state = reduceEditor(state, editorReducers.startImageUploadPlaceholder, {
        src: 'blob:local-preview',
        x: 40,
        y: 50,
        width: 120,
        height: 120,
        label: '上传中',
      });
    const nodeId = String(state.pendingImageProcessId || state.selectedNodeId || '');
    expect(nodeId.length).toBeGreaterThan(2);

    state = patchProgress(state, nodeId, '上传中 42%');
    expect(state.lastPatchedNodeIds).toEqual([]);
    expect(nodePos(state, nodeId)).toEqual({ x: 40, y: 50 });

    state = reduceEditor(state, editorReducers.patchDocumentNode, {
        nodeId,
        skipHistory: true,
        patch: { attrs: { processLabel: '上传中 88%' } },
      });
    expect(state.lastPatchedNodeIds).toEqual([]);
  });

  it('moving during upload keeps position when progress ticks arrive', () => {
    let state = seed();
    state = reduceEditor(state, editorReducers.startImageUploadPlaceholder, {
        src: 'blob:local-preview',
        x: 10,
        y: 20,
        width: 100,
        height: 100,
      });
    const nodeId = String(state.pendingImageProcessId || '');
    expect(nodeId).toBeTruthy();

    setAnimationWorkbenchGeometryPreview(true);
    state = reduceEditor(state, editorReducers.patchDocumentNode, {
        nodeId,
        skipHistory: true,
        patch: { x: 180, y: 95 },
      });
    const dragged = nodePos(state, nodeId);
    expect(dragged).toEqual({ x: 180, y: 95 });

    for (const pct of [12, 37, 61, 84]) {
      state = patchProgress(state, nodeId, `上传中 ${pct}%`);
      expect(state.lastPatchedNodeIds).toEqual([]);
      expect(nodePos(state, nodeId)).toEqual(dragged);
    }
  });

  it('ensureAnimationFrameMedia skips while geometry preview is active', () => {
    let state = seed();
    state = reduceEditor(state, editorReducers.spawnAnimationBoard, { x: 0, y: 0, width: 320, height: 240 });
    const frameId = String(state.selectedFrameIds[0] || '');
    expect(frameId).toBeTruthy();
    state = reduceEditor(state, editorReducers.ensureAnimationFrameMedia, { frameId });
    const hostId = hostIdForFrame(state, frameId);
    expect(hostId).toBeTruthy();

    expect(nodePos(state, hostId!)).toEqual({ x: 0, y: 0 });

    state = reduceEditor(state, editorReducers.patchDocumentNode, {
        nodeId: hostId!,
        skipHistory: true,
        patch: { x: 140, y: 72 },
      });
    expect(nodePos(state, hostId!)).toEqual({ x: 140, y: 72 });

    setAnimationWorkbenchGeometryPreview(true);
    state = reduceEditor(state, editorReducers.ensureAnimationFrameMedia, { frameId });
    expect(nodePos(state, hostId!)).toEqual({ x: 140, y: 72 });

    setAnimationWorkbenchGeometryPreview(false);
    state = reduceEditor(state, editorReducers.ensureAnimationFrameMedia, { frameId });
    expect(nodePos(state, hostId!)).toEqual({ x: 0, y: 0 });
  });

  it('upload on animation workbench: progress + ensureMedia during drag does not snap host', () => {
    let state = seed();
    state = reduceEditor(state, editorReducers.spawnAnimationBoard, { x: 50, y: 60, width: 400, height: 300 });
    const frameId = String(state.selectedFrameIds[0] || '');
    state = reduceEditor(state, editorReducers.ensureAnimationFrameMedia, { frameId });
    const hostId = hostIdForFrame(state, frameId)!;

    state = reduceEditor(state, editorReducers.startImageUploadPlaceholder, {
        src: 'blob:wb-upload',
        x: 80,
        y: 90,
        width: 160,
        height: 120,
        label: '上传中',
      });
    const uploadId = String(state.pendingImageProcessId || '');
    expect(uploadId).toBeTruthy();

    setAnimationWorkbenchGeometryPreview(true);
    state = reduceEditor(state, editorReducers.patchDocumentNode, { nodeId: uploadId, skipHistory: true, patch: { x: 220, y: 130 } });
    state = reduceEditor(state, editorReducers.patchDocumentNode, { nodeId: hostId, skipHistory: true, patch: { x: 190, y: 110 } });
    state = patchProgress(state, uploadId, '上传中 55%');
    state = reduceEditor(state, editorReducers.ensureAnimationFrameMedia, { frameId });

    expect(nodePos(state, uploadId)).toEqual({ x: 220, y: 130 });
    expect(nodePos(state, hostId)).toEqual({ x: 190, y: 110 });
  });
});
