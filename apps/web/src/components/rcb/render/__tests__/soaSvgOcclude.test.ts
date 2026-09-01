import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  addNodeToDocument,
  stackNodeKey,
} from '@/components/rcb/scene/document/sceneDocument';
import {
  createSceneRenderBuffer,
  paintSoaBufferBasic,
  syncSceneRenderBufferFromDocument,
  applySoaHostPromotion,
  SOA_FLAG_CANVAS_IDLE,
} from '../sceneRenderBuffer';

describe('SoA idle vs higher-z SVG occlude', () => {
  it('clips demoted ink under a promoted overlapping sibling', () => {
    let doc = createEmptyDocument({ width: 800, height: 600, emptyWorld: true });
    doc = addNodeToDocument(doc, 'back', {
      id: 'back',
      key: 'shape',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      attrs: {
        shapeType: 'rect',
        fill: '#ffffff',
        'fill-color': '#ffffff',
        'stroke-enabled': false,
      },
      children: [],
    });
    doc = addNodeToDocument(doc, 'front', {
      id: 'front',
      key: 'shape',
      x: 40,
      y: 40,
      width: 100,
      height: 100,
      attrs: {
        shapeType: 'rect',
        fill: '#ffffff',
        'fill-color': '#ffffff',
        'stroke-enabled': false,
      },
      children: [],
    });
    doc = {
      ...doc,
      stackOrder: [stackNodeKey('back'), stackNodeKey('front')],
    };

    const buf = createSceneRenderBuffer();
    syncSceneRenderBufferFromDocument(buf, doc);
    applySoaHostPromotion(buf, new Set(['front']));
    expect(buf.flags[buf.indexById.get('back')!] & SOA_FLAG_CANVAS_IDLE).toBeTruthy();
    expect(buf.flags[buf.indexById.get('front')!] & SOA_FLAG_CANVAS_IDLE).toBeFalsy();

    let clipRule: string | undefined;
    const rects: number[][] = [];
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn((x: number, y: number, w: number, h: number) => {
        rects.push([x, y, w, h]);
      }),
      clip: vi.fn((rule?: string) => {
        clipRule = rule;
      }),
      fillRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arcTo: vi.fn(),
      closePath: vi.fn(),
      ellipse: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      set fillStyle(_v: string) {},
      set strokeStyle(_v: string) {},
      set lineWidth(_v: number) {},
      set lineJoin(_v: string) {},
      set lineCap(_v: string) {},
    } as unknown as CanvasRenderingContext2D;

    paintSoaBufferBasic(ctx, buf, { left: 0, top: 0, width: 800, height: 600 }, { document: doc });

    expect(clipRule).toBe('evenodd');
    // Hole matches the SVG rect silhouette (40,40,100,100) — not an expanded AABB.
    expect(rects.some((r) => Math.abs(r[0] - 40) < 0.1 && Math.abs(r[1] - 40) < 0.1 && Math.abs(r[2] - 100) < 0.1)).toBe(
      true
    );
    // Keep-region may pad slightly; hole must not use the old +1 scene-unit expand.
    expect(rects.some((r) => Math.abs(r[0] - 39) < 0.1 && Math.abs(r[2] - 102) < 0.1)).toBe(false);
  });
});
