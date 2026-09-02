import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  frameBakeSignature,
  nodePatchNeedsTimelineBake,
  queueEnsureAnimationFramesForDocChange,
} from '../queueEnsureAnimationFramesForDocChange';
import { setAnimationWorkbenchTimelineFocus } from '../animationWorkbenchFocus';
import * as sceneEvents from '@/components/editor/sceneEvents';
import type { SceneDocument } from '@/components/rcb/sceneNode';

afterEach(() => {
  setAnimationWorkbenchTimelineFocus(null);
  vi.restoreAllMocks();
});

function makeDoc(opts?: {
  frameId?: string;
  child?: { id: string; x: number; y: number };
}): SceneDocument {
  const frameId = opts?.frameId || 'af1';
  const child = opts?.child || { id: 'shape1', x: 10, y: 20 };
  return {
    id: 'doc',
    width: 800,
    height: 600,
    activeFrameId: frameId,
    frames: [
      {
        id: frameId,
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        kind: 'animation',
        name: '动画工作台',
      } as any,
    ],
    deltaSetLike: {
      host1: {
        id: 'host1',
        key: 'lottie',
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        attrs: {
          frameId,
          animationFrameHost: true,
          animationData: '{"v":"5.7.4","fr":30,"ip":0,"op":30,"w":400,"h":400,"layers":[]}',
        },
      },
      [child.id]: {
        id: child.id,
        key: 'shape',
        x: child.x,
        y: child.y,
        width: 80,
        height: 60,
        attrs: {
          frameId,
          frameOrder: 1,
          name: '矩形',
          'fill-color': '#fff',
        },
      },
    },
    stackOrder: [`frame:${frameId}`, 'node:host1', `node:${child.id}`],
  } as any;
}

describe('frameBakeSignature / queueEnsureAnimationFramesForDocChange', () => {
  it('signature changes when child geometry moves', () => {
    const a = makeDoc({ child: { id: 'shape1', x: 10, y: 20 } });
    const b = makeDoc({ child: { id: 'shape1', x: 40, y: 20 } });
    expect(frameBakeSignature(a, 'af1')).not.toBe(frameBakeSignature(b, 'af1'));
  });

  it('includeFocus does not queue when signature is unchanged', () => {
    const spy = vi.spyOn(sceneEvents, 'queueEnsureAnimationFrame');
    setAnimationWorkbenchTimelineFocus('af1');
    const doc = makeDoc();
    queueEnsureAnimationFramesForDocChange(doc, structuredClone(doc), {
      includeFocus: true,
      skipHistory: true,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('queues ensure when membership grows under focus', () => {
    const spy = vi.spyOn(sceneEvents, 'queueEnsureAnimationFrame');
    setAnimationWorkbenchTimelineFocus('af1');
    const before = makeDoc();
    const after = makeDoc();
    (after.deltaSetLike as any).shape2 = {
      id: 'shape2',
      key: 'shape',
      x: 100,
      y: 100,
      width: 40,
      height: 40,
      attrs: { frameId: 'af1', frameOrder: 2, name: '新', 'fill-color': '#0f0' },
    };
    queueEnsureAnimationFramesForDocChange(before, after, {
      includeFocus: true,
      skipHistory: true,
    });
    expect(spy).toHaveBeenCalledWith('af1', { skipHistory: true });
  });

  it('nodePatchNeedsTimelineBake skips host animationData-only writes', () => {
    const doc = makeDoc();
    const host = doc.deltaSetLike!.host1;
    expect(
      nodePatchNeedsTimelineBake(
        { attrs: { animationData: '{"layers":[]}' } },
        host,
        doc
      )
    ).toBe(false);
    expect(
      nodePatchNeedsTimelineBake({ x: 12, y: 8 }, doc.deltaSetLike!.shape1, doc)
    ).toBe(true);
  });
});
