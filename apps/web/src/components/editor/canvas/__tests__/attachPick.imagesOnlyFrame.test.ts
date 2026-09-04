import { describe, expect, it } from 'vitest';
import {
  canAttachFrameToPick,
  resolveAttachPickPayload,
} from '../attachPick';
import type { SceneDocument } from '@/components/rcb/sceneNode';

function docLotWorkbench(): SceneDocument {
  return {
    frames: [
      {
        id: 'af1',
        kind: 'animation',
        name: '重测生成LOT-edited',
        x: 0,
        y: 0,
        width: 285,
        height: 285,
      },
    ],
    deltaSetLike: {
      ROOT: { id: 'ROOT', children: ['host', 'lot'] },
      host: {
        id: 'host',
        key: 'lottie',
        width: 285,
        height: 285,
        attrs: { frameId: 'af1', animationFrameHost: true },
      },
      lot: {
        id: 'lot',
        key: 'lottie',
        width: 285,
        height: 285,
        attrs: { frameId: 'af1', animationData: '{"v":"5.7.4","layers":[]}' },
      },
    },
  } as unknown as SceneDocument;
}

function docArtboardWithImage(): SceneDocument {
  return {
    frames: [
      {
        id: 'f1',
        kind: 'artboard',
        name: 'Board',
        x: 0,
        y: 0,
        width: 400,
        height: 400,
      },
    ],
    deltaSetLike: {
      ROOT: { id: 'ROOT', children: ['img'] },
      img: {
        id: 'img',
        key: 'image',
        width: 200,
        height: 200,
        attrs: { frameId: 'f1', src: 'https://example.com/a.png' },
      },
    },
  } as unknown as SceneDocument;
}

describe('canAttachFrameToPick', () => {
  it('blocks animation workbench frames for imagesOnly pick', () => {
    expect(canAttachFrameToPick(docLotWorkbench(), 'af1', { imagesOnly: true })).toBe(
      false
    );
  });

  it('allows animation frames for non-image (chat/media) pick', () => {
    expect(canAttachFrameToPick(docLotWorkbench(), 'af1')).toBe(true);
  });

  it('allows artboard frames that contain an attachable image', () => {
    expect(
      canAttachFrameToPick(docArtboardWithImage(), 'f1', { imagesOnly: true })
    ).toBe(true);
  });

  it('resolveAttachPickPayload: frame fallback stays blocked for LOT + imagesOnly', () => {
    const resolved = resolveAttachPickPayload(docLotWorkbench(), [], 'af1', {
      imagesOnly: true,
    });
    expect(resolved).toEqual({ payload: '', blockedOnly: true });
  });

  it('resolveAttachPickPayload: lottie node alone is blockedOnly under imagesOnly', () => {
    const resolved = resolveAttachPickPayload(docLotWorkbench(), ['lot'], undefined, {
      imagesOnly: true,
    });
    expect(resolved?.blockedOnly).toBe(true);
  });
});
