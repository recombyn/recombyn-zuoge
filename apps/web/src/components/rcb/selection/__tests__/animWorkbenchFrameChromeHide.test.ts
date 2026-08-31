import { describe, expect, it } from 'vitest';
import { buildShapeOutlines } from '../selectionLogic';
import { frameSelId } from '../frameSelectionIds';
import type { SceneDocument } from '@/components/rcb/sceneNode';

function baseOpts(overrides: Partial<Parameters<typeof buildShapeOutlines>[0]> = {}) {
  return {
    enabled: true,
    suppressChrome: false,
    readOnly: false,
    document: {
      frames: [],
      deltaSetLike: {},
    } as unknown as SceneDocument,
    selectedNodeIds: [] as string[],
    selectedFrameIds: [] as string[],
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
    ...overrides,
  };
}

describe('frame chrome while transforming', () => {
  it('hides host union chrome for artboard and 动画工作台 alike (same as shapes)', () => {
    for (const kind of ['artboard', 'animation'] as const) {
      const doc = {
        frames: [
          {
            id: 'f1',
            kind,
            name: kind === 'animation' ? '动画' : '画板',
            x: 0,
            y: 0,
            width: 200,
            height: 200,
            backgroundColor: '#fff',
          },
        ],
        deltaSetLike: {},
      } as unknown as SceneDocument;

      const idle = buildShapeOutlines(
        baseOpts({
          document: doc,
          selectedFrameIds: ['f1'],
          transforming: false,
        })
      );
      expect(idle.some((o) => o.id === frameSelId('f1'))).toBe(true);

      const moving = buildShapeOutlines(
        baseOpts({
          document: doc,
          selectedFrameIds: ['f1'],
          transforming: true,
        })
      );
      expect(moving.some((o) => o.id === frameSelId('f1'))).toBe(false);

      // Title-drag path sets suppressChrome (movingFrameId) without SelectionFeature transforming.
      const titleDrag = buildShapeOutlines(
        baseOpts({
          document: doc,
          selectedFrameIds: ['f1'],
          transforming: false,
          suppressChrome: true,
        })
      );
      expect(titleDrag).toEqual([]);
    }
  });

  it('skips hover path silhouette for 动画工作台 preview children', () => {
    const doc = {
      frames: [
        {
          id: 'anim1',
          kind: 'animation',
          name: '动画',
          x: 0,
          y: 0,
          width: 200,
          height: 200,
          backgroundColor: '#fff',
        },
      ],
      deltaSetLike: {
        circ: {
          id: 'circ',
          key: 'shape',
          x: 150,
          y: 50,
          width: 80,
          height: 80,
          attrs: { shapeType: 'ellipse', frameId: 'anim1' },
        },
      },
    } as unknown as SceneDocument;

    const outlines = buildShapeOutlines(
      baseOpts({
        document: doc,
        selectedFrameIds: ['anim1'],
        hoverNodeId: 'circ',
        getNodeBox: (id) =>
          id === 'circ'
            ? { left: 150, top: 50, width: 80, height: 80 }
            : null,
      })
    );
    expect(outlines.some((o) => o.id === 'circ')).toBe(false);
    expect(outlines.some((o) => o.id === frameSelId('anim1'))).toBe(true);
  });

  it('resolveFrameChromeBox prefers live artboard geometry over stale document', async () => {
    const { resolveFrameChromeBox } = await import('../selectionLogic');
    const { previewArtboardFrameGeometry, clearLiveArtboardFrameGeometry } = await import(
      '@/components/rcb/frames/HtmlArtboardFrame'
    );
    previewArtboardFrameGeometry({ id: 'f1', x: 120, y: 80, width: 200, height: 200 });
    const box = resolveFrameChromeBox('f1', { x: 0, y: 0, width: 200, height: 200 });
    expect(box.left).toBe(120);
    expect(box.top).toBe(80);
    clearLiveArtboardFrameGeometry(['f1']);
  });
});
