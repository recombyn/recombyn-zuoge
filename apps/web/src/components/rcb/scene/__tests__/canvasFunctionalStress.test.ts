/**
 * Canvas functional stress — correctness under load / extreme zoom.
 *
 * Perf benches alone can pass while grid/chrome/pen/outline/move break.
 * This suite asserts product surfaces stay usable on ADR 0027 paths:
 * CameraTransform, screen chrome, spatial hit, preview commit split.
 *
 * Run: `npm run test:stress --workspace=apps/web`
 * Full matrix: `npm run test:canvas:stress`
 */
import { describe, expect, it } from 'vitest';
import {
  createCameraTransform,
  worldScreenRoundTripErrorPx,
  worldToScreen,
  stageLocalToWorld,
} from '@/components/rcb/camera/transform';
import { RCB_MAX_ZOOM, RCB_MIN_ZOOM, rcbCameraCssZoom } from '@/components/rcb/core/math';
import { SceneSpatialRuntime, nodeSceneAabb } from '@/components/rcb/core/spatialIndex';
import {
  clearNodeTransformPreviews,
  effectivePaintBox,
  setNodeTransformPreviews,
} from '@/components/rcb/core/transformPreview';
import { drawSceneGrid, sceneGridLineWidth } from '@/components/rcb/render/sceneRenderer';
import {
  addNodeToDocument,
  createEmptyDocument,
} from '@/components/rcb/scene/document/sceneDocument';
import { createShapeNode, createTextNode } from '@/components/rcb/scene/document/nodeFactories';
import {
  inflateBoxByVisualOutset,
  inflateSelectionBox,
  deflateSelectionBox,
} from '@/components/rcb/scene/document/sceneEffects';
import {
  isEditablePathNode,
  normalizePathDForEdit,
} from '@/components/rcb/scene/paint/outlineToPath';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import {
  DEFAULT_GRID_SIZE,
  getDocumentGridSize,
  snapBoxToGrid,
  snapCoordToGrid,
  smartSnapThreshold,
} from '@/components/rcb/selection/alignGuides';
import {
  sceneChromeBodyTransform,
  chromeHandleHitRadiusScene,
  pickChromeHandleByGeometry,
  CHROME_HANDLE_HIT_PX,
} from '@/components/rcb/selection/SelectionChrome';
import {
  computeMovedUnion,
  computeResizedUnion,
  makeDragSeed,
} from '@/components/rcb/selection/selectionLogic';
import { computeShapeBoolean } from '@/components/rcb/selection/shapeBoolean';
import { snapPenAnchorPoint } from '@/components/rcb/tools/PenDrawFeature';
import { penAnchorsToD, penSubpathsFromD } from '@/components/rcb/tools/penPath';

const EXTREME_ZOOMS = [RCB_MIN_ZOOM, 0.31, 1, 8, 20, 60.84, RCB_MAX_ZOOM] as const;
const GRID = DEFAULT_GRID_SIZE;

function assertOnLattice(v: number, g = GRID) {
  expect(Math.abs(v - snapCoordToGrid(v, g))).toBeLessThan(1e-9);
}

function docWithRoot(nodes: SceneDocument['deltaSetLike']): SceneDocument {
  const ids = Object.keys(nodes).filter((id) => id !== 'ROOT');
  return {
    x: 0,
    y: 0,
    width: 4000,
    height: 4000,
    gridSize: GRID,
    deltaSetLike: {
      ROOT: {
        id: 'ROOT',
        key: 'group',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        attrs: {},
        children: ids,
      },
      ...nodes,
    },
  };
}

describe('canvas functional stress (可用性)', () => {
  it('grid paint axes stay on snap lattice at every zoom (incl. 10000%)', () => {
    for (const zoom of EXTREME_ZOOMS) {
      const moves: Array<[number, number]> = [];
      const ctx = {
        beginPath() {},
        moveTo(x: number, y: number) {
          moves.push([x, y]);
        },
        lineTo() {},
        stroke() {},
        strokeStyle: '',
        lineWidth: 0,
        lineCap: '',
      };
      drawSceneGrid(
        ctx as unknown as CanvasRenderingContext2D,
        { x: -2.3, y: 4.7, width: 40, height: 30 },
        GRID,
        zoom
      );
      expect(moves.length).toBeGreaterThan(0);
      for (const [x, y] of moves) {
        assertOnLattice(x);
        assertOnLattice(y);
      }
      expect(sceneGridLineWidth(GRID, zoom)).toBeCloseTo(Math.min(GRID * 0.35, 1 / zoom), 8);
    }
  });

  it('camera world↔screen round-trip stays sub-pixel at extreme zoom', () => {
    const camera = { x: -412.37, y: 88.12, zoom: RCB_MAX_ZOOM };
    const t = createCameraTransform(camera, 1);
    const samples = [
      [0, 0],
      [12.5, -3],
      [480, 320],
      [-50.25, 90.75],
    ] as const;
    for (const [wx, wy] of samples) {
      expect(worldScreenRoundTripErrorPx(t, wx, wy)).toBeLessThan(0.05);
      const screen = worldToScreen(t, wx, wy);
      const back = stageLocalToWorld(t, screen.x, screen.y);
      expect(back.x).toBeCloseTo(wx, 6);
      expect(back.y).toBeCloseTo(wy, 6);
    }
    expect(rcbCameraCssZoom(camera)).toBe(RCB_MAX_ZOOM);
  });

  it('selection chrome body is screen-space via CameraTransform (ADR 0027)', () => {
    const camera = { x: 10, y: -4, zoom: RCB_MAX_ZOOM };
    const box = { left: 100.5, top: 40, width: 5, height: 3 };
    expect(sceneChromeBodyTransform(box, 0)).toBe('translate(100.5 40)');
    expect(sceneChromeBodyTransform(box, 12)).toBe(
      'translate(100.5 40) translate(2.5 1.5) rotate(12) translate(-2.5 -1.5)'
    );
    const hit = chromeHandleHitRadiusScene(RCB_MAX_ZOOM, CHROME_HANDLE_HIT_PX, 1);
    expect(hit * RCB_MAX_ZOOM).toBeCloseTo(CHROME_HANDLE_HIT_PX / 2, 6);
  });

  it('chrome handle geometry pick stays screen-stable across extreme zooms', () => {
    const box = { left: 10, top: 20, width: 40, height: 30 };
    for (const zoom of EXTREME_ZOOMS) {
      const se = pickChromeHandleByGeometry(box.left + box.width, box.top + box.height, {
        box,
        zoom,
        showHandles: true,
        showRotate: true,
      });
      expect(se?.kind).toBe('resize');
      if (se?.kind === 'resize') expect(se.handle).toBe('se');

      const hitR = chromeHandleHitRadiusScene(zoom, CHROME_HANDLE_HIT_PX, 1);
      expect(hitR * zoom).toBeCloseTo(CHROME_HANDLE_HIT_PX / 2, 6);

      // Far outside even min-zoom scene hit radius (hitR = screenPx/2/zoom grows large).
      const miss = pickChromeHandleByGeometry(box.left - 1e6, box.top - 1e6, {
        box,
        zoom,
        showHandles: true,
        showRotate: true,
      });
      expect(miss).toBeNull();
    }
  });

  it('pen place + many commits stay on grid-cell perimeter targets', () => {
    const placed: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 200; i += 1) {
      const raw = { x: 10 + (i % 17) * 0.37, y: 20 + (i % 13) * 0.41 };
      const p = snapPenAnchorPoint(raw.x, raw.y, GRID, false);
      placed.push(p);
      const x2 = Math.round((p.x / GRID) * 2);
      const y2 = Math.round((p.y / GRID) * 2);
      expect(Math.abs(p.x / GRID - x2 / 2)).toBeLessThan(1e-9);
      expect(Math.abs(p.y / GRID - y2 / 2)).toBeLessThan(1e-9);
      expect(x2 % 2 === 0 || y2 % 2 === 0).toBe(true);
    }
    const d = penAnchorsToD(
      placed.slice(0, 8).map((p) => ({ x: p.x, y: p.y })),
      true
    );
    expect(d.length).toBeGreaterThan(8);
    const sub = penSubpathsFromD(d);
    expect(sub.length).toBeGreaterThanOrEqual(1);
  });

  it('outline → path-edit: normalize + editable + anchors parse after 轮廓化-like d', () => {
    const raw = 'M 0 0 H 5 V 3 H 0 Z M 1 1 H 4 V 2 H 1 Z'; // donut outer+inner
    const normalized = normalizePathDForEdit(raw) || raw;
    expect(normalized.trim().length).toBeGreaterThan(4);
    const subs = penSubpathsFromD(normalized);
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(subs[0]!.anchors.length).toBeGreaterThanOrEqual(2);

    const node = createShapeNode({
      x: 0,
      y: 0,
      width: 5,
      height: 3,
      shapeType: 'path',
      fill: '#333',
      stroke: 'none',
    }).node;
    node.attrs = { ...node.attrs, path: normalized, shapeType: 'path', 'stroke-enabled': false };
    expect(isEditablePathNode(node)).toBe(true);
  });

  it('move / resize under high zoom keep box on grid', () => {
    const zoom = RCB_MAX_ZOOM;
    const box = snapBoxToGrid({ left: 10.2, top: 20.4, width: 40, height: 24 }, GRID);
    const fillOnly = {
      id: 'm',
      key: 'shape' as const,
      x: box.left,
      y: box.top,
      width: box.width,
      height: box.height,
      attrs: {
        shapeType: 'rect',
        'fill-color': '#eee',
        'stroke-enabled': 'false',
        'border-width': 0,
      },
      children: [],
    };
    const stroked = {
      ...fillOnly,
      id: 's',
      attrs: {
        shapeType: 'rect',
        'fill-color': '#eee',
        'stroke-enabled': 'true',
        'border-width': 1,
        'border-color': '#333',
        strokeAlign: 'center',
      },
    };
    const document = docWithRoot({ m: fillOnly, s: stroked });

    const movedFill = computeMovedUnion({
      union: box,
      origins: [{ nodeId: 'm', box }],
      document,
      dx: 5.7,
      dy: 6.3,
      disableSnap: false,
      gridSize: GRID,
      targets: [],
      threshold: smartSnapThreshold(zoom),
    });
    assertOnLattice(movedFill.nextUnion.left);
    assertOnLattice(movedFill.nextUnion.top);
    expect(movedFill.nextUnion.width).toBe(box.width);
    expect(movedFill.nextUnion.height).toBe(box.height);

    // Center stroke: chrome = path (may sit on half-grid); grid snap targets outer ink.
    const strokePath = {
      left: box.left + 0.5,
      top: box.top + 0.5,
      width: Math.max(1, box.width - 1),
      height: Math.max(1, box.height - 1),
    };
    const strokeChrome = inflateSelectionBox(strokePath, stroked);
    expect(strokeChrome.left).toBe(strokePath.left);
    expect(strokeChrome.top).toBe(strokePath.top);
    const strokeVisual0 = inflateBoxByVisualOutset(strokePath, stroked);
    assertOnLattice(strokeVisual0.left);
    assertOnLattice(strokeVisual0.top);
    const movedStroke = computeMovedUnion({
      union: strokeChrome,
      origins: [{ nodeId: 's', box: strokeChrome }],
      document,
      dx: 5.7,
      dy: 6.3,
      disableSnap: false,
      gridSize: GRID,
      targets: [],
      threshold: smartSnapThreshold(zoom),
    });
    const pathAfter = deflateSelectionBox(movedStroke.nextUnion, stroked);
    const visual = inflateBoxByVisualOutset(pathAfter, stroked);
    assertOnLattice(visual.left);
    assertOnLattice(visual.top);

    const drag = makeDragSeed(
      'resize',
      { clientX: 0, clientY: 0 },
      { x: box.left + box.width, y: box.top + box.height },
      {
        handle: 'se',
        origins: [{ nodeId: 'm', box }],
        union: box,
        angle0: 0,
        aspectRatio: box.width / box.height,
      }
    );
    const { next } = computeResizedUnion({
      document,
      drag,
      dx: 3.4,
      dy: 2.1,
      shiftKey: false,
      disableSnap: false,
      gridSize: GRID,
      targets: [],
      threshold: smartSnapThreshold(zoom),
    });
    assertOnLattice(next.left);
    assertOnLattice(next.top);
    assertOnLattice(next.left + next.width);
    assertOnLattice(next.top + next.height);
    expect(next.width).toBeGreaterThanOrEqual(box.width);
    expect(next.height).toBeGreaterThanOrEqual(box.height);
  });

  it('transform preview paint box tracks drag without dropping geometry', () => {
    const id = 'stress-preview';
    setNodeTransformPreviews([
      { nodeId: id, left: 10, top: 20, width: 40, height: 30, angle: 0 },
    ]);
    const paint = effectivePaintBox(id, { left: 0, top: 0, width: 40, height: 30 }, 0);
    expect(paint.left).toBe(10);
    expect(paint.top).toBe(20);
    expect(paint.width).toBe(40);
    clearNodeTransformPreviews([id]);
    const idle = effectivePaintBox(id, { left: 5, top: 6, width: 40, height: 30 }, 15);
    expect(idle.left).toBe(5);
    expect(idle.angle).toBe(15);
  });

  it('boolean + mixed document churn stays consistent (tools remain usable)', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    doc = { ...doc, gridSize: GRID };
    expect(getDocumentGridSize(doc)).toBe(GRID);

    const ids: string[] = [];
    for (let i = 0; i < 80; i += 1) {
      const kind = (['rect', 'circle', 'polygon', 'star'] as const)[i % 4]!;
      const created = createShapeNode({
        x: snapCoordToGrid(i * 3.2, GRID),
        y: snapCoordToGrid(i * 2.1, GRID),
        width: 24,
        height: 18,
        shapeType: kind,
        fill: '#eee',
        stroke: '#333',
      });
      doc = addNodeToDocument(doc, created.id, created.node);
      ids.push(created.id);
    }
    const text = createTextNode({
      x: 0,
      y: 400,
      width: 120,
      height: 32,
      text: 'stress',
    });
    doc = addNodeToDocument(doc, text.id, text.node);

    const a = doc.deltaSetLike[ids[0]!]!;
    const b = doc.deltaSetLike[ids[1]!]!;
    const { result } = computeShapeBoolean(
      [
        {
          left: Number(a.x) || 0,
          top: Number(a.y) || 0,
          width: Number(a.width) || 1,
          height: Number(a.height) || 1,
          shapeType: String(a.attrs?.shapeType || 'rect'),
          path: String(a.attrs?.path || ''),
          angle: Number(a.attrs?.angle) || 0,
        },
        {
          left: Number(b.x) || 0,
          top: Number(b.y) || 0,
          width: Number(b.width) || 1,
          height: Number(b.height) || 1,
          shapeType: String(b.attrs?.shapeType || 'rect'),
          path: String(b.attrs?.path || ''),
          angle: Number(b.attrs?.angle) || 0,
        },
      ],
      'union'
    );
    expect(result).not.toBeNull();
    expect(String(result?.path || '').length).toBeGreaterThan(4);
    expect(Object.keys(doc.deltaSetLike || {}).length).toBeGreaterThanOrEqual(81);
  });

  it('spatial index cull/hit stays usable with hundreds of nodes at extreme zoom', () => {
    const nodes: SceneDocument['deltaSetLike'] = {};
    const children: string[] = [];
    for (let i = 0; i < 400; i += 1) {
      const id = `n${i}`;
      children.push(id);
      nodes[id] = {
        id,
        key: 'shape',
        x: (i % 40) * 30,
        y: Math.floor(i / 40) * 30,
        width: 20,
        height: 20,
        attrs: { shapeType: 'rect' },
        children: [],
      };
    }
    const document = docWithRoot(nodes);
    const runtime = new SceneSpatialRuntime(64);
    runtime.sync({
      document,
      childrenIds: children,
      reloadToken: 1,
      aabbPad: 8,
    });
    expect(runtime.size).toBe(400);

    const target = children[123]!;
    const aabb = nodeSceneAabb(document, target, 0);
    expect(aabb).toBeTruthy();
    if (!aabb) return;
    const cx = (aabb.minX + aabb.maxX) / 2;
    const cy = (aabb.minY + aabb.maxY) / 2;
    const hits = runtime.index.searchPoint(cx, cy, 2);
    expect(hits.some((h) => h.id === target)).toBe(true);

    for (const zoom of [RCB_MIN_ZOOM, 1, RCB_MAX_ZOOM] as const) {
      const camera = { x: -aabb.minX * zoom, y: -aabb.minY * zoom, zoom };
      const t = createCameraTransform(camera, 1);
      const screen = worldToScreen(t, cx, cy);
      const back = stageLocalToWorld(t, screen.x, screen.y);
      expect(back.x).toBeCloseTo(cx, 5);
      expect(back.y).toBeCloseTo(cy, 5);
    }
  });
});
