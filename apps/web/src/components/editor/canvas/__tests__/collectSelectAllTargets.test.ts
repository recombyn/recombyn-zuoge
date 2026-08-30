import { afterEach, describe, expect, it } from 'vitest';
import { collectSelectAllTargets } from '@/components/editor/canvas/canvasSession';
import { createEmptyDocument } from '@/components/rcb/scene/document/sceneDocument';
import {
  setAnimationWorkbenchPlayheadSec,
  setAnimationWorkbenchTimelineFocus,
} from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';

afterEach(() => {
  setAnimationWorkbenchTimelineFocus(null);
  setAnimationWorkbenchPlayheadSec(0);
});

describe('collectSelectAllTargets', () => {
  it('excludes paint-hidden main artboards while animation timeline is focused', () => {
    const doc = createEmptyDocument({ emptyWorld: true }) as any;
    doc.frames = [
      {
        id: 'main',
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        kind: 'artboard',
        name: '主画板',
      },
      {
        id: 'anim',
        x: 900,
        y: 0,
        width: 400,
        height: 400,
        kind: 'animation',
        name: '动画工作台',
      },
    ];
    doc.deltaSetLike = {
      ROOT: { id: 'ROOT', children: ['n_main', 'n_anim'] },
      n_main: {
        id: 'n_main',
        key: 'text',
        x: 40,
        y: 40,
        width: 200,
        height: 80,
        attrs: { frameId: 'main', name: '主画板文字' },
        children: [],
      },
      n_anim: {
        id: 'n_anim',
        key: 'text',
        x: 920,
        y: 40,
        width: 120,
        height: 40,
        attrs: { frameId: 'anim', name: '左格' },
        children: [],
      },
    };
    doc.pages = [{ id: 'p1', children: ['n_main', 'n_anim'] }];
    doc.activePageId = 'p1';

    setAnimationWorkbenchTimelineFocus('anim');
    const focused = collectSelectAllTargets(doc);
    expect(focused.frameIds).toEqual(['anim']);
    expect(focused.nodeIds).toEqual(['n_anim']);

    setAnimationWorkbenchTimelineFocus(null);
    const all = collectSelectAllTargets(doc);
    expect(all.frameIds).toEqual(['main', 'anim']);
    // Timeline closed: workbench children are preview-only (not pickable).
    expect(all.nodeIds).toEqual(['n_main']);
  });
});
