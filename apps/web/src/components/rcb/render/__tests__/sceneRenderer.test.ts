import { describe, expect, it, vi } from 'vitest';
import {
  clearSceneCanvasIdlePaint,
  createCanvasSceneRenderer,
  createSceneRenderer,
  createSvgSceneRenderer,
  dirtyTouchesNode,
  drawSceneGrid,
  getSceneCanvasIdlePaint,
  hitTestWithSpatialIndex,
  isFullDirty,
  listSceneCanvasIdlePaintIds,
  canvasIdleIsStrokeOnly,
  canIdlePaintOnCanvas,
  createCanvasAngularGradient,
  clearFillImageCache,
  setFillImageCacheEntry,
  bumpSceneCanvasIdlePaint,
  subscribeSceneCanvasIdlePaint,
  paintBasicShapeFill,
  paintCanvasShapeInk,
  paintCanvasPathInk,
  paintCanvasTextInk,
  paintCanvasIdleNode,
  paintCanvasMediaInk,
  clipCanvasIdleToOwningFrame,
  paintStrokeCanvasIdle,
  paintTextProxyLines,
  resolveCanvasFillStyle,
  sceneGridLineWidth,
  setSceneCanvasIdlePaint,
  strokeCanvasIdleCenterline,
  type DirtyRegion,
} from '../sceneRenderer';
import { SceneSpatialRuntime } from '@/components/rcb/core/spatialIndex';
import type { SceneDocument, SceneNodeInput } from '@/components/rcb/sceneNode';
import { PIXEL_GRID_MIN_ZOOM } from '@/components/rcb/selection/alignGuides';

function emptyDoc(): SceneDocument {
  return {
    deltaSetLike: {
      ROOT: {
        id: 'ROOT',
        key: 'group',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        attrs: {},
        children: [],
      },
    },
  };
}

function rectDoc(): SceneDocument {
  return {
    deltaSetLike: {
      ROOT: {
        id: 'ROOT',
        key: 'group',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        attrs: {},
        children: ['n1'],
      },
      n1: {
        id: 'n1',
        key: 'shape',
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        attrs: { shapeType: 'rect', 'fill-color': '#fff' },
        children: [],
      },
    },
  };
}

function mockCtx(ops: string[]) {
  return {
    setTransform: (...args: number[]) => {
      ops.push(`setTransform:${args.join(',')}`);
    },
    clearRect: (...args: number[]) => {
      ops.push(`clearRect:${args.join(',')}`);
    },
    save: () => ops.push('save'),
    restore: () => ops.push('restore'),
    translate: () => ops.push('translate'),
    scale: () => ops.push('scale'),
    rotate: () => ops.push('rotate'),
    beginPath: () => ops.push('beginPath'),
    moveTo: () => ops.push('moveTo'),
    lineTo: () => ops.push('lineTo'),
    rect: (...args: number[]) => {
      ops.push(`rect:${args.map((n) => Math.round(n)).join(',')}`);
    },
    clip: () => ops.push('clip'),
    arcTo: () => ops.push('arcTo'),
    closePath: () => ops.push('closePath'),
    ellipse: () => ops.push('ellipse'),
    stroke: () => ops.push('stroke'),
    fill: (pathOrRule?: unknown, rule?: CanvasFillRule) => {
      if (pathOrRule === 'evenodd' || pathOrRule === 'nonzero') {
        ops.push(`fill:${pathOrRule}`);
      } else if (rule) {
        ops.push(`fill:${rule}`);
      } else {
        ops.push('fill');
      }
    },
    fillRect: () => ops.push('fillRect'),
    strokeRect: () => ops.push('strokeRect'),
    createLinearGradient: () => {
      ops.push('createLinearGradient');
      return {
        addColorStop: () => ops.push('addColorStop'),
      };
    },
    createRadialGradient: () => {
      ops.push('createRadialGradient');
      return {
        addColorStop: () => ops.push('addColorStop'),
      };
    },
    createConicGradient: (start: number, x: number, y: number) => {
      ops.push('createConicGradient');
      ops.push(`conic:${start.toFixed(6)},${x.toFixed(2)},${y.toFixed(2)}`);
      return {
        addColorStop: () => ops.push('addColorStop'),
      };
    },
    createPattern: () => {
      ops.push('createPattern');
      return {} as CanvasPattern;
    },
    drawImage: () => ops.push('drawImage'),
    fillStyle: '' as string | CanvasGradient | CanvasPattern,
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt' as CanvasLineCap,
    globalAlpha: 1,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };
}

describe('DirtyRegion helpers', () => {
  it('isFullDirty / dirtyTouchesNode', () => {
    const full: DirtyRegion = { kind: 'full' };
    const nodes: DirtyRegion = { kind: 'nodes', ids: ['a', 'b'] };
    expect(isFullDirty(full)).toBe(true);
    expect(isFullDirty(nodes)).toBe(false);
    expect(dirtyTouchesNode(full, 'z')).toBe(true);
    expect(dirtyTouchesNode(nodes, 'a')).toBe(true);
    expect(dirtyTouchesNode(nodes, 'z')).toBe(false);
  });
});

describe('createSvgSceneRenderer', () => {
  it('hitTest uses spatial index + scene hit bridge', () => {
    const doc = rectDoc();
    const spatial = new SceneSpatialRuntime(64);
    spatial.sync({
      document: doc,
      childrenIds: ['n1'],
      reloadToken: 1,
      aabbPad: 0,
    });
    const renderer = createSvgSceneRenderer({
      getDocument: () => doc,
      getSpatial: () => spatial,
      getZoom: () => 1,
      listNodeIds: () => ['n1'],
      getNodeBox: (id) => {
        const n = doc.deltaSetLike?.[id];
        if (!n) return null;
        return {
          left: Number(n.x) || 0,
          top: Number(n.y) || 0,
          width: Number(n.width) || 1,
          height: Number(n.height) || 1,
        };
      },
    });
    expect(renderer.backend).toBe('svg');
    expect(renderer.hitTest({ x: 30, y: 40 })).toBe('n1');
    expect(renderer.hitTest({ x: -100, y: -100 })).toBeNull();
    renderer.dispose();
    // Hit stays valid after dispose — bridge may briefly retain this instance.
    expect(renderer.hitTest({ x: 30, y: 40 })).toBe('n1');
  });

  it('createSceneRenderer defaults to svg', () => {
    const r = createSceneRenderer('svg', {
      getDocument: () => emptyDoc(),
      getSpatial: () => new SceneSpatialRuntime(64),
      getZoom: () => 1,
      listNodeIds: () => [],
      getNodeBox: () => null,
    });
    expect(r.backend).toBe('svg');
    r.dispose();
  });
});

describe('scene grid (Canvas underlay)', () => {
  it('sceneGridLineWidth stays ~1 screen px', () => {
    expect(sceneGridLineWidth(1, 8)).toBeCloseTo(1 / 8, 6);
    expect(sceneGridLineWidth(1, 20)).toBeCloseTo(1 / 20, 6);
    expect(sceneGridLineWidth(8, 1)).toBeCloseTo(Math.min(8 * 0.35, 1), 6);
  });

  it('drawSceneGrid strokes lattice', () => {
    const ops: string[] = [];
    const ctx = mockCtx(ops);
    drawSceneGrid(ctx as unknown as CanvasRenderingContext2D, { x: 0, y: 0, width: 16, height: 16 }, 8, 8);
    expect(ops).toContain('beginPath');
    expect(ops).toContain('stroke');
  });

  it('drawSceneGrid keeps axes on integer grid (no device-axis snap)', () => {
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
      { x: 0.2, y: 0.2, width: 10, height: 10 },
      1,
      100
    );
    // First vertical line starts at floor(0.2)=0 — not shifted by stroke snap.
    expect(moves.some(([x, y]) => x === 0 && y === 0)).toBe(true);
    expect(moves.every(([x]) => Math.abs(x - Math.round(x)) < 1e-9)).toBe(true);
  });

  it('paintBasicShapeFill uses ellipse for circle', () => {
    const ops: string[] = [];
    const ctx = mockCtx(ops);
    paintBasicShapeFill(ctx as unknown as CanvasRenderingContext2D, {
      left: 0,
      top: 0,
      width: 40,
      height: 40,
      fill: '#f00',
      shapeType: 'circle',
    });
    expect(ops).toContain('ellipse');
    expect(ops).toContain('fill');
  });

  it('createCanvasSceneRenderer paints grid only above PIXEL_GRID_MIN_ZOOM', () => {
    const canvas = document.createElement('canvas');
    const opsLow: string[] = [];
    vi.spyOn(canvas, 'getContext').mockReturnValue(mockCtx(opsLow) as unknown as CanvasRenderingContext2D);

    const spatial = new SceneSpatialRuntime(64);
    const renderer = createCanvasSceneRenderer({
      canvas,
      getDocument: () => emptyDoc(),
      getSpatial: () => spatial,
      getZoom: () => 1,
      listNodeIds: () => [],
      getNodeBox: () => null,
      paintGrid: true,
      drawNodeProxies: false,
      gridSize: 1,
    });

    renderer.render({
      document: emptyDoc(),
      camera: { x: 0, y: 0, zoom: 1 },
      dirty: { kind: 'full' },
      stage: { width: 200, height: 150 },
      dpr: 1,
    });
    expect(opsLow).toContain('clearRect:0,0,200,150');
    expect(opsLow).not.toContain('stroke');

    const opsHi: string[] = [];
    vi.spyOn(canvas, 'getContext').mockReturnValue(mockCtx(opsHi) as unknown as CanvasRenderingContext2D);
    renderer.render({
      document: emptyDoc(),
      camera: { x: 0, y: 0, zoom: PIXEL_GRID_MIN_ZOOM },
      dirty: { kind: 'full' },
      stage: { width: 200, height: 150 },
      dpr: 1,
    });
    expect(opsHi).toContain('stroke');
    renderer.dispose();
  });
});

describe('Canvas idle path / text / shape paint', () => {
  it('strokeCanvasIdleCenterline strokes subsampled path', () => {
    const ops: string[] = [];
    const ctx = mockCtx(ops);
    expect(strokeCanvasIdleCenterline(ctx as unknown as CanvasRenderingContext2D, 'M0 0 L10 0 L20 10')).toBe(
      true
    );
    expect(ops).toContain('beginPath');
    expect(ops).toContain('stroke');
    expect(strokeCanvasIdleCenterline(ctx as unknown as CanvasRenderingContext2D, '')).toBe(false);
  });

  it('paintStrokeCanvasIdle falls back to midline when path empty', () => {
    const ops: string[] = [];
    const ctx = mockCtx(ops);
    paintStrokeCanvasIdle(ctx as unknown as CanvasRenderingContext2D, {
      pathD: '',
      width: 40,
      height: 20,
      stroke: '#000',
      lineWidth: 2,
    });
    expect(ops).toContain('stroke');
  });

  it('paintTextProxyLines draws greeking bars', () => {
    const ops: string[] = [];
    const ctx = mockCtx(ops);
    paintTextProxyLines(ctx as unknown as CanvasRenderingContext2D, {
      node: { key: 'text', attrs: { fontSize: 14, lineHeight: 1.4 } } as SceneNodeInput,
      width: 100,
      height: 42,
      fill: '#333',
      opacity: 1,
    });
    expect(ops.filter((o) => o === 'fillRect').length).toBeGreaterThanOrEqual(1);
  });

  it('paintCanvasIdleNode routes stroke-only pencil without fillRect slab', () => {
    const ops: string[] = [];
    const ctx = mockCtx(ops);
    paintCanvasIdleNode(ctx as unknown as CanvasRenderingContext2D, {
      left: 10,
      top: 20,
      width: 80,
      height: 40,
      zoom: 0.2,
      node: {
        key: 'shape',
        attrs: { shapeType: 'pencil', path: 'M0 20 L80 20', 'border-color': '#111' },
      } as SceneNodeInput,
    });
    expect(ops).toContain('stroke');
    expect(ops).not.toContain('fillRect');
  });

  it('paintCanvasMediaInk draws cached image with crop', () => {
    const ops: string[] = [];
    const ctx = mockCtx(ops);
    const src = 'https://example.com/media.png';
    setFillImageCacheEntry(src, {
      width: 200,
      height: 100,
      naturalWidth: 200,
      naturalHeight: 100,
    } as CanvasImageSource);
    paintCanvasMediaInk(ctx as unknown as CanvasRenderingContext2D, {
      width: 100,
      height: 50,
      opacity: 1,
      node: {
        key: 'image',
        attrs: { src, cropX: 0.25, cropY: 0.25, cropW: 0.5, cropH: 0.5 },
      } as SceneNodeInput,
    });
    expect(ops).toContain('clip');
    expect(ops).toContain('drawImage');
  });

  it('paintCanvasIdleNode clips media to owning clipContent frame', () => {
    const ops: string[] = [];
    const ctx = mockCtx(ops);
    const doc = {
      ...emptyDoc(),
      frames: [
        {
          id: 'frame',
          x: 0,
          y: 0,
          width: 200,
          height: 300,
          clipContent: true,
        },
      ],
    } as SceneDocument;
    const node = {
      key: 'image',
      x: -20,
      y: 40,
      width: 120,
      height: 80,
      attrs: { src: 'https://example.com/a.png', frameId: 'frame' },
    } as SceneNodeInput;
    expect(clipCanvasIdleToOwningFrame(ctx as unknown as CanvasRenderingContext2D, doc, node, 1)).toBe(
      true
    );
    expect(ops).toContain('clip');
  });

  it('canvasIdleIsStrokeOnly matches pencil / unfilled path; closed pen with fill is not stroke-only', () => {
    expect(canvasIdleIsStrokeOnly({ attrs: { shapeType: 'pencil' } } as SceneNodeInput)).toBe(true);
    expect(
      canvasIdleIsStrokeOnly({
        attrs: { shapeType: 'path', path: 'M0 0 L1 1', 'fill-color': 'none' },
      } as SceneNodeInput)
    ).toBe(true);
    expect(
      canvasIdleIsStrokeOnly({
        attrs: {
          shapeType: 'pen',
          closed: 'true',
          path: 'M0 0 L10 0 L10 10 Z',
          'fill-enabled': 'true',
          'fill-visible': 'true',
          'fill-color': '#911B1B',
        },
      } as SceneNodeInput)
    ).toBe(false);
    expect(
      canvasIdleIsStrokeOnly({ attrs: { shapeType: 'rect', 'fill-color': '#abc' } } as SceneNodeInput)
    ).toBe(false);
  });

  it('paintCanvasShapeInk strokes rounded rect', () => {
    const ops: string[] = [];
    const ctx = mockCtx(ops);
    (ctx as { arcTo?: () => void }).arcTo = () => ops.push('arcTo');
    (ctx as { closePath?: () => void }).closePath = () => ops.push('closePath');
    paintCanvasShapeInk(ctx as unknown as CanvasRenderingContext2D, {
      node: {
        key: 'shape',
        attrs: {
          shapeType: 'rect',
          'fill-color': '#ff0000',
          'border-color': '#000000',
          'border-width': 2,
          radiusTL: 4,
          radiusTR: 4,
          radiusBR: 4,
          radiusBL: 4,
        },
      } as SceneNodeInput,
      width: 40,
      height: 30,
      opacity: 1,
    });
    expect(ops).toContain('beginPath');
    expect(ops).toContain('fill');
    expect(ops).toContain('stroke');
  });

  it('paintCanvasTextInk draws fillText glyphs', () => {
    const ops: string[] = [];
    const ctx = mockCtx(ops);
    (ctx as { fillText?: (...a: unknown[]) => void; textAlign?: string; textBaseline?: string; font?: string }).fillText =
      () => ops.push('fillText');
    paintCanvasTextInk(ctx as unknown as CanvasRenderingContext2D, {
      node: {
        key: 'text',
        attrs: {
          ORIGIN_DATA: JSON.stringify([{ children: [{ text: 'Hello' }] }]),
          DATA: JSON.stringify([
            {
              chars: [{ char: 'H', config: { SIZE: 16, COLOR: '#111', FAMILY: 'sans-serif' } }],
            },
          ]),
        },
      } as SceneNodeInput,
      width: 120,
      height: 40,
      opacity: 1,
    });
    expect(ops).toContain('fillText');
  });

  it('paintCanvasPathInk falls back to centerline without Path2D', () => {
    const hadPath2D = typeof (globalThis as { Path2D?: unknown }).Path2D !== 'undefined';
    const prev = (globalThis as { Path2D?: unknown }).Path2D;
    (globalThis as { Path2D?: unknown }).Path2D = undefined;
    try {
      const ops: string[] = [];
      const ctx = mockCtx(ops);
      paintCanvasPathInk(ctx as unknown as CanvasRenderingContext2D, {
        node: {
          key: 'shape',
          attrs: { shapeType: 'pen', path: 'M0 10 L40 10', 'border-color': '#000', 'border-width': 2 },
        } as SceneNodeInput,
        width: 40,
        height: 20,
        opacity: 1,
        zoom: 1,
      });
      expect(ops).toContain('stroke');
    } finally {
      if (hadPath2D) (globalThis as { Path2D?: unknown }).Path2D = prev;
      else delete (globalThis as { Path2D?: unknown }).Path2D;
    }
  });

  it('paintCanvasShapeInk paints linear gradient + shadow', () => {
    const ops: string[] = [];
    const ctx = mockCtx(ops);
    paintCanvasShapeInk(ctx as unknown as CanvasRenderingContext2D, {
      node: {
        key: 'shape',
        attrs: {
          shapeType: 'rect',
          'fill-type': 'linear',
          'fill-gradient': JSON.stringify({
            type: 'linear',
            angle: 90,
            colorStops: [
              { offset: 0, color: '#ff0000' },
              { offset: 1, color: '#0000ff' },
            ],
          }),
          'shadow-enabled': true,
          'shadow-blur': 8,
          'shadow-x': 2,
          'shadow-y': 4,
          'border-width': 0,
        },
      } as SceneNodeInput,
      width: 40,
      height: 30,
      opacity: 1,
    });
    expect(ops).toContain('createLinearGradient');
    expect(ops).toContain('addColorStop');
    expect(ops).toContain('fill');
    expect(ctx.shadowBlur === 0 || ops.includes('fill')).toBe(true);
  });

  it('paintCanvasShapeInk paints angular via createConicGradient', () => {
    const ops: string[] = [];
    const ctx = mockCtx(ops);
    paintCanvasShapeInk(ctx as unknown as CanvasRenderingContext2D, {
      node: {
        key: 'shape',
        attrs: {
          shapeType: 'rect',
          'fill-type': 'angular',
          'fill-gradient': JSON.stringify({
            type: 'angular',
            angle: 45,
            cx: 50,
            cy: 50,
            colorStops: [
              { offset: 0, color: '#ff0000' },
              { offset: 1, color: '#0000ff' },
            ],
          }),
          'border-width': 0,
        },
      } as SceneNodeInput,
      width: 40,
      height: 30,
      opacity: 1,
    });
    // Same as bakeAngularGradientDataUrl: start = (angle - 90)°, center from cx/cy %.
    const expectedStart = ((45 - 90) * Math.PI) / 180;
    expect(ops).toContain(`conic:${expectedStart.toFixed(6)},20.00,15.00`);
    expect(ops).toContain('createConicGradient');
    expect(ops).toContain('addColorStop');
    expect(ops).toContain('fill');
  });

  it('createCanvasAngularGradient returns null without createConicGradient', () => {
    const ops: string[] = [];
    const ctx = mockCtx(ops) as unknown as CanvasRenderingContext2D & {
      createConicGradient?: unknown;
    };
    delete ctx.createConicGradient;
    expect(
      createCanvasAngularGradient(
        ctx,
        {
          type: 'angular',
          angle: 0,
          cx: 50,
          cy: 50,
          colorStops: [{ offset: 0, color: '#f00' }],
        },
        40,
        30,
        100
      )
    ).toBeNull();
  });

  it('canIdlePaintOnCanvas allows gradient/image/media; rejects donut, poly, non-center stroke, blur', () => {
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: {
          shapeType: 'rect',
          'fill-color': '#fff',
          'stroke-enabled': false,
        },
      } as SceneNodeInput)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: {
          shapeType: 'rect',
          'fill-color': '#fff',
          'border-width': 1,
          'border-color': '#333',
        },
      } as SceneNodeInput)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: {
          shapeType: 'line',
          path: 'M0 0 L40 0',
          'border-width': 2,
          'border-color': '#000',
        },
      } as SceneNodeInput)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: {
          shapeType: 'pen',
          path: 'M0 0 L10 10 L20 0',
          'border-width': 2,
          'stroke-enabled': true,
        },
      } as SceneNodeInput)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: {
          shapeType: 'rect',
          'fill-type': 'linear',
          'fill-gradient': '{}',
          'stroke-enabled': false,
        },
      } as SceneNodeInput)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: {
          shapeType: 'ellipse',
          'fill-type': 'angular',
          'fill-gradient': '{}',
          'stroke-enabled': false,
        },
      } as SceneNodeInput)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: { shapeType: 'circle', ellipseInnerRatio: 0.5, 'stroke-enabled': false },
      } as SceneNodeInput)
    ).toBe(false);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: { shapeType: 'circle', ellipseArcPercent: 40, 'stroke-enabled': false },
      } as SceneNodeInput)
    ).toBe(false);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: { shapeType: 'polygon', sides: 6, 'stroke-enabled': false },
      } as SceneNodeInput)
    ).toBe(false);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: { shapeType: 'star', sides: 5, 'stroke-enabled': false },
      } as SceneNodeInput)
    ).toBe(false);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: {
          shapeType: 'rect',
          'fill-type': 'image',
          'fill-image-src': 'data:image/png;base64,xx',
          'stroke-enabled': false,
        },
      } as SceneNodeInput)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: {
          shapeType: 'rect',
          'fill-type': 'diffuse',
          'fill-gradient': '{}',
          'stroke-enabled': false,
        },
      } as SceneNodeInput)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'image',
        attrs: { src: 'https://example.com/a.png' },
      } as SceneNodeInput)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'video',
        attrs: { poster: 'https://example.com/p.png' },
      } as SceneNodeInput)
    ).toBe(true);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: {
          shapeType: 'rect',
          'fill-color': '#fff',
          'border-width': 2,
          strokeAlign: 'outside',
        },
      } as SceneNodeInput)
    ).toBe(false);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: { shapeType: 'rect', 'inner-shadow-enabled': true },
      } as SceneNodeInput)
    ).toBe(false);
    expect(
      canIdlePaintOnCanvas({
        key: 'shape',
        attrs: { shapeType: 'rect', 'backdrop-blur-enabled': true },
      } as SceneNodeInput)
    ).toBe(false);
  });

  it('paintCanvasShapeInk paints donut with evenodd', () => {
    const ops: string[] = [];
    const ctx = mockCtx(ops);
    paintCanvasShapeInk(ctx as unknown as CanvasRenderingContext2D, {
      node: {
        key: 'shape',
        attrs: {
          shapeType: 'circle',
          ellipseInnerRatio: 0.4,
          'fill-color': '#ff0000',
          'border-width': 0,
        },
      } as SceneNodeInput,
      width: 100,
      height: 100,
      opacity: 1,
    });
    expect(ops.filter((o) => o === 'ellipse').length).toBeGreaterThanOrEqual(2);
    expect(ops).toContain('fill:evenodd');
  });

  it('paintCanvasShapeInk paints star via vertex path', () => {
    const ops: string[] = [];
    const ctx = mockCtx(ops);
    paintCanvasShapeInk(ctx as unknown as CanvasRenderingContext2D, {
      node: {
        key: 'shape',
        attrs: {
          shapeType: 'star',
          sides: 5,
          'fill-color': '#00ff00',
          'border-color': '#000000',
          'border-width': 1,
        },
      } as SceneNodeInput,
      width: 80,
      height: 80,
      opacity: 1,
    });
    expect(ops).toContain('moveTo');
    expect(ops.filter((o) => o === 'lineTo').length).toBeGreaterThanOrEqual(9);
    expect(ops).toContain('fill');
    expect(ops).toContain('stroke');
    expect(ops).not.toContain('ellipse');
  });

  it('paintCanvasShapeInk paints image fill via createPattern when cached', () => {
    clearFillImageCache();
    const src = 'test://fill-img';
    const tile = document.createElement('canvas');
    tile.width = 8;
    tile.height = 8;
    const tctx = tile.getContext('2d');
    if (tctx) {
      tctx.fillStyle = '#ff0000';
      tctx.fillRect(0, 0, 8, 8);
    }
    setFillImageCacheEntry(src, tile);
    const ops: string[] = [];
    const ctx = mockCtx(ops);
    paintCanvasShapeInk(ctx as unknown as CanvasRenderingContext2D, {
      node: {
        key: 'shape',
        attrs: {
          shapeType: 'rect',
          'fill-type': 'image',
          'fill-image-src': src,
          'fill-image-fit': 'crop',
          'border-width': 0,
        },
      } as SceneNodeInput,
      width: 40,
      height: 30,
      opacity: 1,
    });
    expect(ops).toContain('createPattern');
    expect(ops).toContain('fill');
  });

  it('bumpSceneCanvasIdlePaint notifies subscribers', () => {
    let n = 0;
    const unsub = subscribeSceneCanvasIdlePaint(() => {
      n += 1;
    });
    bumpSceneCanvasIdlePaint();
    unsub();
    expect(n).toBe(1);
  });

  it('createCanvasSceneRenderer drawCanvasIdle paints stroke centerline', () => {
    const canvas = document.createElement('canvas');
    const ops: string[] = [];
    vi.spyOn(canvas, 'getContext').mockReturnValue(mockCtx(ops) as unknown as CanvasRenderingContext2D);
    const doc = {
      deltaSetLike: {
        ROOT: {
          id: 'ROOT',
          key: 'group',
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          attrs: {},
          children: ['p1'],
        },
        p1: {
          id: 'p1',
          key: 'shape',
          x: 0,
          y: 0,
          width: 50,
          height: 20,
          attrs: { shapeType: 'pen', path: 'M0 10 L50 10', 'border-color': '#000' },
          children: [],
        },
      },
    };
    const spatial = new SceneSpatialRuntime(64);
    const renderer = createCanvasSceneRenderer({
      canvas,
      getDocument: () => doc,
      getSpatial: () => spatial,
      getZoom: () => 1,
      listNodeIds: () => ['p1'],
      getNodeBox: () => ({ left: 0, top: 0, width: 50, height: 20 }),
      drawCanvasIdle: true,
      paintGrid: false,
    });
    renderer.render({
      document: doc,
      camera: { x: 0, y: 0, zoom: 1 },
      dirty: { kind: 'full' },
      stage: { width: 100, height: 80 },
      dpr: 1,
    });
    expect(ops).toContain('stroke');
    renderer.dispose();
  });
});

describe('SceneCanvasIdlePaint registry', () => {
  it('set / list / clear / subscribe', () => {
    clearSceneCanvasIdlePaint();
    let ticks = 0;
    const unsub = subscribeSceneCanvasIdlePaint(() => {
      ticks += 1;
    });
    const doc = rectDoc();
    setSceneCanvasIdlePaint({
      document: doc,
      canvasIds: ['n1', 'hidden'],
      hiddenNodeId: 'hidden',
      getNodeBox: () => ({ left: 0, top: 0, width: 10, height: 10 }),
    });
    expect(getSceneCanvasIdlePaint()?.canvasIds).toEqual(['n1', 'hidden']);
    expect(listSceneCanvasIdlePaintIds()).toEqual(['n1']);
    expect(ticks).toBe(1);
    clearSceneCanvasIdlePaint();
    expect(getSceneCanvasIdlePaint()).toBeNull();
    expect(listSceneCanvasIdlePaintIds()).toEqual([]);
    expect(ticks).toBe(2);
    unsub();
  });
});

describe('createCanvasSceneRenderer', () => {
  it('render clears and draws basic shapes when enabled', () => {
    const canvas = document.createElement('canvas');
    const ops: string[] = [];
    vi.spyOn(canvas, 'getContext').mockReturnValue(mockCtx(ops) as unknown as CanvasRenderingContext2D);

    const doc = rectDoc();
    const spatial = new SceneSpatialRuntime(64);
    spatial.sync({
      document: doc,
      childrenIds: ['n1'],
      reloadToken: 1,
      aabbPad: 0,
    });
    const renderer = createCanvasSceneRenderer({
      canvas,
      getDocument: () => doc,
      getSpatial: () => spatial,
      getZoom: () => 1,
      listNodeIds: () => ['n1'],
      getNodeBox: () => ({ left: 10, top: 20, width: 100, height: 50 }),
      drawNodeProxies: false,
      drawBasicShapes: true,
      paintGrid: false,
      gridSize: 8,
    });
    expect(renderer.backend).toBe('canvas2d');
    renderer.render({
      document: doc,
      camera: { x: 0, y: 0, zoom: 1 },
      dirty: { kind: 'full' },
      stage: { width: 200, height: 150 },
      dpr: 1,
    });
    expect(ops).toContain('clearRect:0,0,200,150');
    expect(ops).toContain('fillRect');
    expect(renderer.hitTest({ x: 30, y: 40 })).toBe('n1');
    renderer.dispose();
  });
});

describe('hitTestWithSpatialIndex', () => {
  it('returns null for empty document', () => {
    expect(
      hitTestWithSpatialIndex(
        {
          getDocument: () => emptyDoc(),
          getSpatial: () => new SceneSpatialRuntime(64),
          getZoom: () => 1,
          listNodeIds: () => [],
          getNodeBox: () => null,
        },
        { x: 0, y: 0 }
      )
    ).toBeNull();
  });

  it('uses stackOrder instead of root child order for overlapping nodes', () => {
    const doc = {
      stackOrder: ['node:back', 'node:front'],
      deltaSetLike: {
        ROOT: { children: ['front', 'back'] },
        front: {
          id: 'front',
          key: 'shape',
          x: 10,
          y: 10,
          width: 80,
          height: 80,
          attrs: { shapeType: 'rect', 'fill-color': '#fff' },
        },
        back: {
          id: 'back',
          key: 'shape',
          x: 10,
          y: 10,
          width: 80,
          height: 80,
          attrs: { shapeType: 'rect', 'fill-color': '#fff' },
        },
      },
    } as unknown as SceneDocument;
    const spatial = new SceneSpatialRuntime(64);
    expect(
      hitTestWithSpatialIndex(
        {
          getDocument: () => doc,
          getSpatial: () => spatial,
          getZoom: () => 1,
          listNodeIds: () => ['front', 'back'],
          getNodeBox: (id) => {
            const node = doc.deltaSetLike[id];
            return { left: node.x, top: node.y, width: node.width, height: node.height };
          },
        },
        { x: 30, y: 30 }
      )
    ).toBe('front');
  });
});
