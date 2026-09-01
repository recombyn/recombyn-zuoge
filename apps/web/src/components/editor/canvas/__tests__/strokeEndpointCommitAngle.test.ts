import { describe, expect, it } from 'vitest';
import {
  mergeLiveAnglesIntoDoc,
  nodePatchFromGeometryDiff,
} from '../canvasSession';
import type { SceneDocument, SceneNode } from '@/components/rcb/sceneNode';

function lineNode(angle: number, geom: { x: number; y: number; width: number; height: number }): SceneNode {
  return {
    key: 'shape',
    x: geom.x,
    y: geom.y,
    width: geom.width,
    height: geom.height,
    attrs: { shapeType: 'line', angle },
    children: [],
  } as unknown as SceneNode;
}

describe('line/arrow endpoint commit keeps preview angle', () => {
  it('store geom patch includes angle when live preview was merged into the commit base', () => {
    const committedGeom = { x: 0, y: 10, width: 100, height: 1 };
    const nextGeom = { x: 20, y: 30, width: 140, height: 1 };
    const committed = {
      deltaSetLike: {
        ROOT: { key: 'root', children: ['ln'] },
        ln: lineNode(0, committedGeom),
      },
      frames: [],
    } as unknown as SceneDocument;
    const live = {
      deltaSetLike: {
        ROOT: { key: 'root', children: ['ln'] },
        ln: lineNode(35.5, nextGeom),
      },
      frames: [],
    } as unknown as SceneDocument;

    // Same order as onGeometryCommit: bake live angle onto store head, then
    // write next geometry. Diff must use store head — not the merged doc —
    // or angle never reaches the store and release snaps to the old orientation.
    const merged = mergeLiveAnglesIntoDoc(committed, live, ['ln']);
    const nextNode = {
      ...merged.deltaSetLike!.ln!,
      ...nextGeom,
      attrs: { ...merged.deltaSetLike!.ln!.attrs, angle: 35.5 },
    } as SceneNode;

    const wrongBase = nodePatchFromGeometryDiff(merged.deltaSetLike!.ln, nextNode);
    expect(wrongBase?.attrs).toBeUndefined();

    const patch = nodePatchFromGeometryDiff(committed.deltaSetLike!.ln, nextNode);
    expect(patch?.x).toBe(20);
    expect(patch?.y).toBe(30);
    expect(patch?.width).toBe(140);
    expect((patch?.attrs as { angle?: number } | undefined)?.angle).toBe(35.5);
  });
});
