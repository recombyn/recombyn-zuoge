import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  createEmptyDocument,
  addNodeToDocument,
  removeNodesFromDocument,
} from '@/components/rcb/scene/document/sceneDocument';
import {
  createSceneRenderBuffer,
  syncSceneRenderBufferFromDocument,
  getSharedSceneRenderBuffer,
  resetSharedSceneRenderBuffer,
  setSoaCanvasShapesEnabledForTests,
  SOA_FLAG_CANVAS_IDLE,
} from '@/components/rcb/render/sceneRenderBuffer';
import {
  syncSoaBufferFromDocumentNow,
  soaBufferMembershipChanged,
} from '../RcbShapesLayer';

describe('SoA sync drops deleted boolean operands', () => {
  beforeEach(() => {
    setSoaCanvasShapesEnabledForTests(true);
    resetSharedSceneRenderBuffer();
  });
  afterEach(() => {
    setSoaCanvasShapesEnabledForTests(null);
    resetSharedSceneRenderBuffer();
  });

  it('detects membership change when operands are removed', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'a', {
      id: 'a',
      key: 'shape',
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      attrs: { shapeType: 'rect', 'fill-color': '#fff', 'stroke-enabled': false },
      children: [],
    });
    doc = addNodeToDocument(doc, 'b', {
      id: 'b',
      key: 'shape',
      x: 40,
      y: 40,
      width: 80,
      height: 80,
      attrs: { shapeType: 'rect', 'fill-color': '#fff', 'stroke-enabled': false },
      children: [],
    });
    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    expect(soaBufferMembershipChanged(buf, ['a', 'b'])).toBe(false);

    doc = removeNodesFromDocument(doc, ['a', 'b']);
    doc = addNodeToDocument(doc, 'merged', {
      id: 'merged',
      key: 'shape',
      x: 0,
      y: 0,
      width: 120,
      height: 120,
      attrs: { shapeType: 'path', path: 'M0 0 H120 V120 H0 Z', closed: 'true' },
      children: [],
    });
    expect(soaBufferMembershipChanged(buf, ['merged'])).toBe(true);
  });

  it('full-rebuilds when lastPatchedNodeIds omit deletes (setDocument boolean path)', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'a', {
      id: 'a',
      key: 'shape',
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      attrs: { shapeType: 'rect', 'fill-color': '#fff', 'stroke-enabled': false },
      children: [],
    });
    doc = addNodeToDocument(doc, 'b', {
      id: 'b',
      key: 'shape',
      x: 40,
      y: 40,
      width: 80,
      height: 80,
      attrs: { shapeType: 'rect', 'fill-color': '#fff', 'stroke-enabled': false },
      children: [],
    });

    // Seed shared buffer like a live session.
    syncSoaBufferFromDocumentNow(doc, {
      ids: ['a', 'b'],
      lastPatchedNodeIds: ['a', 'b'],
      forceFullIds: new Set(),
      fullRebuild: true,
    });
    const buf = getSharedSceneRenderBuffer();
    expect(buf.count).toBe(2);
    expect(buf.indexById.has('a')).toBe(true);

    // Boolean: replace operands with result. Store often leaves stale patch ids
    // (previous move) that do not include the deleted nodes.
    doc = removeNodesFromDocument(doc, ['a', 'b']);
    doc = addNodeToDocument(doc, 'merged', {
      id: 'merged',
      key: 'shape',
      x: 0,
      y: 0,
      width: 120,
      height: 120,
      attrs: {
        shapeType: 'path',
        path: 'M0 0 H120 V120 H0 Z',
        closed: 'true',
        'fill-color': '#fff',
      },
      children: [],
    });

    syncSoaBufferFromDocumentNow(doc, {
      ids: ['merged'],
      // Stale patches from a prior gesture — classic intermittent ghost.
      lastPatchedNodeIds: ['a'],
      forceFullIds: new Set(['merged']),
    });

    expect(buf.indexById.has('a')).toBe(false);
    expect(buf.indexById.has('b')).toBe(false);
    expect(buf.indexById.has('merged')).toBe(true);
    expect(buf.count).toBe(1);
    const merged = buf.indexById.get('merged')!;
    // Selected result is promoted off canvas-idle.
    expect(buf.flags[merged] & SOA_FLAG_CANVAS_IDLE).toBeFalsy();
  });
});
