import { describe, expect, it } from 'vitest';
import {
  editorReducers,
  reduceEditor,
  createTemplate,
} from '@/store/modules/editor';
import { createEmptyDocument } from '@/components/rcb/scene/document/sceneDocument';
import { buildShapeOutlines } from '@/components/rcb/selection/selectionLogic';

function seedWithTwoAnimationBoards() {
  let state = reduceEditor(undefined, () => {});
  state = reduceEditor(state, editorReducers.createTemplate, {
    name: 'multi-frame-chrome',
    document: createEmptyDocument({ emptyWorld: true }),
    emptyWorld: true,
    source: 'scratch',
  });
  const doc = {
    ...state.document!,
    frames: [
      {
        id: 'a1',
        kind: 'animation',
        name: '动画',
        x: 0,
        y: 0,
        width: 413,
        height: 413,
        backgroundColor: '#fff',
      },
      {
        id: 'a2',
        kind: 'animation',
        name: '动画',
        x: 500,
        y: 0,
        width: 413,
        height: 413,
        backgroundColor: '#fff',
      },
    ],
    stackOrder: ['frame:a1', 'frame:a2'],
  };
  state = reduceEditor(state, editorReducers.setDocumentFromCanvas, doc as any);
  return state;
}

describe('multi artboard/animation selection chrome', () => {
  it('setMixedSelection (marquee) uses full chrome for multi frames', () => {
    let state = seedWithTwoAnimationBoards();
    state = reduceEditor(state, editorReducers.setMixedSelection, {
      nodeIds: [],
      frameIds: ['a1', 'a2'],
    });
    expect(state.selectedFrameIds).toEqual(['a1', 'a2']);
    expect(state.frameChromeMode).toBe('full');
  });

  it('setMixedSelection uses full chrome for frames + scene nodes', () => {
    let state = seedWithTwoAnimationBoards();
    const doc = {
      ...state.document!,
      deltaSetLike: {
        ...(state.document!.deltaSetLike || {}),
        n1: {
          id: 'n1',
          key: 'rect',
          x: 100,
          y: 400,
          width: 40,
          height: 40,
          attrs: {},
          children: [],
        },
      },
      stackOrder: [...(state.document!.stackOrder || []), 'n1'],
    };
    state = reduceEditor(state, editorReducers.setDocumentFromCanvas, doc as any);
    state = reduceEditor(state, editorReducers.setMixedSelection, {
      nodeIds: ['n1'],
      frameIds: ['a1', 'a2'],
    });
    expect(state.selectedNodeIds).toEqual(['n1']);
    expect(state.selectedFrameIds).toEqual(['a1', 'a2']);
    expect(state.frameChromeMode).toBe('full');
  });

  it('buildShapeOutlines emits one union box for multi frames', () => {
    const state = seedWithTwoAnimationBoards();
    const outlines = buildShapeOutlines({
      enabled: true,
      suppressChrome: false,
      readOnly: false,
      document: state.document!,
      selectedNodeIds: [],
      selectedFrameIds: ['a1', 'a2'],
      hoverNodeId: null,
      inspectDev: false,
      transforming: false,
      inspectPrimaryId: null,
      inspectPairNodeId: null,
      singleId: null,
      chromeAngle: 0,
      selectedIsImageGen: false,
      selectedIsVideoGen: false,
      liveOrigins: null,
      getNodeBox: () => null,
    });
    const union = outlines.find((o) => o.id === '__rcb_frame_union__');
    expect(union).toBeTruthy();
    expect(union!.unionChrome).toBe(true);
    expect(union!.withHandles).toBe(true);
    expect(outlines.filter((o) => String(o.id).startsWith('__frame__:')).length).toBe(0);
  });
});
