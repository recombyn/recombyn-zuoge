import { describe, expect, it } from 'vitest';
import {
  nextAudioModelId,
  nextImageModelId,
  nextLottieChatModelId,
  nextVideoModelId,
} from '../generatorModelLists';
import type { LlmModel } from '@/service/chat';
import { DEFAULT_CLOUD_VIDEO_MODEL_ID } from '@/components/editor/panels/agent/llmModelMeta';
import { FREE_IMAGE_MODEL_ID } from '@/utils/wallet';

const m = (id: string, kind?: LlmModel['kind']): LlmModel =>
  ({ id, label: id, kind: kind ?? 'chat' }) as LlmModel;

describe('generatorModelLists next*ModelId', () => {
  it('nextImageModelId keeps current id when present in list', () => {
    const models = [m('a'), m(FREE_IMAGE_MODEL_ID, 'image')];
    expect(nextImageModelId(models, 'a')).toBeNull();
  });

  it('nextImageModelId prefers free tier model on cloud when current is missing', () => {
    const models = [m('other', 'image'), m(FREE_IMAGE_MODEL_ID, 'image')];
    expect(nextImageModelId(models, 'missing')).toBe(FREE_IMAGE_MODEL_ID);
  });

  it('nextVideoModelId prefers default cloud video model', () => {
    const models = [m('other', 'video'), m(DEFAULT_CLOUD_VIDEO_MODEL_ID, 'video')];
    expect(nextVideoModelId(models, 'missing')).toBe(DEFAULT_CLOUD_VIDEO_MODEL_ID);
  });

  it('nextAudioModelId falls back to first model', () => {
    const models = [m('or-gemini-3-1-flash-tts', 'audio'), m('other', 'audio')];
    expect(nextAudioModelId(models, 'missing')).toBe('or-gemini-3-1-flash-tts');
  });

  it('nextLottieChatModelId picks first when current is empty', () => {
    const models = [m('chat-a'), m('chat-b')];
    expect(nextLottieChatModelId(models, '')).toBe('chat-a');
  });

  it('nextLottieChatModelId keeps current when valid', () => {
    const models = [m('chat-a'), m('chat-b')];
    expect(nextLottieChatModelId(models, 'chat-b')).toBeNull();
  });
});
