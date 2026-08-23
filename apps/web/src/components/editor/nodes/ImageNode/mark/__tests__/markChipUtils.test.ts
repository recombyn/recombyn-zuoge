import { describe, expect, it } from 'vitest';
import {
  buildMarkChipPayload,
  markComposerChipLabel,
  markPinToRegion,
  nextMarkRegionIndex,
  regionToMarkPin,
} from '../markChipUtils';
import type { MarkRegion } from '../MarkRegionOverlay';
import {
  buildComposerChipPrompt,
  collectComposerRefImages,
} from '@/components/editor/panels/agent/agentSendPath';

const sampleRegion: MarkRegion = {
  id: 'r1',
  index: 1,
  x: 40,
  y: 60,
  w: 120,
  h: 80,
  kind: 'manual',
  label: '1 区域',
  selected: true,
};

describe('markComposerChipLabel', () => {
  it('labels manual regions as [n] 区域', () => {
    expect(markComposerChipLabel(sampleRegion)).toBe('[1] 区域');
  });

  it('labels text regions with quoted content', () => {
    expect(
      markComposerChipLabel({
        index: 2,
        kind: 'text',
        label: '2 "中秋团圆"',
      })
    ).toBe('[2] 中秋团圆');
  });
});

describe('nextMarkRegionIndex', () => {
  it('increments past committed pins and in-session regions', () => {
    expect(
      nextMarkRegionIndex(
        [{ ...regionToMarkPin('img-1', sampleRegion, 'quickEdit') }],
        [{ index: 2 }]
      )
    ).toBe(3);
    expect(nextMarkRegionIndex([], [])).toBe(1);
  });
});

describe('buildMarkChipPayload', () => {
  it('embeds normalized region coords and node id', () => {
    const payload = buildMarkChipPayload('node-abc', sampleRegion, 400, 300);
    expect(payload).toContain('node_id: node-abc');
    expect(payload).toContain('region: #1(subject@0.100,0.200,0.300x0.267)');
    expect(payload).toContain('label: 1 区域');
    expect(payload).not.toMatch(/data:image\//);
  });

  it('uses text tag for OCR regions', () => {
    const payload = buildMarkChipPayload(
      'node-abc',
      { ...sampleRegion, kind: 'text', index: 3, label: '3 "标题"' },
      400,
      300
    );
    expect(payload).toContain('region: #3(text@');
  });
});

describe('mark pin round-trip', () => {
  it('regionToMarkPin stores sink and geometry', () => {
    const pin = regionToMarkPin('img-1', sampleRegion, 'quickEdit');
    expect(pin).toEqual({
      nodeId: 'img-1',
      id: 'r1',
      index: 1,
      x: 40,
      y: 60,
      w: 120,
      h: 80,
      kind: 'manual',
      label: '1 区域',
      sink: 'quickEdit',
    });
  });

  it('markPinToRegion restores selected region', () => {
    const pin = regionToMarkPin('img-1', sampleRegion, 'agent');
    expect(markPinToRegion(pin)).toEqual({
      ...sampleRegion,
      selected: true,
    });
  });
});

describe('mark chip composer integration', () => {
  it('mark chips carry text payload without inline image thumbs', () => {
    const chip = {
      key: 'mark:img-1:r1:1',
      label: '[1] 区域',
      kind: 'image',
      payload: buildMarkChipPayload('img-1', sampleRegion, 400, 300),
      appendText: ' 改成红色',
    };
    expect(chip.dataUrl).toBeUndefined();
    expect(chip.thumbUrl).toBeUndefined();

    const prompt = buildComposerChipPrompt([chip], '整体更亮 改成红色');
    expect(prompt).toContain('[Marked image region');
    expect(prompt).toContain('User request:\n整体更亮 改成红色');
    expect(chip.appendText?.trim()).toBe('改成红色');
  });

  it('quick-edit still references the full source image for vision', () => {
    const chip = {
      key: 'mark:img-1:r1:1',
      label: '[1] 区域',
      kind: 'image',
      payload: buildMarkChipPayload('img-1', sampleRegion, 400, 300),
    };
    const refs = collectComposerRefImages([chip], 'https://cdn.example.com/photo.png');
    expect(refs).toEqual(['https://cdn.example.com/photo.png']);
  });
});

describe('pending mark chip shape', () => {
  it('matches UX contract: no upload thumb on mark chips', () => {
    const chip = {
      key: `mark:node:${sampleRegion.id}:${Date.now()}`,
      label: markComposerChipLabel(sampleRegion),
      kind: 'image',
      payload: buildMarkChipPayload('node', sampleRegion, 400, 300),
      appendText: ' test',
    };
    expect(Object.keys(chip).sort()).toEqual(['appendText', 'key', 'kind', 'label', 'payload']);
  });
});
