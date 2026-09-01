import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearLiveArtboardFrameGeometry,
  previewArtboardFrameGeometry,
  subscribeLiveArtboardFrameGeometry,
} from '../HtmlArtboardFrame';
import {
  clearSceneCanvasIdlePaint,
  setSceneCanvasIdlePaint,
  subscribeSceneCanvasIdlePaint,
} from '@/components/rcb/render/sceneRenderer';
import { createEmptyDocument } from '@/components/rcb/scene/document/sceneDocument';

describe('live artboard paint notify', () => {
  afterEach(() => {
    clearLiveArtboardFrameGeometry();
    clearSceneCanvasIdlePaint();
  });

  it('does not re-notify when plate geometry is unchanged', () => {
    const spy = vi.fn();
    const unsub = subscribeLiveArtboardFrameGeometry(spy);
    previewArtboardFrameGeometry({ id: 'f1', x: 10, y: 20, width: 100, height: 80 });
    expect(spy).toHaveBeenCalledTimes(1);
    previewArtboardFrameGeometry({ id: 'f1', x: 10, y: 20, width: 100, height: 80 });
    expect(spy).toHaveBeenCalledTimes(1);
    previewArtboardFrameGeometry({ id: 'f1', x: 11, y: 20, width: 100, height: 80 });
    expect(spy).toHaveBeenCalledTimes(2);
    unsub();
  });

  it('setSceneCanvasIdlePaint skips listener wake when membership is unchanged', () => {
    const doc = createEmptyDocument({ width: 400, height: 400, emptyWorld: true });
    const spy = vi.fn();
    const unsub = subscribeSceneCanvasIdlePaint(spy);
    const getNodeBox = () => ({ left: 0, top: 0, width: 1, height: 1 });
    setSceneCanvasIdlePaint({
      document: doc,
      canvasIds: ['a', 'b'],
      hiddenNodeId: null,
      getNodeBox,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    setSceneCanvasIdlePaint({
      document: doc,
      canvasIds: ['a', 'b'],
      hiddenNodeId: null,
      getNodeBox: () => ({ left: 9, top: 9, width: 1, height: 1 }),
    });
    expect(spy).toHaveBeenCalledTimes(1);
    setSceneCanvasIdlePaint({
      document: doc,
      canvasIds: ['a', 'b', 'c'],
      hiddenNodeId: null,
      getNodeBox,
    });
    expect(spy).toHaveBeenCalledTimes(2);
    unsub();
  });
});
