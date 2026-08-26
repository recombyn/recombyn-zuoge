import { describe, expect, it } from 'vitest';
import type { ComposerContext } from '@/components/editor/panels/AgentComposerInput';
import { collectSendChipContext } from '@/components/editor/panels/agent/agentSendPath';
import { buildMarkChipPayload } from '../markChipUtils';
import type { MarkRegion } from '../MarkRegionOverlay';
import {
  enrichChipsForAgentVision,
  enrichMarkComposerContext,
  rasterizeMarkRegionToDataUrl,
} from '../markChipVision';

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

describe('markChipVision', () => {
  it('leaves non-mark chips unchanged', async () => {
    const chip: ComposerContext = {
      key: 'node:shape-1',
      label: '形状 1',
      kind: 'shape',
      payload: '[Target element]',
    };
    const out = await enrichMarkComposerContext(null, chip);
    expect(out).toBe(chip);
  });

  it('passes mark crop dataUrl into agent vision send bag', () => {
    const chip: ComposerContext = {
      key: 'mark:img-1:r1:1',
      label: '[1] 区域',
      kind: 'image',
      payload: buildMarkChipPayload('img-1', sampleRegion, 400, 300),
      dataUrl: 'data:image/png;base64,markcrop',
      thumbUrl: 'data:image/png;base64,markthumb',
    };
    const { mentionImageSrcs } = collectSendChipContext([chip]);
    expect(mentionImageSrcs).toEqual(['data:image/png;base64,markcrop']);
  });

  it('enrichChipsForAgentVision is a no-op without mark chips', async () => {
    const chips: ComposerContext[] = [
      {
        key: 'node:shape-1',
        label: '形状 1',
        kind: 'shape',
        payload: 'shape',
      },
    ];
    const out = await enrichChipsForAgentVision({} as any, chips);
    expect(out).toBe(chips);
  });
});

describe('rasterizeMarkRegionToDataUrl', () => {
  it('returns null for non-mark keys', async () => {
    const out = await rasterizeMarkRegionToDataUrl({} as any, {
      key: 'node:x',
      payload: '',
    });
    expect(out).toBeNull();
  });
});
