/**
 * Post-split regression: exercise modules extracted from SelectionFeature /
 * editor / SvgCanvas so import + behavior stay wired.
 */
import { describe, expect, it } from 'vitest';
import {
  FRAME_SEL_PREFIX,
  frameSelId,
  parseFrameSelId,
} from '../frameSelectionIds';
import {
  computeMovedUnion,
  computeResizedUnion,
  framesHittingMarquee,
  filterMarqueeContentHits,
  commitMarqueeSelection,
  normalizeBox,
  boxesIntersect,
  ensureMinScreenHitBox,
  MARQUEE_MIN_HIT_SCREEN_PX,
  nodeHitsMarquee,
  resolveMarqueeCandidates,
  makeDragSeed,
  shiftConstrainedMoveDelta,
  resolveMoveAxisLock,
  constrainMoveDelta,
  visualGuideBoxForNode,
} from '../selectionLogic';
import { segmentIntersectsAabb } from '@/components/rcb/scene/document/sceneShapes';
import { inflateBoxByVisualOutset } from '@/components/rcb/scene/document/sceneEffects';
import { computeShapeBoolean, type ShapeBox } from '../shapeBoolean';
import { smartSnapThreshold } from '../alignGuides';
import {
  asHistoryEntry,
  cloneDocument,
  pushHistory,
  pushNodePatchHistory,
  restoreNodesIntoDocument,
  scrubNodeIdsFromHistory,
  type EditorHistoryHost,
} from '@/store/modules/editorHistory';
import {
  createEmptyDocument,
  addNodeToDocument,
} from '@/components/rcb/scene/document/sceneDocument';
import { createShapeNode } from '@/components/rcb/scene/document/nodeFactories';
import type { SceneDocument } from '@/components/rcb/sceneNode';

describe('frameSelectionIds', () => {
  it('round-trips frame ids and rejects plain node ids', () => {
    const id = frameSelId('frame_abc');
    expect(id.startsWith(FRAME_SEL_PREFIX)).toBe(true);
    expect(parseFrameSelId(id)).toBe('frame_abc');
    expect(parseFrameSelId('node_1')).toBeNull();
    expect(parseFrameSelId('')).toBeNull();
  });
});

describe('selectionLogic marquee helpers', () => {
  it('resolveMarqueeCandidates treats empty spatial as miss, not no-nodes', () => {
    const all = ['a', 'b', 'c'];
    expect(resolveMarqueeCandidates(['b'], all)).toEqual(['b']);
    expect(resolveMarqueeCandidates([], all)).toEqual(all);
    expect(resolveMarqueeCandidates(undefined, all)).toEqual(all);
    expect(resolveMarqueeCandidates(null, all)).toEqual(all);
  });

  it('normalizeBox + boxesIntersect', () => {
    const box = normalizeBox(120, 80, 20, 10);
    expect(box).toEqual({ left: 20, top: 10, width: 100, height: 70 });
    expect(boxesIntersect(box, { left: 90, top: 50, width: 40, height: 40 })).toBe(true);
    expect(boxesIntersect(box, { left: 200, top: 200, width: 10, height: 10 })).toBe(false);
  });

  it('ensureMinScreenHitBox expands hairline nodes in scene space', () => {
    const tiny = { left: 10, top: 10, width: 1, height: 1 };
    const expanded = ensureMinScreenHitBox(tiny, 1);
    expect(expanded.width).toBeGreaterThanOrEqual(MARQUEE_MIN_HIT_SCREEN_PX);
    expect(expanded.height).toBeGreaterThanOrEqual(MARQUEE_MIN_HIT_SCREEN_PX);
    // Center preserved.
    expect(expanded.left + expanded.width / 2).toBeCloseTo(10.5, 5);
    expect(expanded.top + expanded.height / 2).toBeCloseTo(10.5, 5);
  });

  it('nodeHitsMarquee selects tiny rect with a tight brush via hit pad', () => {
    const doc = {
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      deltaSetLike: {
        tiny: {
          id: 'tiny',
          key: 'shape',
          x: 100,
          y: 100,
          width: 2,
          height: 2,
          attrs: { shapeType: 'rect' },
          children: [],
        },
      },
    } satisfies Partial<SceneDocument> as SceneDocument;
    const getNodeBox = (id: string) => {
      const n = doc.deltaSetLike?.[id];
      if (!n) return null;
      return {
        left: Number(n.x) || 0,
        top: Number(n.y) || 0,
        width: Math.max(1, Number(n.width) || 1),
        height: Math.max(1, Number(n.height) || 1),
      };
    };
    // Brush grazes just outside the stored 2×2 box — pad + min hit should still catch it.
    const marquee = { left: 95, top: 95, width: 4, height: 4 };
    expect(nodeHitsMarquee(doc, 'tiny', marquee, getNodeBox, () => ({ x: 0, y: 0 }), 1)).toBe(
      true
    );
  });

  it('nodeHitsMarquee ignores frame-clipped overflow for filled path like rect', () => {
    // Frame 0..200; path geom overflows to x=400. Marquee sits entirely outside the frame.
    const doc = {
      x: 0,
      y: 0,
      width: 800,
      height: 800,
      frames: [{ id: 'f1', x: 0, y: 0, width: 200, height: 400, clipContent: true }],
      deltaSetLike: {
        clippedPath: {
          id: 'clippedPath',
          key: 'shape',
          x: 50,
          y: 50,
          width: 350,
          height: 200,
          attrs: {
            shapeType: 'path',
            closed: 'true',
            path: 'M 0 0 L 350 0 L 350 200 L 0 200 Z',
            frameId: 'f1',
          },
          children: [],
        },
        clippedRect: {
          id: 'clippedRect',
          key: 'shape',
          x: 50,
          y: 50,
          width: 350,
          height: 200,
          attrs: { shapeType: 'rect', frameId: 'f1' },
          children: [],
        },
      },
    } as SceneDocument;
    const getNodeBox = (id: string) => {
      const n = doc.deltaSetLike?.[id];
      if (!n) return null;
      return {
        left: Number(n.x) || 0,
        top: Number(n.y) || 0,
        width: Math.max(1, Number(n.width) || 1),
        height: Math.max(1, Number(n.height) || 1),
      };
    };
    const outsideMarquee = { left: 250, top: 80, width: 40, height: 120 };
    const toScene = () => ({ x: 0, y: 0 });
    expect(nodeHitsMarquee(doc, 'clippedRect', outsideMarquee, getNodeBox, toScene, 1)).toBe(
      false
    );
    expect(nodeHitsMarquee(doc, 'clippedPath', outsideMarquee, getNodeBox, toScene, 1)).toBe(
      false
    );
    // Brushing the still-visible remnant inside the frame still selects both.
    const insideMarquee = { left: 60, top: 60, width: 80, height: 80 };
    expect(nodeHitsMarquee(doc, 'clippedRect', insideMarquee, getNodeBox, toScene, 1)).toBe(true);
    expect(nodeHitsMarquee(doc, 'clippedPath', insideMarquee, getNodeBox, toScene, 1)).toBe(true);
  });

  it('nodeHitsMarquee ignores bound nodes from an adjacent artboard', () => {
    const doc = {
      frames: [
        { id: 'left', x: 0, y: 0, width: 200, height: 200, clipContent: true },
        { id: 'right', x: 300, y: 0, width: 200, height: 200, clipContent: true },
      ],
      deltaSetLike: {
        img: {
          id: 'img',
          key: 'image',
          x: 50,
          y: 50,
          width: 400,
          height: 400,
          attrs: { frameId: 'left', src: 'https://example.com/a.png' },
          children: [],
        },
      },
    } satisfies Partial<SceneDocument> as SceneDocument;
    const getNodeBox = (id: string) => {
      const n = doc.deltaSetLike?.[id];
      if (!n) return null;
      return {
        left: Number(n.x) || 0,
        top: Number(n.y) || 0,
        width: Math.max(1, Number(n.width) || 1),
        height: Math.max(1, Number(n.height) || 1),
      };
    };
    const rightMarquee = { left: 320, top: 20, width: 160, height: 160 };
    expect(nodeHitsMarquee(doc, 'img', rightMarquee, getNodeBox, () => ({ x: 0, y: 0 }), 1)).toBe(
      false
    );
    const leftMarquee = { left: 20, top: 20, width: 160, height: 160 };
    expect(nodeHitsMarquee(doc, 'img', leftMarquee, getNodeBox, () => ({ x: 0, y: 0 }), 1)).toBe(
      true
    );
    const filtered = filterMarqueeContentHits(doc, ['img'], new Set(), rightMarquee);
    expect(filtered).toEqual([]);
  });

  it('nodeHitsMarquee skips locked nodes of every kind (框选)', () => {
    const kinds = [
      { id: 'rect1', key: 'shape', attrs: { shapeType: 'rect', locked: 'true' } },
      { id: 'circ1', key: 'shape', attrs: { shapeType: 'circle', locked: true } },
      { id: 'path1', key: 'shape', attrs: { shapeType: 'path', locked: 'true', path: 'M 0 0 L 10 0 L 10 10 Z', closed: 'true' } },
      { id: 'pen1', key: 'shape', attrs: { shapeType: 'pen', locked: true, path: 'M 0 0 L 20 20' } },
      { id: 'img1', key: 'image', attrs: { locked: 'true' } },
      { id: 'txt1', key: 'text', attrs: { locked: true } },
    ] as const;
    const deltaSetLike: Record<string, unknown> = {};
    for (const k of kinds) {
      deltaSetLike[k.id] = {
        id: k.id,
        key: k.key,
        x: 50,
        y: 50,
        width: 100,
        height: 100,
        attrs: k.attrs,
        children: [],
      };
    }
    const unlocked = {
      id: 'free',
      key: 'shape',
      x: 50,
      y: 50,
      width: 100,
      height: 100,
      attrs: { shapeType: 'circle' },
      children: [],
    };
    deltaSetLike.free = unlocked;
    const doc = {
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      deltaSetLike,
    } as SceneDocument;
    const getNodeBox = (id: string) => {
      const n = doc.deltaSetLike?.[id];
      if (!n) return null;
      return {
        left: Number(n.x) || 0,
        top: Number(n.y) || 0,
        width: Math.max(1, Number(n.width) || 1),
        height: Math.max(1, Number(n.height) || 1),
      };
    };
    const marquee = { left: 40, top: 40, width: 120, height: 120 };
    const toScene = () => ({ x: 0, y: 0 });
    for (const k of kinds) {
      expect(nodeHitsMarquee(doc, k.id, marquee, getNodeBox, toScene, 1)).toBe(false);
    }
    expect(nodeHitsMarquee(doc, 'free', marquee, getNodeBox, toScene, 1)).toBe(true);
  });

  it('segmentIntersectsAabb catches off-center crossings (midpoint-only would miss)', () => {
    // Horizontal segment y=10 from x=0→20; tiny box at x=2..3 (midpoint at 10 is outside).
    expect(segmentIntersectsAabb(0, 10, 20, 10, 2, 8, 3, 12)).toBe(true);
    expect(segmentIntersectsAabb(0, 0, 1, 1, 50, 50, 60, 60)).toBe(false);
  });

  it('framesHittingMarquee + filter + commit', () => {
    const doc = {
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      frames: [
        { id: 'f1', name: 'F1', x: 0, y: 0, width: 100, height: 100, backgroundColor: '#fff' },
        { id: 'f2', name: 'F2', x: 200, y: 200, width: 50, height: 50, backgroundColor: '#fff' },
      ],
      deltaSetLike: {
        n1: { id: 'n1', key: 'rect', x: 10, y: 10, width: 20, height: 20, attrs: {}, children: [] },
        n2: { id: 'n2', key: 'rect', x: 210, y: 210, width: 10, height: 10, attrs: {}, children: [] },
        n3: { id: 'n3', key: 'rect', x: 120, y: 10, width: 20, height: 20, attrs: {}, children: [] },
        n4: { id: 'n4', key: 'rect', x: 80, y: 10, width: 50, height: 20, attrs: { frameId: 'f1' }, children: [] },
      },
    } satisfies Partial<SceneDocument> as SceneDocument;
    const hits = framesHittingMarquee(doc, { left: 0, top: 0, width: 120, height: 120 });
    expect(hits.map((h) => h.id)).toEqual(['f1']);

    const partialHits = framesHittingMarquee(doc, { left: 0, top: 0, width: 80, height: 80 });
    expect(partialHits).toEqual([]);

    const filtered = filterMarqueeContentHits(doc, ['n1', 'n2', 'n3', 'n4'], new Set(['f1']));
    expect(filtered).toContain('n1');
    expect(filtered).toContain('n3');
    expect(filtered).toContain('n4');
    expect(Array.isArray(filtered)).toBe(true);

    const selected: { nodes: string[]; frames: string[] } = { nodes: [], frames: [] };
    commitMarqueeSelection({
      contentHits: ['n1'],
      frameHits: hits.map((h) => h.id),
      rawHits: ['n1'],
      shiftKey: false,
      onSelectMixed: (nodes, frames) => {
        selected.nodes = nodes;
        selected.frames = frames;
      },
      onSelect: (nodes) => {
        selected.nodes = nodes;
      },
      onSelectFrames: (frames) => {
        selected.frames = frames;
      },
    });
    expect(selected.frames).toEqual(['f1']);
    expect(selected.nodes).toContain('n1');

    const emptyFrameSelection: { nodes: string[]; frames: string[] } = {
      nodes: [],
      frames: [],
    };
    commitMarqueeSelection({
      contentHits: [],
      frameHits: ['f1'],
      rawHits: [],
      shiftKey: false,
      onSelectMixed: (nodes, frames) => {
        emptyFrameSelection.nodes = nodes;
        emptyFrameSelection.frames = frames;
      },
      onSelect: (nodes) => {
        emptyFrameSelection.nodes = nodes;
      },
      onSelectFrames: (frames) => {
        emptyFrameSelection.frames = frames;
      },
    });
    expect(emptyFrameSelection.nodes).toEqual([]);
    expect(emptyFrameSelection.frames).toEqual(['f1']);

    const multipleFrameSelection: { nodes: string[]; frames: string[] } = {
      nodes: [],
      frames: [],
    };
    commitMarqueeSelection({
      contentHits: ['n1', 'n2'],
      frameHits: ['f1', 'f2'],
      rawHits: ['n1', 'n2'],
      shiftKey: false,
      onSelectMixed: (nodes, frames) => {
        multipleFrameSelection.nodes = nodes;
        multipleFrameSelection.frames = frames;
      },
      onSelect: (nodes) => {
        multipleFrameSelection.nodes = nodes;
      },
      onSelectFrames: (frames) => {
        multipleFrameSelection.frames = frames;
      },
    });
    expect(multipleFrameSelection.nodes).toEqual(['n1', 'n2']);
    expect(multipleFrameSelection.frames).toEqual(['f1', 'f2']);

    const mixedFrameAndCanvas: { nodes: string[]; frames: string[] } = {
      nodes: [],
      frames: [],
    };
    commitMarqueeSelection({
      contentHits: ['n3'],
      frameHits: ['f1'],
      rawHits: ['n1', 'n3', 'n4'],
      shiftKey: false,
      onSelectMixed: (nodes, frames) => {
        mixedFrameAndCanvas.nodes = nodes;
        mixedFrameAndCanvas.frames = frames;
      },
      onSelect: (nodes) => {
        mixedFrameAndCanvas.nodes = nodes;
      },
      onSelectFrames: (frames) => {
        mixedFrameAndCanvas.frames = frames;
      },
    });
    expect(mixedFrameAndCanvas.nodes).toEqual(['n3']);
    expect(mixedFrameAndCanvas.frames).toEqual(['f1']);

    const framesPlusOutside: { nodes: string[]; frames: string[] } = {
      nodes: [],
      frames: [],
    };
    commitMarqueeSelection({
      contentHits: ['n3'],
      frameHits: ['f1', 'f2'],
      rawHits: ['n3'],
      shiftKey: false,
      onSelectMixed: (nodes, frames) => {
        framesPlusOutside.nodes = nodes;
        framesPlusOutside.frames = frames;
      },
      onSelect: (nodes) => {
        framesPlusOutside.nodes = nodes;
      },
      onSelectFrames: (frames) => {
        framesPlusOutside.frames = frames;
      },
    });
    expect(framesPlusOutside.nodes).toEqual(['n3']);
    expect(framesPlusOutside.frames).toEqual(['f1', 'f2']);
  });
});

describe('selectionLogic shift axis move', () => {
  it('resolveMoveAxisLock picks dominant axis and keeps lock', () => {
    expect(resolveMoveAxisLock(12, 3)).toBe('h');
    expect(resolveMoveAxisLock(3, 12)).toBe('v');
    expect(resolveMoveAxisLock(5, 5)).toBe('h');
    expect(resolveMoveAxisLock(0, 0, 'v')).toBe('v');
  });

  it('constrainMoveDelta zeroes the cross axis', () => {
    expect(constrainMoveDelta(10, 4, 'h')).toEqual({ dx: 10, dy: 0 });
    expect(constrainMoveDelta(10, 4, 'v')).toEqual({ dx: 0, dy: 4 });
  });

  it('shiftConstrainedMoveDelta locks axis while Shift held', () => {
    const drag: { moveAxisLock?: 'h' | 'v' } = {};
    expect(shiftConstrainedMoveDelta(drag, 20, 5, true)).toEqual({ dx: 20, dy: 0 });
    expect(drag.moveAxisLock).toBe('h');
    expect(shiftConstrainedMoveDelta(drag, 20, 80, true)).toEqual({ dx: 20, dy: 0 });
    expect(shiftConstrainedMoveDelta(drag, 20, 80, false)).toEqual({ dx: 20, dy: 80 });
    expect(drag.moveAxisLock).toBeUndefined();
  });
});

describe('selectionLogic computeMovedUnion (grid + guide paint, no magnets)', () => {
  it('pins to grid and returns finite deltas', () => {
    const moving = { left: 98.4, top: 2.2, width: 40, height: 40 };
    const { nextUnion, sdx, sdy, guides } = computeMovedUnion({
      union: moving,
      origins: [{ nodeId: 'm', box: moving }],
      document: {
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        deltaSetLike: {
          m: { id: 'm', key: 'rect', x: 98.4, y: 2.2, width: 40, height: 40, attrs: {}, children: [] },
          s: { id: 's', key: 'rect', x: 0, y: 0, width: 100, height: 80, attrs: {}, children: [] },
        },
      } as SceneDocument,
      dx: 2,
      dy: -2,
      disableSnap: false,
      gridSize: 1,
      targets: [{ left: 0, top: 0, width: 100, height: 80 }],
      threshold: smartSnapThreshold(1),
    });
    expect(Number.isFinite(sdx)).toBe(true);
    expect(Number.isFinite(sdy)).toBe(true);
    expect(nextUnion.width).toBe(40);
    expect(nextUnion.height).toBe(40);
    expect(Array.isArray(guides)).toBe(true);
  });

  it('align guides follow mover path top (not outer ink, not a fixed y)', () => {
    const pathTop = 20;
    const pathLeft = 100;
    const centerStroke = {
      id: 'm',
      key: 'shape',
      x: pathLeft,
      y: pathTop,
      width: 40,
      height: 40,
      attrs: {
        shapeType: 'rect',
        'border-width': 2,
        'border-color': '#333',
        strokeAlign: 'center',
        'stroke-enabled': 'true',
        'stroke-visible': 'true',
      },
      children: [],
    };
    const sibling = {
      id: 's',
      key: 'shape',
      x: 10,
      y: pathTop,
      width: 50,
      height: 80,
      attrs: { ...centerStroke.attrs },
      children: [],
    };
    // Selection chrome = path geom (stroke does not expand the control box).
    const chrome = { left: pathLeft, top: pathTop, width: 40, height: 40 };
    const doc = {
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      deltaSetLike: { m: centerStroke, s: sibling },
    } as SceneDocument;
    const moverPath = visualGuideBoxForNode('m', doc, chrome);
    const targetPath = visualGuideBoxForNode('s', doc, {
      left: 10,
      top: pathTop,
      width: 50,
      height: 80,
    });
    expect(moverPath?.top).toBe(pathTop);
    expect(targetPath?.top).toBe(pathTop);

    const { guides, sdy } = computeMovedUnion({
      union: chrome,
      origins: [{ nodeId: 'm', box: chrome }],
      document: doc,
      dx: 0,
      dy: 0,
      disableSnap: false,
      gridSize: 0,
      targets: targetPath ? [targetPath] : [],
      threshold: 8,
    });
    expect(sdy).toBe(0);
    const topAlign = guides.find(
      (g) => g.kind === 'align' && g.axis === 'y' && Math.abs(g.at - pathTop) < 1e-9
    );
    expect(topAlign).toBeTruthy();
    // Must track mover path, not outer-ink (path − visualOutset for center sw=2).
    const outerInkTop = pathTop - 1;
    expect(guides.some((g) => g.kind === 'align' && g.axis === 'y' && g.at === outerInkTop)).toBe(
      false
    );
  });

  it('near-miss edge gap auto-snaps flush', () => {
    const left = { left: 0, top: 0, width: 100, height: 80 };
    const rightChrome = { left: 102, top: 0, width: 40, height: 40 };
    const { guides, sdx, nextUnion } = computeMovedUnion({
      union: rightChrome,
      origins: [{ nodeId: 'm', box: rightChrome }],
      document: {
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        deltaSetLike: {
          m: {
            id: 'm',
            key: 'shape',
            x: 102,
            y: 0,
            width: 40,
            height: 40,
            attrs: {
              shapeType: 'rect',
              'border-width': 0,
              'stroke-enabled': 'false',
              'stroke-visible': 'false',
            },
            children: [],
          },
        },
      } as SceneDocument,
      dx: 0,
      dy: 0,
      disableSnap: false,
      gridSize: 1,
      targets: [left],
      threshold: 8,
    });
    expect(sdx).toBe(-2);
    expect(nextUnion.left).toBe(100);
    expect(guides.some((g) => g.kind === 'align' && g.axis === 'x' && g.at === 100)).toBe(true);
  });

  it('top edges within threshold auto-snap and paint a horizontal guide', () => {
    const left = { left: 0, top: 20, width: 100, height: 80 };
    const rightChrome = { left: 120, top: 24, width: 60, height: 50 };
    const { guides, sdy, nextUnion } = computeMovedUnion({
      union: rightChrome,
      origins: [{ nodeId: 'm', box: rightChrome }],
      document: {
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        deltaSetLike: {
          m: {
            id: 'm',
            key: 'shape',
            x: 120,
            y: 24,
            width: 60,
            height: 50,
            attrs: {
              shapeType: 'rect',
              'border-width': 0,
              'stroke-enabled': 'false',
              'stroke-visible': 'false',
            },
            children: [],
          },
        },
      } as SceneDocument,
      dx: 0,
      dy: 0,
      disableSnap: false,
      gridSize: 1,
      targets: [left],
      threshold: 8,
    });
    expect(sdy).toBe(-4);
    expect(nextUnion.top).toBe(20);
    expect(guides.some((g) => g.kind === 'align' && g.axis === 'y' && g.at === 20)).toBe(true);
  });

  it('visual-outer grid can land flush on a neighbor edge', () => {
    const left = { left: 0, top: 0, width: 100, height: 80 };
    // Explicitly no stroke so visual === path; pointer aims just past flush → 100.
    const rightChrome = { left: 100.4, top: 0, width: 40, height: 40 };
    const { nextUnion, guides } = computeMovedUnion({
      union: rightChrome,
      origins: [{ nodeId: 'm', box: rightChrome }],
      document: {
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        deltaSetLike: {
          m: {
            id: 'm',
            key: 'shape',
            x: 100.4,
            y: 0,
            width: 40,
            height: 40,
            attrs: {
              shapeType: 'rect',
              'border-width': 0,
              'stroke-enabled': 'false',
              'stroke-visible': 'false',
            },
            children: [],
          },
        },
      } as SceneDocument,
      dx: 0,
      dy: 0,
      disableSnap: false,
      gridSize: 1,
      targets: [left],
      threshold: 8,
    });
    expect(nextUnion.left).toBe(100);
    expect(guides.some((g) => g.kind === 'align' && g.axis === 'x' && g.at === 100)).toBe(true);
  });

  it('center-stroke move keeps outer ink on grid (not path integers)', () => {
    // Chrome = path at *.5; center sw=1 → outer ink at integers after snap.
    const chrome = { left: 100.5, top: 20.5, width: 40, height: 40 };
    const node = {
      id: 'm',
      key: 'shape',
      x: 100.5,
      y: 20.5,
      width: 40,
      height: 40,
      attrs: {
        shapeType: 'rect',
        'border-width': 1,
        'border-color': '#333',
        strokeAlign: 'center',
        'stroke-enabled': 'true',
        'stroke-visible': 'true',
      },
      children: [],
    };
    const { nextUnion, sdx } = computeMovedUnion({
      union: chrome,
      origins: [{ nodeId: 'm', box: chrome }],
      document: {
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        deltaSetLike: { m: node },
      } as SceneDocument,
      dx: 2.3,
      dy: 0,
      disableSnap: false,
      gridSize: 1,
      targets: [],
      threshold: 8,
    });
    const visual = inflateBoxByVisualOutset(nextUnion, node);
    expect(Number.isInteger(visual.left)).toBe(true);
    expect(sdx).toBe(nextUnion.left - chrome.left);
    expect(Math.abs(sdx - 2.3)).toBeLessThan(0.6);
  });

  it('re-applies axis lock after smart snap nudge', () => {
    const moving = { left: 0, top: 0, width: 40, height: 40 };
    const { sdx, sdy } = computeMovedUnion({
      union: moving,
      origins: [{ nodeId: 'm', box: moving }],
      document: {
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        deltaSetLike: {
          m: { id: 'm', key: 'rect', x: 0, y: 0, width: 40, height: 40, attrs: {}, children: [] },
          s: { id: 's', key: 'rect', x: 200, y: 0, width: 100, height: 80, attrs: {}, children: [] },
        },
      } as SceneDocument,
      dx: 50,
      dy: 8,
      disableSnap: false,
      gridSize: 1,
      axisLock: 'h',
      targets: [{ left: 200, top: 0, width: 100, height: 80 }],
      threshold: smartSnapThreshold(1),
    });
    expect(sdy).toBe(0);
    expect(Math.abs(sdx)).toBeGreaterThan(0);
  });
});

describe('selectionLogic computeResizedUnion', () => {
  it('keeps text width fixed when dragging top or bottom edge, even if locked', () => {
    const box = { left: 10, top: 20, width: 100, height: 50 };
    const drag = makeDragSeed(
      'resize',
      { clientX: 60, clientY: 20 },
      { x: 60, y: 20 },
      {
        handle: 's',
        origins: [{ nodeId: 'text', box }],
        union: box,
        angle0: 0,
        aspectRatio: 2,
      }
    );
    const result = computeResizedUnion({
      document: {
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        deltaSetLike: {
          text: {
            id: 'text',
            key: 'text',
            x: 10,
            y: 20,
            width: 100,
            height: 50,
            attrs: { lockAspect: true },
            children: [],
          },
        },
      } as SceneDocument,
      drag,
      dx: 0,
      dy: 20,
      shiftKey: false,
      disableSnap: true,
      gridSize: 1,
      targets: [],
      threshold: 8,
    });
    expect(result.lockAspect).toBe(false);
    expect(result.next.width).toBe(100);
    expect(result.next.height).toBe(70);
  });

  it('grows from se handle', () => {
    const box = { left: 10, top: 20, width: 100, height: 50 };
    const drag = makeDragSeed(
      'resize',
      { clientX: 110, clientY: 70 },
      { x: 110, y: 70 },
      {
        handle: 'se',
        origins: [{ nodeId: 'r', box }],
        union: box,
        angle0: 0,
        aspectRatio: 2,
      }
    );
    const { next, lockAspect, guides } = computeResizedUnion({
      document: {
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        deltaSetLike: {
          r: { id: 'r', key: 'rect', x: 10, y: 20, width: 100, height: 50, attrs: {}, children: [] },
        },
      } as SceneDocument,
      drag,
      dx: 20,
      dy: 10,
      shiftKey: false,
      disableSnap: false,
      gridSize: 1,
      targets: [],
      threshold: smartSnapThreshold(1),
    });
    expect(next.width).toBeGreaterThan(100);
    expect(next.height).toBeGreaterThan(50);
    expect(typeof lockAspect).toBe('boolean');
    expect(Array.isArray(guides)).toBe(true);
  });
});

describe('boolean ops (all modes)', () => {
  const a: ShapeBox = {
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    shapeType: 'rect',
  };
  const b: ShapeBox = {
    left: 50,
    top: 50,
    width: 100,
    height: 100,
    shapeType: 'rect',
  };

  it.each(['union', 'subtract', 'intersect', 'exclude'] as const)('%s two overlapping rects', (mode) => {
    const { result, usedFallback } = computeShapeBoolean([a, b], mode);
    expect(result).not.toBeNull();
    expect(usedFallback).toBe(false);
    expect(result!.width).toBeGreaterThan(0);
    expect(result!.height).toBeGreaterThan(0);
    expect(String(result!.path || '').length).toBeGreaterThan(4);
  });
});

describe('editorHistory post-split', () => {
  it('push/scrub/restore node patches', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    const { id, node } = createShapeNode({
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      shapeType: 'rect',
      fill: '#111',
    });
    doc = addNodeToDocument(doc, id, node);
    const host: EditorHistoryHost = {
      document: doc,
      historyPast: [],
      historyFuture: [],
    };
    pushHistory(host);
    expect(asHistoryEntry(host.historyPast[0]!).kind).toBe('snap');
    expect(cloneDocument(doc)?.deltaSetLike?.[id]).toBeTruthy();

    pushNodePatchHistory(host, [id]);
    const last = asHistoryEntry(host.historyPast[host.historyPast.length - 1]!);
    expect(last.kind).toBe('nodes');

    const patched = {
      ...doc,
      deltaSetLike: {
        ...doc.deltaSetLike,
        [id]: {
          ...doc.deltaSetLike[id],
          attrs: { ...doc.deltaSetLike[id].attrs, 'fill-color': '#f00' },
        },
      },
    };
    const restored = restoreNodesIntoDocument(patched, (last as any).before);
    expect(restored.deltaSetLike[id].attrs['fill-color']).not.toBe('#f00');

    scrubNodeIdsFromHistory(host, [id]);
    for (const raw of host.historyPast) {
      const e = asHistoryEntry(raw);
      if (e.kind === 'nodes') expect(id in e.before).toBe(false);
      if (e.kind === 'snap') expect(e.doc?.deltaSetLike?.[id]).toBeFalsy();
    }
  });
});
