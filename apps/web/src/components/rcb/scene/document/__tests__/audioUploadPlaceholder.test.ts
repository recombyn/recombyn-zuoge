import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@/components/rcb/scene/document/sceneDocument';
import { spawnAudioUploadPlaceholderNode } from '@/components/rcb/scene/document/mediaLifecycle';

describe('audio upload placeholder', () => {
  it('marks processStatus running for sweep chrome', () => {
    const doc = createEmptyDocument({ width: 800, height: 600 });
    const { document: next, id } = spawnAudioUploadPlaceholderNode(doc, {
      src: 'data:audio/mpeg;base64,AAA',
      width: 360,
      height: 200,
      label: '上传中',
      name: 'Clip',
      duration: 4,
    });
    expect(id).toBeTruthy();
    const node = next.deltaSetLike?.[id!];
    expect(node?.key).toBe('audio');
    expect(node?.attrs?.processStatus).toBe('running');
    expect(node?.attrs?.processKind).toBe('upload');
    expect(node?.attrs?.processLabel).toBe('上传中');
    expect(node?.attrs?.src).toContain('data:audio');
    expect(Number(node?.attrs?.duration)).toBe(4);
  });
});
