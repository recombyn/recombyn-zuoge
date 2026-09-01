import { afterEach, describe, expect, it } from 'vitest';
import {
  createSceneRenderBuffer,
  forEachVisibleInRect,
  paintSoaBufferBasic,
  resolveSoaPaintBox,
  setSoaPaintDocument,
  syncSceneRenderBufferFromDocument,
  SOA_FLAG_BASIC_GEOM,
  SOA_FLAG_CANVAS_IDLE,
  SOA_FLAG_VISIBLE,
} from '../sceneRenderBuffer';
import { createEmptyDocument, addNodeToDocument } from '@/components/rcb/scene/document/sceneDocument';
import {
  clearNodeTransformPreviews,
  getNodeTransformPreview,
  setNodeTransformAngles,
  setNodeTransformHidden,
  setNodeTransformPreviews,
} from '@/components/rcb/core/transformPreview';
import {
  setLiveCornerRadiusPreview,
} from '@/components/rcb/scene/document/sceneRadii';
import {
  previewSvgNodeAngle,
  previewSvgNodeGeometry,
} from '@/components/rcb/scene/paint/sceneToSvg';
import { applyAnimationPlayheadScenePose } from '@/components/editor/nodes/AnimationNode/animationPlayheadSceneApply';
import { serializeLottieAnimationData } from '@/components/rcb/scene/document/nodeFactories';
import { clearShapeHosts, registerShapeHost } from '@/components/rcb/shapes/shapeHostRegistry';
import {
  clearLiveArtboardFrameGeometry,
  previewArtboardFrameGeometry,
} from '@/components/rcb/frames/HtmlArtboardFrame';

afterEach(() => {
  clearNodeTransformPreviews();
  setLiveCornerRadiusPreview(null);
  clearShapeHosts();
  clearLiveArtboardFrameGeometry();
  setSoaPaintDocument(null);
});

describe('SoA TransformPreview sync', () => {
  it('resolveSoaPaintBox follows TransformPreview like effectivePaintBox', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    doc = addNodeToDocument(doc, 'r1', {
      id: 'r1',
      key: 'shape',
      x: 10,
      y: 20,
      width: 40,
      height: 50,
      attrs: {
        shapeType: 'rect',
        fill: '#fff',
        'fill-color': '#fff',
        'stroke-enabled': false,
        frameId: '',
      },
      children: [],
    } as any);

    const buf = createSceneRenderBuffer(8);
    syncSceneRenderBufferFromDocument(buf, doc);
    const i = buf.indexById.get('r1');
    expect(i).toBeDefined();
    expect(buf.flags[i!] & SOA_FLAG_BASIC_GEOM).toBeTruthy();
    expect(buf.flags[i!] & SOA_FLAG_CANVAS_IDLE).toBeTruthy();
    expect(buf.flags[i!] & SOA_FLAG_VISIBLE).toBeTruthy();

    const base = resolveSoaPaintBox(buf, i!);
    expect(base).toMatchObject({ x: 10, y: 20, w: 40, h: 50, dx: 0, dy: 0 });

    setNodeTransformPreviews([{ nodeId: 'r1', left: 100, top: 200, width: 40, height: 50 }]);
    const live = resolveSoaPaintBox(buf, i!);
    expect(live).toMatchObject({ x: 100, y: 200, w: 40, h: 50, dx: 90, dy: 180 });
  });

  it('previewSvgNodeGeometry publishes TransformPreview even without SVG host', () => {
    const ok = previewSvgNodeGeometry(new Map(), 'soa-only', {
      left: 5,
      top: 6,
      width: 7,
      height: 8,
    });
    expect(ok).toBe(true);
    expect(getNodeTransformPreview('soa-only')).toMatchObject({
      left: 5,
      top: 6,
      width: 7,
      height: 8,
    });
  });

  it('previewSvgNodeAngle publishes TransformPreview angle for SoA playhead', () => {
    setNodeTransformPreviews([{ nodeId: 'r-rot', left: 10, top: 10, width: 40, height: 20 }]);
    previewSvgNodeAngle(new Map(), 'r-rot', 45);
    expect(getNodeTransformPreview('r-rot')?.angle).toBe(45);
    clearNodeTransformPreviews(['r-rot']);
    setNodeTransformAngles([{ nodeId: 'r-rot', angle: -30 }]);
    expect(getNodeTransformPreview('r-rot')?.angle).toBe(-30);
  });

  it('paintSoaBufferBasic draws at TransformPreview origin', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    doc = addNodeToDocument(doc, 'r1', {
      id: 'r1',
      key: 'shape',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      attrs: {
        shapeType: 'rect',
        fill: '#ffffff',
        'fill-color': '#ffffff',
        'stroke-enabled': false,
        frameId: '',
      },
      children: [],
    } as any);
    const buf = createSceneRenderBuffer(4);
    syncSceneRenderBufferFromDocument(buf, doc);
    setNodeTransformPreviews([{ nodeId: 'r1', left: 50, top: 60, width: 10, height: 10 }]);

    const calls: Array<{ x: number; y: number }> = [];
    const ctx = {
      fillStyle: '',
      fillRect: (x: number, y: number) => {
        calls.push({ x, y });
      },
      beginPath() {},
      ellipse() {},
      fill() {},
      stroke() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      arcTo() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      strokeStyle: '',
      lineWidth: 0,
      lineCap: '',
      lineJoin: '',
    } as unknown as CanvasRenderingContext2D;

    paintSoaBufferBasic(ctx, buf, { left: 0, top: 0, width: 200, height: 200 });
    expect(calls.some((c) => c.x === 50 && c.y === 60)).toBe(true);
  });

  it('paintSoaBufferBasic skips SVG host during TransformPreview (SVG owns ink)', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    doc = addNodeToDocument(doc, 'r1', {
      id: 'r1',
      key: 'shape',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      attrs: {
        shapeType: 'rect',
        fill: '#ffffff',
        'fill-color': '#ffffff',
        'stroke-enabled': false,
        frameId: '',
      },
      children: [],
    } as any);
    const buf = createSceneRenderBuffer(4);
    syncSceneRenderBufferFromDocument(buf, doc);
    setNodeTransformPreviews([{ nodeId: 'r1', left: 50, top: 60, width: 10, height: 10 }]);
    const hostEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    registerShapeHost({
      nodeId: 'r1',
      root: hostEl as unknown as SVGSVGElement,
      layer: hostEl as unknown as SVGGElement,
      el: hostEl,
      kind: 'svg',
    });

    let painted = false;
    const ctx = {
      fillStyle: '',
      fillRect() {
        painted = true;
      },
      beginPath() {},
      ellipse() {},
      fill() {
        painted = true;
      },
      stroke() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      arcTo() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      strokeStyle: '',
      lineWidth: 0,
      lineCap: '',
      lineJoin: '',
    } as unknown as CanvasRenderingContext2D;

    paintSoaBufferBasic(ctx, buf, { left: 0, top: 0, width: 200, height: 200 });
    expect(painted).toBe(false);
  });

  it('paintSoaBufferBasic skips idle SVG host when not gesturing', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    doc = addNodeToDocument(doc, 'r1', {
      id: 'r1',
      key: 'shape',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      attrs: {
        shapeType: 'rect',
        fill: '#ffffff',
        'fill-color': '#ffffff',
        'stroke-enabled': false,
        frameId: '',
      },
      children: [],
    } as any);
    const buf = createSceneRenderBuffer(4);
    syncSceneRenderBufferFromDocument(buf, doc);
    const hostEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    registerShapeHost({
      nodeId: 'r1',
      root: hostEl as unknown as SVGSVGElement,
      layer: hostEl as unknown as SVGGElement,
      el: hostEl,
      kind: 'svg',
    });

    let painted = false;
    const ctx = {
      fillStyle: '',
      fillRect() {
        painted = true;
      },
      beginPath() {},
      ellipse() {},
      fill() {
        painted = true;
      },
      stroke() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      arcTo() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      strokeStyle: '',
      lineWidth: 0,
      lineCap: '',
      lineJoin: '',
    } as unknown as CanvasRenderingContext2D;

    paintSoaBufferBasic(ctx, buf, { left: 0, top: 0, width: 200, height: 200 });
    expect(painted).toBe(false);
  });

  it('paintSoaBufferBasic rotates when TransformPreview has angle', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    doc = addNodeToDocument(doc, 'r1', {
      id: 'r1',
      key: 'shape',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      attrs: {
        shapeType: 'rect',
        fill: '#ffffff',
        'fill-color': '#ffffff',
        'stroke-enabled': false,
        frameId: '',
      },
      children: [],
    } as any);
    const buf = createSceneRenderBuffer(4);
    syncSceneRenderBufferFromDocument(buf, doc);
    setNodeTransformPreviews([
      { nodeId: 'r1', left: 0, top: 0, width: 10, height: 10, angle: 45 },
    ]);

    let rotated = false;
    const ctx = {
      fillStyle: '',
      fillRect() {},
      beginPath() {},
      ellipse() {},
      fill() {},
      stroke() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      arcTo() {},
      save() {},
      restore() {},
      translate() {},
      rotate(rad: number) {
        if (Math.abs(rad - Math.PI / 4) < 1e-6) rotated = true;
      },
      strokeStyle: '',
      lineWidth: 0,
      lineCap: '',
      lineJoin: '',
    } as unknown as CanvasRenderingContext2D;

    paintSoaBufferBasic(ctx, buf, { left: 0, top: 0, width: 200, height: 200 });
    expect(rotated).toBe(true);
  });

  it('angle-only TransformPreview keeps document box and still rotates SoA paint', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    doc = addNodeToDocument(doc, 'r1', {
      id: 'r1',
      key: 'shape',
      x: 20,
      y: 30,
      width: 10,
      height: 10,
      attrs: {
        shapeType: 'rect',
        fill: '#ffffff',
        'fill-color': '#ffffff',
        'stroke-enabled': false,
        frameId: '',
      },
      children: [],
    } as any);
    const buf = createSceneRenderBuffer(4);
    syncSceneRenderBufferFromDocument(buf, doc);
    setNodeTransformAngles([{ nodeId: 'r1', angle: 90 }]);

    const box = resolveSoaPaintBox(buf, buf.indexById.get('r1')!);
    expect(box).toMatchObject({ x: 20, y: 30, w: 10, h: 10 });

    let rotated = false;
    const ctx = {
      fillStyle: '',
      fillRect() {},
      beginPath() {},
      ellipse() {},
      fill() {},
      stroke() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      arcTo() {},
      save() {},
      restore() {},
      translate() {},
      rotate(rad: number) {
        if (Math.abs(rad - Math.PI / 2) < 1e-6) rotated = true;
      },
      strokeStyle: '',
      lineWidth: 0,
      lineCap: '',
      lineJoin: '',
    } as unknown as CanvasRenderingContext2D;

    paintSoaBufferBasic(ctx, buf, { left: 0, top: 0, width: 200, height: 200 });
    expect(rotated).toBe(true);
  });

  it('paintSoaBufferBasic skips TransformPreview.hidden layers', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    doc = addNodeToDocument(doc, 'r1', {
      id: 'r1',
      key: 'shape',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      attrs: {
        shapeType: 'rect',
        fill: '#ffffff',
        'fill-color': '#ffffff',
        'stroke-enabled': false,
        frameId: '',
      },
      children: [],
    } as any);
    const buf = createSceneRenderBuffer(4);
    syncSceneRenderBufferFromDocument(buf, doc);
    setNodeTransformPreviews([{ nodeId: 'r1', left: 0, top: 0, width: 10, height: 10 }]);
    setNodeTransformHidden([{ nodeId: 'r1', hidden: true }]);

    let painted = false;
    const ctx = {
      fillStyle: '',
      fillRect() {
        painted = true;
      },
      beginPath() {},
      ellipse() {},
      fill() {
        painted = true;
      },
      stroke() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      arcTo() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      strokeStyle: '',
      lineWidth: 0,
      lineCap: '',
      lineJoin: '',
    } as unknown as CanvasRenderingContext2D;

    paintSoaBufferBasic(ctx, buf, { left: 0, top: 0, width: 200, height: 200 });
    expect(painted).toBe(false);
  });

  it('applyAnimationPlayheadScenePose publishes rotation without SVG hosts', () => {
    const anim = {
      fr: 30,
      w: 100,
      h: 100,
      layers: [
        {
          ind: 1,
          ty: 4,
          nm: 'R',
          ln: 'shape1',
          w: 40,
          h: 40,
          ip: 0,
          op: 90,
          ks: {
            p: { a: 0, k: [50, 50, 0] },
            s: { a: 0, k: [100, 100, 100] },
            r: {
              a: 1,
              k: [
                { t: 0, s: [0] },
                { t: 30, s: [90] },
              ],
            },
            o: { a: 0, k: 100 },
          },
        },
      ],
    };
    let doc = createEmptyDocument({ emptyWorld: true });
    (doc as any).frames = [
      { id: 'af1', kind: 'animation', x: 0, y: 0, width: 100, height: 100, fps: 30 },
    ];
    doc = addNodeToDocument(doc, 'host1', {
      id: 'host1',
      key: 'lottie',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      attrs: {
        frameId: 'af1',
        animationFrameHost: true,
        animationData: serializeLottieAnimationData(anim),
      },
      children: [],
    } as any);
    doc = addNodeToDocument(doc, 'shape1', {
      id: 'shape1',
      key: 'shape',
      x: 30,
      y: 30,
      width: 40,
      height: 40,
      attrs: {
        frameId: 'af1',
        shapeType: 'rect',
        fill: '#fff',
        'fill-color': '#fff',
        'stroke-enabled': false,
        angle: 0,
      },
      children: [],
    } as any);

    applyAnimationPlayheadScenePose({
      document: doc,
      hostNodeId: 'host1',
      playheadSec: 1,
      applyGeometry: true,
    });
    expect(getNodeTransformPreview('shape1')?.angle).toBeCloseTo(90, 0);

    applyAnimationPlayheadScenePose({
      document: doc,
      hostNodeId: 'host1',
      playheadSec: 0,
      applyGeometry: false,
    });
    expect(getNodeTransformPreview('shape1')).toBeNull();
  });

  it('paintSoaBufferBasic paints live corner-radius preview on canvas idle', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    doc = addNodeToDocument(doc, 'r1', {
      id: 'r1',
      key: 'shape',
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      attrs: {
        shapeType: 'rect',
        fill: '#000000',
        'fill-color': '#000000',
        cornerRadius: 8,
        'stroke-enabled': false,
        frameId: '',
      },
      children: [],
    } as any);
    const buf = createSceneRenderBuffer(4);
    syncSceneRenderBufferFromDocument(buf, doc);
    buf.flags[0] = (buf.flags[0] | SOA_FLAG_CANVAS_IDLE) >>> 0;
    setLiveCornerRadiusPreview({
      nodeId: 'r1',
      display: 80,
      radii: { tl: 80, tr: 80, br: 80, bl: 80 },
    });

    let roundedFill = false;
    const ctx = {
      fillStyle: '',
      fillRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      arcTo() {},
      closePath() {},
      fill() {
        roundedFill = true;
      },
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      strokeStyle: '',
      lineWidth: 0,
      lineCap: '',
      lineJoin: '',
    } as unknown as CanvasRenderingContext2D;

    paintSoaBufferBasic(ctx, buf, { left: 0, top: 0, width: 200, height: 200 }, { document: doc });
    expect(roundedFill).toBe(true);
  });

  it('paintSoaBufferBasic does not fill closed pen when fill is transparent', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    doc = addNodeToDocument(doc, 'pen', {
      id: 'pen',
      key: 'shape',
      x: 0,
      y: 0,
      width: 120,
      height: 120,
      attrs: {
        shapeType: 'pen',
        path: 'M 60 10 L 110 110 L 10 110 Z',
        closed: 'true',
        'fill-color': 'transparent',
        'fill-enabled': 'false',
        'fill-visible': 'false',
        'border-color': '#333333',
        'border-width': 2,
      },
      children: [],
    } as any);
    const buf = createSceneRenderBuffer(4);
    syncSceneRenderBufferFromDocument(buf, doc);
    buf.flags[0] = (buf.flags[0] | SOA_FLAG_CANVAS_IDLE) >>> 0;

    let filled = false;
    let stroked = false;
    const ctx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      lineCap: '',
      lineJoin: '',
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      fill() {
        filled = true;
      },
      stroke() {
        stroked = true;
      },
      save() {},
      restore() {},
      translate() {},
      rotate() {},
    } as unknown as CanvasRenderingContext2D;

    paintSoaBufferBasic(ctx, buf, { left: 0, top: 0, width: 200, height: 200 }, { document: doc });
    expect(filled).toBe(false);
    expect(stroked).toBe(true);
  });

  it('forEachVisibleInRect rescues frameLocal children under live artboard plate', () => {
    let doc = createEmptyDocument({ emptyWorld: true });
    (doc as any).coordSpace = 'frameLocal';
    (doc as any).frames = [{ id: 'f1', kind: 'artboard', x: 0, y: 0, width: 400, height: 400 }];
    // 64 nodes so QT broadphase is active (>= 48).
    for (let i = 0; i < 64; i += 1) {
      const id = `c${i}`;
      doc = addNodeToDocument(doc, id, {
        id,
        key: 'shape',
        x: (i % 8) * 40,
        y: Math.floor(i / 8) * 40,
        width: 30,
        height: 30,
        attrs: {
          shapeType: 'rect',
          fill: '#fff',
          'fill-color': '#fff',
          'stroke-enabled': false,
          frameId: 'f1',
        },
        children: [],
      } as any);
    }
    const buf = createSceneRenderBuffer(128);
    setSoaPaintDocument(doc);
    syncSceneRenderBufferFromDocument(buf, doc);
    expect(buf.quadtree.size).toBe(64);

    // Plate moves far away — stored QT AABBs are still near origin.
    previewArtboardFrameGeometry({ id: 'f1', x: 2000, y: 2000, width: 400, height: 400 });

    const seenNearOrigin: string[] = [];
    forEachVisibleInRect(buf, { minX: 0, minY: 0, maxX: 100, maxY: 100 }, (_i, id) => {
      seenNearOrigin.push(id);
    });
    expect(seenNearOrigin).toEqual([]);

    const seenAtLive: string[] = [];
    forEachVisibleInRect(
      buf,
      { minX: 1990, minY: 1990, maxX: 2050, maxY: 2050 },
      (_i, id) => {
        seenAtLive.push(id);
      }
    );
    expect(seenAtLive).toContain('c0');
  });
});
