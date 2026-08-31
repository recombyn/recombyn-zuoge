/**
 * Canvas product-ops store stress: shapes / frames / media / tools / undo.
 * Complements canvasGenerators + RCB geometry benches.
 */
import { describe, expect, it } from 'vitest';
import {
  editorReducers,
  reduceEditor,
  addArtboardFrame,
  closeImageToolPanel,
  createTemplate,
  ensureAnimationFrameMedia,
  openImageToolPanel,
  openLottieTimelinePanel,
  patchDocumentNode,
  placeMediaAsset,
  removeArtboardFrames,
  removeDocumentNodes,
  setActiveTool,
  setDocument,
  setShapeKind,
  spawnAudioGenerator,
  spawnImageGenerator,
  spawnAnimationBoard,
  spawnLottieGeneratorPlate,
  spawnVideoGenerator,
  startImageUploadPlaceholder,
  startVideoUploadPlaceholder,
  undo,
  redo,
} from '@/store/modules/editor';
import {
  addNodeToDocument,
  createEmptyDocument,
} from '@/components/rcb/scene/document/sceneDocument';
import {
  createShapeNode,
  createTextNode,
} from '@/components/rcb/scene/document/nodeFactories';
import {
  pasteClipboardIntoDocument,
  snapshotNodesForClipboard,
} from '@/components/rcb/scene/document/sceneClipboard';
import { computeShapeBoolean } from '@/components/rcb/selection/shapeBoolean';

const SHAPE_KINDS = ['rect', 'circle', 'polygon', 'star', 'line', 'arrow'] as const;
const TOOLS = [
  'select',
  'pan',
  'frame',
  'shape',
  'pen',
  'pencil',
  'text',
  'image',
] as const;

function seed() {
  let state = reduceEditor(undefined, () => {});
  state = reduceEditor(state, editorReducers.createTemplate, {
      name: 'canvas-ops-stress',
      document: createEmptyDocument({ emptyWorld: true }),
      emptyWorld: true,
      source: 'scratch',
    });
  return state;
}

function nodeCount(state: ReturnType<typeof seed>) {
  return Object.keys(state.document?.deltaSetLike || {}).length;
}

function addCreated(
  state: ReturnType<typeof seed>,
  created: { id: string; node: any }
) {
  const doc = addNodeToDocument(state.document!, created.id, created.node);
  return reduceEditor(state, editorReducers.setDocument, doc);
}

describe('canvas ops store stress', () => {
  it(
    'spawns mixed shapes × rounds, undo/redo, remove, and clipboard paste',
    { timeout: 30_000 },
    () => {
      let state = seed();
      const ids: string[] = [];

      for (let round = 0; round < 40; round += 1) {
        for (let k = 0; k < SHAPE_KINDS.length; k += 1) {
          const kind = SHAPE_KINDS[k]!;
          const created = createShapeNode({
            x: round * 12 + k * 4,
            y: round * 8 + k * 3,
            width: 40 + (k % 5) * 8,
            height: 30 + (k % 4) * 6,
            shapeType: kind,
            fill: k % 2 ? '#FFFFFF' : '#E8EEF5',
            stroke: '#222222',
          });
          state = addCreated(state, created);
          ids.push(created.id);
        }
        const text = createTextNode({
          x: round * 10,
          y: 400 + round * 4,
          width: 160,
          height: 40,
          text: `ops-${round}`,
        });
        state = addCreated(state, text);
        ids.push(text.id);
      }

      expect(nodeCount(state)).toBeGreaterThanOrEqual(ids.length);
      expect(ids.length).toBe(40 * (SHAPE_KINDS.length + 1));

      // Clipboard snapshot → paste ×20 (new ids each time).
      for (let i = 0; i < 20; i += 1) {
        const sample = ids.slice(i * 3, i * 3 + 3);
        const clip = snapshotNodesForClipboard(state.document!, sample);
        expect(clip?.nodes?.length).toBeGreaterThan(0);
        const pasted = pasteClipboardIntoDocument(state.document!, clip, {
          offsetX: 20 + i,
          offsetY: 20 + i,
        });
        state = reduceEditor(state, editorReducers.setDocument, pasted.document);
        expect(pasted.ids.length).toBe(clip!.nodes!.length);
      }

      const beforeUndo = nodeCount(state);
      state = reduceEditor(state, editorReducers.undo);
      expect(nodeCount(state)).toBeLessThan(beforeUndo);
      state = reduceEditor(state, editorReducers.redo);
      expect(nodeCount(state)).toBe(beforeUndo);

      const drop = ids.slice(0, 50);
      state = reduceEditor(state, editorReducers.removeDocumentNodes, { nodeIds: drop });
      for (const id of drop) {
        expect(state.document!.deltaSetLike[id]).toBeUndefined();
      }
    }
  );

  it('artboard frames + generators + media placeholders survive churn', () => {
    let state = seed();
    const frameIds: string[] = [];

    for (let i = 0; i < 30; i += 1) {
      state = reduceEditor(state, editorReducers.addArtboardFrame, {
          x: i * 40,
          y: i * 20,
          width: 320,
          height: 240,
          name: `frame-${i}`,
          activate: i === 29,
        });
      const frames = state.document!.frames || [];
      expect(frames.length).toBe(i + 1);
      frameIds.push(String(frames[frames.length - 1]!.id));
    }

    state = reduceEditor(state, editorReducers.spawnImageGenerator, { x: 10, y: 10 });
    state = reduceEditor(state, editorReducers.spawnVideoGenerator, { x: 20, y: 20 });
    state = reduceEditor(state, editorReducers.spawnLottieGeneratorPlate, { x: 30, y: 30 });
    state = reduceEditor(state, editorReducers.spawnAudioGenerator, { x: 40, y: 40 });
    expect(nodeCount(state)).toBeGreaterThanOrEqual(4);

    state = reduceEditor(state, editorReducers.placeMediaAsset, {
        kind: 'image',
        src: 'https://cdn.example.com/ops.png',
        x: 50,
        y: 50,
        width: 120,
        height: 90,
        name: 'ops-img',
        prompt: 'ops place',
      });
    state = reduceEditor(state, editorReducers.placeMediaAsset, {
        kind: 'video',
        src: 'https://cdn.example.com/ops.mp4',
        x: 60,
        y: 60,
        width: 160,
        height: 90,
        name: 'ops-vid',
      });
    state = reduceEditor(state, editorReducers.placeMediaAsset, {
        kind: 'audio',
        src: 'https://cdn.example.com/ops.mp3',
        x: 70,
        y: 70,
        name: 'ops-aud',
      });

    state = reduceEditor(state, editorReducers.startImageUploadPlaceholder, {
        src: 'blob:https://local/ops-img',
        x: 80,
        y: 80,
        width: 100,
        height: 80,
      });
    state = reduceEditor(state, editorReducers.startVideoUploadPlaceholder, {
        src: 'blob:https://local/ops-vid',
        x: 90,
        y: 90,
        width: 120,
        height: 70,
      });

    // Patch + lock/hide flags on selected node.
    const sel = String(state.selectedNodeId || '');
    if (sel) {
      state = reduceEditor(state, editorReducers.patchDocumentNode, {
          nodeId: sel,
          patch: { attrs: { locked: 'true', hidden: 'false' } as any },
        });
      expect(state.document!.deltaSetLike[sel].attrs?.locked).toBe('true');
    }

    state = reduceEditor(state, editorReducers.removeArtboardFrames, frameIds.slice(0, 10));
    expect((state.document!.frames || []).length).toBe(20);
  });

  it('deleting an artboard removes nodes bound to it in one history step', () => {
    let state = seed();
    state = reduceEditor(state, editorReducers.addArtboardFrame, {
        x: 100,
        y: 100,
        width: 200,
        height: 150,
        name: 'delete-me',
        activate: true,
      });
    const frameId = String(state.document!.frames?.[0]?.id || '');
    const inside = createShapeNode({
      x: 130,
      y: 130,
      width: 40,
      height: 40,
      shapeType: 'rect',
    });
    inside.node.attrs = { ...(inside.node.attrs || {}), frameId };
    const crossing = createShapeNode({
      x: 270,
      y: 160,
      width: 80,
      height: 40,
      shapeType: 'rect',
    });
    crossing.node.attrs = { ...(crossing.node.attrs || {}), frameId };
    const outside = createShapeNode({
      x: 400,
      y: 400,
      width: 40,
      height: 40,
      shapeType: 'rect',
    });
    const overlapUnbound = createShapeNode({
      x: 150,
      y: 140,
      width: 50,
      height: 50,
      shapeType: 'rect',
    });
    state = addCreated(state, inside);
    state = addCreated(state, crossing);
    state = addCreated(state, outside);
    state = addCreated(state, overlapUnbound);

    state = reduceEditor(state, editorReducers.removeArtboardFrames, [frameId]);
    expect(state.document!.frames || []).toHaveLength(0);
    expect(state.document!.deltaSetLike[inside.id]).toBeUndefined();
    expect(state.document!.deltaSetLike[crossing.id]).toBeUndefined();
    expect(state.document!.deltaSetLike[outside.id]).toBeDefined();
    expect(state.document!.deltaSetLike[overlapUnbound.id]).toBeDefined();

    state = reduceEditor(state, editorReducers.undo);
    expect(state.document!.frames || []).toHaveLength(1);
    expect(state.document!.deltaSetLike[inside.id]).toBeDefined();
    expect(state.document!.deltaSetLike[crossing.id]).toBeDefined();
    expect(state.document!.deltaSetLike[outside.id]).toBeDefined();
    expect(state.document!.deltaSetLike[overlapUnbound.id]).toBeDefined();
  });

  it('tool + shapeKind cycling stays coherent', () => {
    let state = seed();
    for (let round = 0; round < 25; round += 1) {
      for (const tool of TOOLS) {
        state = reduceEditor(state, editorReducers.setActiveTool, tool);
        expect(state.activeTool).toBe(tool);
      }
      for (const kind of SHAPE_KINDS) {
        state = reduceEditor(state, editorReducers.setShapeKind, kind);
        expect(state.shapeKind).toBe(kind);
      }
    }
    state = reduceEditor(state, editorReducers.setActiveTool, 'select');
    expect(state.activeTool).toBe('select');
  });

  it('boolean union/subtract on stress boxes stays finite', () => {
    const boxes = Array.from({ length: 12 }, (_, i) => ({
      left: (i % 4) * 30,
      top: Math.floor(i / 4) * 30,
      width: 40,
      height: 40,
      shapeType: 'rect' as const,
    }));
    for (const mode of ['union', 'subtract', 'intersect', 'exclude'] as const) {
      const { result } = computeShapeBoolean(boxes.slice(0, 4), mode);
      if (!result) continue;
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(Number.isFinite(result.x)).toBe(true);
      expect(Number.isFinite(result.y)).toBe(true);
    }
  });

  it('image tool panels open/close for mark and related kinds', () => {
    let state = seed();
    state = reduceEditor(state, editorReducers.placeMediaAsset, {
        kind: 'image',
        src: 'https://cdn.example.com/mark-panel.png',
        x: 10,
        y: 10,
        width: 200,
        height: 150,
        name: 'panel-img',
      });
    const id = String(state.selectedNodeId);
    expect(id.length).toBeGreaterThan(2);
    for (const kind of ['mark', 'eraser', 'crop', 'expand', 'adjust', 'effects', 'blendMode', 'opacity', 'multiAngle'] as const) {
      state = reduceEditor(state, editorReducers.openImageToolPanel, { nodeId: id, kind });
      expect(state.imageToolPanel?.kind).toBe(kind);
      expect(state.imageToolPanel?.nodeId).toBe(id);
      state = reduceEditor(state, editorReducers.closeImageToolPanel);
      expect(state.imageToolPanel).toBeFalsy();
    }
  });

  it('openImageToolPanel does not exit animation timeline edit mode', () => {
    let state = seed();
    state = reduceEditor(state, editorReducers.spawnAnimationBoard, { x: 0, y: 0, width: 300, height: 300 });
    const frameId = String(state.selectedFrameIds[0] || '');
    expect(frameId.length).toBeGreaterThan(2);
    state = reduceEditor(state, editorReducers.ensureAnimationFrameMedia, { frameId });
    const hostId = Object.keys(state.document!.deltaSetLike || {}).find((id) => {
      const n = state.document!.deltaSetLike?.[id];
      return (
        n?.key === 'lottie' &&
        (n.attrs?.animationFrameHost === true || n.attrs?.lottieFrameHost === true)
      );
    });
    expect(hostId).toBeTruthy();
    state = reduceEditor(state, editorReducers.openLottieTimelinePanel, { nodeId: String(hostId) });
    expect(state.lottieTimelinePanel?.nodeId).toBe(hostId);

    state = reduceEditor(state, editorReducers.placeMediaAsset, {
        kind: 'image',
        src: 'https://cdn.example.com/in-workbench.png',
        x: 20,
        y: 20,
        width: 80,
        height: 80,
        name: 'wb-img',
      });
    const imageId = String(state.selectedNodeId);
    state = reduceEditor(state, editorReducers.openImageToolPanel, { nodeId: imageId, kind: 'crop' });
    expect(state.imageToolPanel?.kind).toBe('crop');
    expect(state.lottieTimelinePanel?.nodeId).toBe(hostId);
  });
});
