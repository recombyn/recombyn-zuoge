import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import {
  addNodeToDocument,
  cloneSceneValue,
  createEmptyDocument,
} from '@/components/rcb/scene/document/sceneDocument';
import { spawnImageProcessNode } from '@/components/rcb/scene/document/mediaLifecycle';

describe('cloneSceneValue', () => {
  it('clones Immer drafts without DataCloneError', () => {
    const node = {
      id: 'img1',
      key: 'image' as const,
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      attrs: { src: 'https://example.com/a.png', name: 'A' },
    };
    produce(node, (draft) => {
      const cloned = cloneSceneValue(draft);
      expect(cloned).toEqual(node);
      expect(cloned).not.toBe(draft);
      const nextAttrs = { ...cloned.attrs, processStatus: 'running' };
      cloned.attrs = nextAttrs as typeof cloned.attrs;
      expect((draft.attrs as { processStatus?: string } | undefined)?.processStatus).toBeUndefined();
    });
  });

  it('spawnImageProcessNode works on a document draft', () => {
    let doc = createEmptyDocument({ width: 800, height: 600 });
    doc = addNodeToDocument(doc, 'src1', {
      id: 'src1',
      key: 'image',
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      attrs: { src: 'https://example.com/a.png' },
    });
    produce(doc, (draft) => {
      const { id } = spawnImageProcessNode(draft as typeof doc, 'src1', {
        kind: 'upscale',
        label: '放大中',
      });
      expect(id).toBeTruthy();
    });
  });

  it('spawnImageProcessNode places wide images to the right, not below', () => {
    let doc = createEmptyDocument({ width: 2400, height: 2000 });
    doc = addNodeToDocument(doc, 'src1', {
      id: 'src1',
      key: 'image',
      x: 100,
      y: 50,
      width: 1111,
      height: 1978,
      attrs: { src: 'https://example.com/wide.png' },
    });
    const { document: next, id } = spawnImageProcessNode(doc, 'src1', {
      kind: 'removeBg',
      label: '去背景中',
    });
    expect(id).toBeTruthy();
    const spawned = next.deltaSetLike?.[id!];
    expect(spawned?.x).toBe(100 + 1111 + 16);
    expect(spawned?.y).toBe(50);
  });
});
