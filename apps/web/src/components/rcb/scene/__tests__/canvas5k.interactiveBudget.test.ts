/**
 * 5k-node canvas interactive budget — document scale + SVG host / Canvas idle cap.
 *
 * Full DOM mount of 5k SVG hosts is intentionally not the product path;
 * this suite proves spatial cull + host budget stay within the ~96 full-host
 * rule while the document holds 5k nodes (see canvas-architecture.md).
 *
 * Run: `npm run test:stress --workspace=apps/web -- canvas5k`
 */
import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  normalizeDocument,
} from '@/components/rcb/scene/document/sceneDocument';
import { RcbSpatialIndex, nodeSceneAabb } from '@/components/rcb/core/spatialIndex';
import { pickFullAndCanvasIds } from '@/components/rcb/shapes/RcbShapesLayer';
import type { SceneDocument, SceneNode } from '@/components/rcb/sceneNode';

const N = 5000;

function buildDoc(n: number): SceneDocument {
  const base = createEmptyDocument({ width: 4000, height: 4000 });
  const cols = 80;
  const nodes: Record<string, SceneNode> = { ...(base.deltaSetLike as Record<string, SceneNode>) };
  const children: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const id = `n${i}`;
    children.push(id);
    const col = i % cols;
    const row = Math.floor(i / cols);
    nodes[id] = {
      id,
      key: 'shape',
      x: col * 48,
      y: row * 48,
      z: i,
      width: 40,
      height: 40,
      children: [],
      attrs: { shapeType: 'rect', 'fill-color': '#94a3b8' },
    };
  }
  const pageId = base.activePageId || base.pages[0]?.id || 'page_1';
  nodes.ROOT = { ...nodes.ROOT, children };
  const pages = base.pages.map((p) => (p.id === pageId ? { ...p, children } : p));
  return normalizeDocument({
    ...base,
    pages,
    deltaSetLike: nodes,
  });
}

describe('canvas 5k interactive budget', () => {
  it('builds 5k-node document and keeps SVG host / Canvas idle budget', () => {
    const doc = buildDoc(N);
    const ids = (doc.deltaSetLike?.ROOT?.children || []).filter(Boolean);
    expect(ids.length).toBe(N);

    const index = new RcbSpatialIndex(256);
    for (const id of ids) {
      const box = nodeSceneAabb(doc, id, 32);
      if (!box) continue;
      index.upsert({ id, ...box });
    }

    const visible = index.search(0, 0, 1200, 800).map((x) => x.id);
    expect(visible.length).toBeGreaterThan(50);
    expect(visible.length).toBeLessThan(N);

    const { fullIds, canvasIds } = pickFullAndCanvasIds({
      document: doc,
      visibleIds: visible,
      keepSet: new Set(visible.slice(0, 2)),
      zoom: 0.15,
      moving: false,
    });
    expect(fullIds.length).toBeLessThanOrEqual(96);
    expect(fullIds.length + canvasIds.length).toBe(visible.length);
    expect(canvasIds.length).toBeGreaterThan(0);
  });
});
